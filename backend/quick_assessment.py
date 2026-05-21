"""
Quick Assessment for Free-tier users.

Flow
----
1. User adds a domain  → POST /api/v1/assets   (creates Asset with random token; not verified)
2. User proves ownership →
       a. DNS TXT  : add `cyber-arena-verify=<token>` to a TXT record on the domain.
       b. HTTP file: serve token at  http://<domain>/.well-known/cyber-arena-verify
   Then POST /api/v1/assets/{id}/verify; we check both methods.
3. User runs    → POST /api/v1/quick-assessment {asset_id}
   Light, safe scan only:
       - subdomain enum (passive, free sources)
       - nmap top 100 ports (-T3, --top-ports 100, no scripts)
       - nuclei ``low,medium,high,critical`` with safe tags only
4. Findings are persisted via record_scan() with tool="quick-assessment", which means
   the existing /api/v1/scans/{id}/report.pdf endpoint already produces the PDF.

Free-tier rate limiting: max QUICK_FREE_DAILY_LIMIT runs in the last 24 hours.
"""
from __future__ import annotations

import os
import re
import secrets
import socket
import subprocess
import json as _json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from auth import get_current_user
from database import engine, get_db, SessionLocal
from models import Asset, Scan, User
import vuln_assessment as va


# ---------------------------------------------------------------------------
# Lightweight, idempotent migrations for newly-added columns / tables
# ---------------------------------------------------------------------------

def _ensure_schema() -> None:
    """Add missing columns/tables when the DB pre-dates this feature."""
    insp = inspect(engine)
    try:
        with engine.begin() as conn:
            # users.tier
            if "users" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("users")}
                if "tier" not in cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN tier VARCHAR(20) NOT NULL DEFAULT 'free'"))
            # assets table — created_all() creates it; nothing to backfill.
    except Exception as e:
        print(f"WARN: quick_assessment._ensure_schema: {e}")


_ensure_schema()


# ---------------------------------------------------------------------------
# Constants / config
# ---------------------------------------------------------------------------

QUICK_FREE_DAILY_LIMIT = int(os.environ.get("QUICK_FREE_DAILY_LIMIT", "2"))
QUICK_PRO_DAILY_LIMIT = int(os.environ.get("QUICK_PRO_DAILY_LIMIT", "100"))
TOOL_KEY = "quick-assessment"
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")


def _normalize_domain(raw: str) -> str:
    d = (raw or "").strip().lower()
    # strip scheme/path if user pasted a URL
    if "://" in d:
        d = d.split("://", 1)[1]
    d = d.split("/")[0].split(":")[0].rstrip(".")
    if d.startswith("www."):
        d = d[4:]
    if not DOMAIN_RE.match(d):
        raise HTTPException(status_code=400, detail=f"Invalid domain: {raw!r}")
    return d


def _user_daily_limit(user: User) -> int:
    return QUICK_PRO_DAILY_LIMIT if (user.tier or "free").lower() == "pro" else QUICK_FREE_DAILY_LIMIT


def _scans_in_last_24h(db: Session, user_id: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    return (
        db.query(Scan)
        .filter(Scan.user_id == user_id, Scan.tool == TOOL_KEY, Scan.created_at >= cutoff)
        .count()
    )


# ---------------------------------------------------------------------------
# Ownership verification
# ---------------------------------------------------------------------------

def _check_dns_txt(domain: str, token: str) -> bool:
    """Look for a TXT record containing ``cyber-arena-verify=<token>``."""
    expected = f"cyber-arena-verify={token}"
    # Use `dig` if available; otherwise fall back to socket-based probe via Python.
    try:
        proc = subprocess.run(
            ["dig", "+short", "TXT", domain],
            capture_output=True, text=True, timeout=10,
        )
        if proc.returncode == 0:
            for line in proc.stdout.splitlines():
                if expected in line.replace('"', ''):
                    return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    # Pure-Python fallback (no extra dep): try resolver via dnspython if installed
    try:
        import dns.resolver  # type: ignore
        for rdata in dns.resolver.resolve(domain, "TXT", lifetime=10):
            for txt in rdata.strings:
                if expected.encode() in txt:
                    return True
    except Exception:
        pass
    return False


def _check_http_file(domain: str, token: str) -> bool:
    """Fetch http(s)://<domain>/.well-known/cyber-arena-verify and look for the token."""
    for scheme in ("https", "http"):
        url = f"{scheme}://{domain}/.well-known/cyber-arena-verify"
        try:
            r = requests.get(url, timeout=8, verify=False, allow_redirects=True)
            if r.status_code == 200 and token.strip() in r.text.strip():
                return True
        except requests.RequestException:
            continue
    return False


# ---------------------------------------------------------------------------
# Findings: per-template "short fix" guidance
# ---------------------------------------------------------------------------

_GENERIC_FIX = "Review the affected service: patch to the latest version, remove or restrict access, and enable secure defaults."

_FIX_HINTS: Dict[str, str] = {
    "open-port-21":  "Replace FTP with SFTP/HTTPS; if not needed, close port 21.",
    "open-port-23":  "Disable Telnet (port 23). Use SSH instead.",
    "open-port-25":  "Restrict SMTP to mail servers only; require auth + TLS.",
    "open-port-3389":"Don't expose RDP to the internet — put it behind a VPN or restrict by IP.",
    "open-port-3306":"Don't expose MySQL — bind to localhost or restrict by firewall.",
    "open-port-5432":"Don't expose PostgreSQL — bind to localhost or restrict by firewall.",
    "open-port-6379":"Don't expose Redis — bind to localhost; require auth.",
    "open-port-27017":"Don't expose MongoDB — bind to localhost; require auth.",
    "open-port-9200":"Don't expose Elasticsearch — restrict by firewall and require auth.",
    "subdomain":     "Inventory new subdomains; if not in use, decommission DNS to avoid takeover.",
    "exposure":      "Remove or password-protect the exposed resource; add WAF rules if it must stay public.",
    "misconfig":     "Apply the vendor's hardening guide; disable verbose errors and default credentials.",
    "cve":           "Patch to a fixed version of the affected component as soon as possible.",
    "tech":          "Hide tech/version banners and audit the component for known CVEs.",
}


def _fix_for(severity: str, tags: List[str], title: str, port: Optional[int] = None) -> str:
    if port is not None:
        key = f"open-port-{port}"
        if key in _FIX_HINTS:
            return _FIX_HINTS[key]
    for t in tags:
        if t in _FIX_HINTS:
            return _FIX_HINTS[t]
    return _GENERIC_FIX


# ---------------------------------------------------------------------------
# Tool runners (light-mode)
# ---------------------------------------------------------------------------

def _run_subdomains_light(domain: str, max_results: int = 30) -> List[str]:
    """Passive subdomain discovery using existing free sources."""
    try:
        from subdomain_sources import discover  # type: ignore
        names, _stats, _errs = discover(domain)
        out = sorted(names)
        return out[:max_results]
    except Exception as e:
        print(f"WARN: subdomain_sources.discover failed: {e}")
        return []


def _run_nmap_light(target: str) -> List[Dict[str, Any]]:
    """nmap --top-ports 100, no scripts, no aggressive timing."""
    try:
        import nmap  # python-nmap (already a backend dependency)
    except Exception as e:
        return [{"_error": f"python-nmap not available: {e}"}]
    nm = nmap.PortScanner()
    try:
        nm.scan(hosts=target, arguments="-Pn --top-ports 100 -T3")
    except Exception as e:
        return [{"_error": f"nmap failed: {e}"}]
    open_ports: List[Dict[str, Any]] = []
    for host in nm.all_hosts():
        for proto in nm[host].all_protocols():
            for port in sorted(nm[host][proto].keys()):
                info = nm[host][proto][port]
                if info.get("state") != "open":
                    continue
                open_ports.append({
                    "host": host,
                    "port": int(port),
                    "proto": proto,
                    "service": info.get("name") or "",
                    "product": info.get("product") or "",
                    "version": info.get("version") or "",
                })
    return open_ports


def _run_nuclei_light(target: str, timeout: int = 240) -> List[Dict[str, Any]]:
    """Run nuclei with only safe templates: cve, exposures, misconfigurations, tech detection."""
    target_url = target if target.startswith(("http://", "https://")) else f"http://{target}"
    cmd = [
        "nuclei",
        "-u", target_url,
        "-jsonl",
        "-silent",
        "-disable-update-check",
        "-no-color",
        "-rate-limit", "100",
        "-c", "20",
        "-timeout", "10",
        "-severity", "low,medium,high,critical",
        "-tags", "cve,misconfig,exposure,tech",
        "-stats=false",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return [{"_error": "nuclei binary not installed"}]
    except subprocess.TimeoutExpired as e:
        proc = e
    out: List[Dict[str, Any]] = []
    raw = getattr(proc, "stdout", "") or ""
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            out.append(_json.loads(line))
        except _json.JSONDecodeError:
            pass
    return out


# ---------------------------------------------------------------------------
# Mapper for vuln_assessment
# ---------------------------------------------------------------------------

def from_quick_assessment(response: dict) -> List[dict]:
    """Map the Quick-Assessment payload into normalized findings with `fix` text."""
    if not isinstance(response, dict):
        return []
    findings: List[dict] = []
    target = response.get("target", "")

    # 1) subdomains → INFO findings (informational only)
    for sub in response.get("subdomains", []) or []:
        findings.append({
            "severity": "INFO",
            "title": f"Subdomain discovered: {sub}",
            "description": f"Passive sources mention this hostname under {target}.",
            "location": sub,
            "evidence": "",
            "references": [],
            "fix": _fix_for("INFO", ["subdomain"], "subdomain"),
        })

    # 2) nmap open ports → LOW by default; HIGH for known-risky exposed services
    risky_ports = {21, 23, 25, 3389, 3306, 5432, 6379, 27017, 9200}
    for p in response.get("open_ports", []) or []:
        if "_error" in p:
            continue
        port = int(p.get("port") or 0)
        sev = "HIGH" if port in risky_ports else "LOW"
        title = f"Open port {port}/{p.get('proto','tcp')}"
        if p.get("service"):
            title += f" ({p['service']})"
        ev = " ".join(filter(None, [p.get("product"), p.get("version")]))
        findings.append({
            "severity": sev,
            "title": title,
            "description": f"Port {port}/{p.get('proto','tcp')} is open on {p.get('host', target)}.",
            "location": f"{p.get('host', target)}:{port}",
            "evidence": ev,
            "references": [],
            "fix": _fix_for(sev, [], title, port=port),
        })

    # 3) nuclei JSONL → real findings with severity from the template
    for n in response.get("nuclei", []) or []:
        if isinstance(n, dict) and n.get("_error"):
            continue
        info = n.get("info", {}) if isinstance(n, dict) else {}
        sev = (info.get("severity") or "info").upper()
        tags = info.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        title = info.get("name") or n.get("template-id") or "Nuclei finding"
        loc = n.get("matched-at") or n.get("host") or target
        refs = info.get("reference") or []
        if isinstance(refs, str):
            refs = [refs]
        findings.append({
            "severity": sev,
            "title": title,
            "description": info.get("description") or "",
            "location": str(loc),
            "evidence": (n.get("matcher-name") or n.get("extracted-results") or [""])
                if isinstance(n.get("extracted-results"), list) else (n.get("matcher-name") or ""),
            "references": refs[:5] if isinstance(refs, list) else [],
            "fix": _fix_for(sev, tags, title),
        })
    return findings


# Register so /api/v1/scans and the PDF report understand this tool.
va.TOOL_REGISTRY[TOOL_KEY] = (from_quick_assessment, "Quick Assessment")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AssetCreateBody(BaseModel):
    domain: str = Field(..., min_length=3, max_length=255)


class AssetOut(BaseModel):
    id: int
    domain: str
    verified: bool
    verification_token: str
    verification_method: Optional[str] = None
    verified_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    dns_record_name: str
    dns_record_value: str
    well_known_url: str
    well_known_value: str


def _asset_to_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id, domain=a.domain,
        verified=bool(a.verified_at),
        verification_token=a.verification_token,
        verification_method=a.verification_method,
        verified_at=a.verified_at, created_at=a.created_at,
        dns_record_name=f"_cyber-arena.{a.domain}",
        dns_record_value=f"cyber-arena-verify={a.verification_token}",
        well_known_url=f"http://{a.domain}/.well-known/cyber-arena-verify",
        well_known_value=a.verification_token,
    )


class QuickAssessmentBody(BaseModel):
    asset_id: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/v1", tags=["Quick Assessment"])


@router.post("/assets", response_model=AssetOut)
def create_asset(body: AssetCreateBody, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    domain = _normalize_domain(body.domain)
    existing = db.query(Asset).filter(
        Asset.user_id == current_user.id, Asset.domain == domain
    ).first()
    if existing:
        return _asset_to_out(existing)
    a = Asset(
        user_id=current_user.id,
        domain=domain,
        verification_token=secrets.token_hex(16),
    )
    db.add(a); db.commit(); db.refresh(a)
    return _asset_to_out(a)


@router.get("/assets", response_model=List[AssetOut])
def list_assets(db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    rows = (db.query(Asset)
              .filter(Asset.user_id == current_user.id)
              .order_by(Asset.created_at.desc())
              .all())
    return [_asset_to_out(a) for a in rows]


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    a = db.query(Asset).filter(Asset.id == asset_id,
                                Asset.user_id == current_user.id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    db.delete(a); db.commit()
    return {"ok": True}


@router.post("/assets/{asset_id}/verify", response_model=AssetOut)
def verify_asset(asset_id: int, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    a = db.query(Asset).filter(Asset.id == asset_id,
                                Asset.user_id == current_user.id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    if a.verified_at:
        return _asset_to_out(a)
    if _check_dns_txt(a.domain, a.verification_token):
        a.verification_method = "dns"
    elif _check_http_file(a.domain, a.verification_token):
        a.verification_method = "http"
    else:
        raise HTTPException(
            status_code=400,
            detail=("Verification failed. Add the DNS TXT record OR serve the file at "
                    "/.well-known/cyber-arena-verify, then try again."),
        )
    a.verified_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(a)
    return _asset_to_out(a)


@router.post("/quick-assessment")
def run_quick_assessment(body: QuickAssessmentBody, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    a = db.query(Asset).filter(Asset.id == body.asset_id,
                                Asset.user_id == current_user.id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not a.verified_at:
        raise HTTPException(
            status_code=403,
            detail="Domain is not verified. Verify ownership before running a scan.",
        )

    # Free-tier rate limit
    used = _scans_in_last_24h(db, current_user.id)
    limit = _user_daily_limit(current_user)
    if used >= limit:
        raise HTTPException(
            status_code=429,
            detail=(f"Daily scan limit reached ({used}/{limit}). "
                    f"Upgrade to Pro to run more scans, or try again tomorrow."),
        )

    # Resolve to make sure the domain still resolves before we run any tools
    try:
        socket.gethostbyname(a.domain)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail=f"DNS does not resolve {a.domain}")

    started_at = datetime.now(timezone.utc).isoformat()
    subdomains = _run_subdomains_light(a.domain)
    open_ports = _run_nmap_light(a.domain)
    nuclei = _run_nuclei_light(a.domain)
    finished_at = datetime.now(timezone.utc).isoformat()

    response: Dict[str, Any] = {
        "status": "success",
        "engine": "quick-assessment-v1",
        "target": a.domain,
        "asset_id": a.id,
        "started_at": started_at,
        "finished_at": finished_at,
        "subdomains": subdomains,
        "open_ports": [p for p in open_ports if "_error" not in p],
        "nuclei": [n for n in nuclei if not (isinstance(n, dict) and n.get("_error"))],
        "errors": (
            [p["_error"] for p in open_ports if "_error" in p] +
            [n["_error"] for n in nuclei if isinstance(n, dict) and n.get("_error")]
        ),
        "rate_limit": {"used_24h": used + 1, "limit_24h": limit, "tier": current_user.tier or "free"},
    }

    # record_scan persists + attaches assessment with our findings (incl. `fix`)
    from main import record_scan  # local import to avoid circular at module load
    return record_scan(TOOL_KEY, a.domain, response, current_user)


@router.get("/quick-assessment/quota")
def quick_quota(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    used = _scans_in_last_24h(db, current_user.id)
    limit = _user_daily_limit(current_user)
    return {
        "tier": current_user.tier or "free",
        "used_24h": used,
        "limit_24h": limit,
        "remaining": max(0, limit - used),
    }
