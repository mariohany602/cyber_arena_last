import subprocess
import re
import os
import shutil
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass

# Make sure user-local installs (e.g. ~/.local/bin, ~/go/bin) are visible to
# subprocess calls regardless of how uvicorn was started.
_extra_paths = [
    str(Path.home() / ".local" / "bin"),
    str(Path.home() / "go" / "bin"),
    "/usr/local/bin",
]
_existing = os.environ.get("PATH", "").split(os.pathsep)
os.environ["PATH"] = os.pathsep.join(
    [p for p in _extra_paths if p not in _existing] + _existing
)
from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.middleware.cors import CORSMiddleware
import nmap
import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel
import random
import time
from typing import List
from sqlalchemy.orm import Session
from datetime import timedelta, datetime

import json
# Import our modules
from database import engine, get_db, Base, SessionLocal
from models import User, Scan
import vuln_assessment as va
from tenant import get_current_org, require_feature
from report_pdf import render_scan_pdf
from tool_security import validate_host, validate_url, safe_arg
from schemas import (
    UserCreate, 
    UserLogin, 
    UserResponse, 
    Token, 
    PasswordUpdate, 
    TwoFASetup, 
    TwoFAVerify,
    TwoFALogin,
    UserUpdate,
    MessageCreate,
    MessageResponse
)
from auth import (
    get_password_hash,
    authenticate_user,
    verify_password,
    create_access_token,
    get_current_user,
    ACCESS_TOKEN_EXPIRE_MINUTES
)

# Create database tables
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print("\n" + "="*60)
    print("❌ DATABASE CONNECTION ERROR")
    print("Could not connect to MySQL database.")
    print("Please ensure:")
    print("1. MySQL server is running")
    print("2. Database 'cyber_arena' exists")
    print("3. Credentials in database.py are correct")
    print(f"Error details: {e}")
    print("="*60 + "\n")

# --- Resource helpers ---------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_WORDLIST = BACKEND_DIR / "wordlists" / "common.txt"


def get_wordlist_path(name: str = "common") -> str:
    """Return an absolute path to a wordlist shipped in backend/wordlists/.

    Falls back to common.txt if the requested name does not exist.
    """
    candidate = BACKEND_DIR / "wordlists" / f"{name}.txt"
    if candidate.is_file():
        return str(candidate)
    return str(DEFAULT_WORDLIST)


# --- Scan persistence + assessment -----------------------------------------
def record_scan(tool: str, target: str, response: dict, user: "User",
                status: str | None = None,
                organization_id: int | None = None) -> dict:
    """Normalize findings, run vulnerability assessment, and persist a Scan row.

    Mutates `response` in-place to embed the assessment so the frontend gets:
        response["assessment"] = { findings, severity_counts, risk_score, risk_label, scan_id }

    `status` is persisted on the Scan row. If omitted it falls back to
    response["status"] (or "success") so existing call sites keep working.

    `organization_id`: tenant the scan belongs to. If omitted, we look up
    the user's primary OrgMembership so legacy call sites stay working
    without each one having to plumb the org through.
    """
    findings = va.normalize(tool, response or {})
    assessment = va.assess(findings)

    db = SessionLocal()
    scan_id = None
    try:
        # Resolve org if not passed explicitly. Required for tenant
        # isolation; pre-multitenancy data may still have NULL, which the
        # migration backfills, but new scans must always be tagged.
        if organization_id is None:
            from models import OrgMembership as _Mem
            mem = (
                db.query(_Mem)
                .filter(_Mem.user_id == user.id)
                .order_by(_Mem.joined_at.asc())
                .first()
            )
            organization_id = mem.organization_id if mem else None
        # Cap stored JSON sizes to keep DB lean.
        def _dump(obj, max_len=120_000):
            s = json.dumps(obj, default=str)
            return s if len(s) <= max_len else s[:max_len]

        # Build a brief one-liner summary
        sc = assessment["severity_counts"]
        summary = (
            f"{assessment['total_findings']} findings — "
            f"C:{sc['CRITICAL']} H:{sc['HIGH']} M:{sc['MEDIUM']} L:{sc['LOW']} I:{sc['INFO']} "
            f"(risk {assessment['risk_score']:.0f}/100, {assessment['risk_label']})"
        )

        resolved_status = (
            status
            or (response.get("status") if isinstance(response, dict) else None)
            or "success"
        )
        scan = Scan(
            user_id=user.id,
            organization_id=organization_id,
            tool=tool,
            target=str(target)[:500],
            engine=str(response.get("engine", ""))[:50] if isinstance(response, dict) else "",
            status=str(resolved_status)[:20],
            findings_json=_dump(findings),
            raw_json=_dump(response),
            risk_score=assessment["risk_score"],
            severity_counts_json=json.dumps(assessment["severity_counts"]),
            summary=summary[:500],
        )
        db.add(scan)
        db.commit()
        db.refresh(scan)
        scan_id = scan.id
    except Exception as e:
        db.rollback()
        print(f"WARN: record_scan failed: {e}")
    finally:
        db.close()

    if isinstance(response, dict):
        response["assessment"] = {
            **assessment,
            "findings": findings,
            "scan_id": scan_id,
            "tool": tool,
            "tool_label": va.tool_label(tool),
        }
    return response


app = FastAPI(
    title="Cyber Arena Security API",
    description="Professional API for Security Tools Integration",
    version="1.0.0"
)

# allow local dev frontend to reach the API
app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# SOC / SIEM (Elasticsearch-backed) routes
from soc_siem import router as soc_siem_router
app.include_router(soc_siem_router)

from wazuh import router as wazuh_router
app.include_router(wazuh_router)

# TheHive (read-only mirror of an external TheHive 4.x instance).
from thehive import router as thehive_router
app.include_router(thehive_router)

# -----------------------------------------------------------------------------
# Phase 1 — SOC platform extension (incidents, cases, alert triage, IOCs,
# threat hunting, asset inventory, audit log). All routers are additive and
# guarded by RBAC permissions in backend/rbac.py.
# -----------------------------------------------------------------------------
from incidents import router as incidents_router
from cases import router as cases_router
from triage import router as triage_router
from iocs import router as iocs_router
from hunts import router as hunts_router
from asset_inventory import router as assets_router
from audit_log import router as audit_router
from rbac_admin import router as rbac_admin_router
# Phase 4 additions — SOAR & executive analytics.
from soar import router as soar_router
from exec_dashboard import router as exec_dashboard_router
# Phase 5 additions — realtime monitoring + AI assistant.
from realtime import router as realtime_router, broker as realtime_broker
from ai_assistant import router as ai_router
# SaaS multi-tenancy: per-org settings, members, plan, enrollment, provisioning.
from organizations import router as organizations_router
# Customer agent onboarding (public /install.sh + per-org agent CRUD).
from agents import router as agents_router

app.include_router(organizations_router)
app.include_router(agents_router)
app.include_router(incidents_router)
app.include_router(cases_router)
app.include_router(triage_router)
app.include_router(iocs_router)
app.include_router(hunts_router)
app.include_router(assets_router)
app.include_router(audit_router)
app.include_router(rbac_admin_router)
app.include_router(soar_router)
app.include_router(exec_dashboard_router)
app.include_router(realtime_router)
app.include_router(ai_router)


# Phase 5: capture the running event loop on startup so the realtime broker
# can safely publish events from synchronous SQLAlchemy listeners via
# `loop.call_soon_threadsafe`. Without this hook the listeners still fire
# but events won't reach connected WebSocket clients.
@app.on_event("startup")
async def _soc_phase5_startup() -> None:
    import asyncio as _asyncio
    realtime_broker.attach_loop(_asyncio.get_running_loop())

# Best-effort SQLite schema migration for newly-added columns on existing
# tables. New tables are created automatically by Base.metadata.create_all.
def _phase1_migrate() -> None:
    """Add the ``role`` column to ``users`` if it doesn't exist yet.

    SQLAlchemy's ``create_all`` does NOT alter existing tables, so we run a
    pragma-based check + ALTER on import. Safe to call repeatedly.
    """
    try:
        with engine.begin() as conn:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
            if "role" not in cols:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'analyst'"
                )
                print("[phase1] Added users.role column")
    except Exception as e:  # noqa: BLE001
        print(f"[phase1] migration warning: {e}")


_phase1_migrate()


# Seed the Plan catalogue (free/starter/pro/enterprise) so require_feature()
# always has something to consult. Idempotent — re-runs on every boot to
# pick up feature-flag changes from the source-of-truth in tenant.py.
def _seed_plans_on_boot() -> None:
    from tenant import seed_plans as _seed
    db = SessionLocal()
    try:
        _seed(db)
    except Exception as e:  # noqa: BLE001
        print(f"[plans] seed warning: {e}")
    finally:
        db.close()

_seed_plans_on_boot()


# --- محرك الـ Nmap ---
@app.get("/api/v1/nmap", tags=["Scanners"])
def nmap_scanner(
    target: str = Query(..., example="127.0.0.1"), 
    scan_type: str = Query("quick", example="aggressive"),
    script: str = Query(None, example="vuln"),
    no_ping: bool = Query(False, description="Whether to skip host discovery (-Pn)"),
    current_user: User = Depends(get_current_user)
):
    """Run a real Nmap scan. Requires the nmap binary to be installed."""
    if not shutil.which("nmap"):
        raise HTTPException(
            status_code=503,
            detail="nmap binary not installed on server. Install with: sudo apt install nmap",
        )
    target = validate_host(target)
    # Whitelist of acceptable script names/categories. Free-form values
    # would let a logged-in user run arbitrary nmap NSE scripts (file
    # disclosure, default-credential brute-forcing, etc.).
    ALLOWED_SCRIPTS = {
        "default", "vuln", "auth", "discovery", "safe", "version",
        "http-title", "http-headers", "http-enum", "ssl-cert",
        "smb-os-discovery", "ssh-auth-methods",
    }
    ALLOWED_TYPES = {"quick", "regular", "aggressive", "vuln", "service"}
    scan_type = safe_arg(scan_type or "quick", "scan_type", allowed=ALLOWED_TYPES)
    try:
        nm = nmap.PortScanner()
        scan_args_map = {
            "quick": "-F",
            "regular": "",
            "aggressive": "-A",
            "vuln": "--script vuln",
            "service": "-sV",
        }
        base_args = scan_args_map.get(scan_type, "-F")
        if no_ping:
            base_args += " -Pn"
        if script:
            chosen = safe_arg(script, "script", allowed=ALLOWED_SCRIPTS)
            base_args += f" --script {chosen}"

        nm.scan(target, arguments=base_args)
        results = []
        host_status = "down"
        if nm.all_hosts():
            host_key = target if target in nm.all_hosts() else nm.all_hosts()[0]
            host_status = nm[host_key].state()
            for host in nm.all_hosts():
                for proto in nm[host].all_protocols():
                    for port in nm[host][proto]:
                        port_data = nm[host][proto][port]
                        results.append({
                            "port": port,
                            "service": port_data.get("name", "unknown"),
                            "version": f"{port_data.get('product', '')} {port_data.get('version', '')}".strip() or "unknown",
                            "state": port_data.get("state", "unknown"),
                            "scripts": port_data.get("script", {}),
                        })
        return record_scan("nmap", target, {
            "status": "success",
            "host_status": host_status,
            "data": results,
            "args": base_args,
            "engine": "nmap-binary",
        }, current_user)
    except nmap.PortScannerError as e:
        raise HTTPException(status_code=500, detail=f"Nmap scan failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Nmap Engine Error: {str(e)}")

# --- محرك الـ Nikto ---
_NIKTO_FINDING_RE = re.compile(
    r"^\+\s+(?P<path>/\S+)?\s*(?::\s*)?(?P<msg>.+?)(?:\s*See:\s*(?P<ref>https?://\S+))?$"
)


def _run_nikto(target: str, timeout: int = 180):
    """Run nikto and parse its text output. Returns list of findings or None on failure."""
    try:
        proc = subprocess.run(
            ["nikto", "-h", target, "-Tuning", "x", "-ask", "no",
             "-nointeractive", "-maxtime", "120s"],
            capture_output=True, text=True, timeout=timeout,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        print(f"INFO: Nikto unavailable ({type(e).__name__}: {e}).")
        return None

    findings = []
    skip_prefixes = (
        "+ Target IP:", "+ Target Hostname:", "+ Target Port:",
        "+ Start Time:", "+ End Time:", "+ Server:", "+ Root page",
        "+ No CGI", "+ Scan terminated", "+ requests:",
        "+ 1 host(s) tested", "+ Server may leak", "+ "
    )
    for raw in (proc.stdout or "").splitlines():
        line = raw.rstrip()
        if not line.startswith("+ "):
            continue
        # Skip metadata banner lines
        if line.startswith(("+ Target ", "+ Start Time", "+ End Time",
                            "+ Server:", "+ Root page", "+ Scan terminated",
                            "+ 1 host(s)")):
            continue
        body = line[2:].strip()
        if not body or body.startswith("requests:"):
            continue
        # Try to split "/path: message" form
        path = "/"
        msg = body
        m = re.match(r"^(/\S*?):\s*(.+)$", body)
        if m:
            path, msg = m.group(1), m.group(2).strip()
        # crude severity heuristic
        low = msg.lower()
        if any(k in low for k in ("rce", "remote code", "shell", "sql injection")):
            severity = "HIGH"
        elif any(k in low for k in ("traversal", "xss", "inject", "default", "config")):
            severity = "MEDIUM"
        elif any(k in low for k in ("missing", "header", "x-frame", "x-content")):
            severity = "LOW"
        else:
            severity = "INFO"
        findings.append({"id": "NIKTO", "severity": severity, "msg": msg, "path": path})
    return findings


@app.get("/api/v1/nikto", tags=["Scanners"])
def nikto_scanner(target: str = Query(..., example="http://127.0.0.1"), current_user: User = Depends(get_current_user)):
    """Run a real Nikto web-server scan. Requires the nikto binary."""
    if not shutil.which("nikto"):
        raise HTTPException(
            status_code=503,
            detail="nikto binary not installed on server. Install with: sudo apt install nikto",
        )
    target = validate_url(target)
    try:
        real_findings = _run_nikto(target)
        if real_findings is None:
            raise HTTPException(
                status_code=500,
                detail="Nikto execution failed (timeout or runtime error). Check backend logs.",
            )

        raw_output = f"- Nikto (live)\n+ Target: {target}\n" + "\n".join(
            f"+ {f['path']}: {f['msg']}" for f in real_findings
        )
        return record_scan("nikto", target, {
            "status": "success",
            "target": target,
            "findings": real_findings,
            "raw_output": raw_output,
            "engine": "nikto-binary",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, current_user)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Nikto Engine Error: {str(e)}")

import re
import time

# --- Web Crawler ---
class CrawlRequest(BaseModel):
    url: str
    depth: int = 1
    user_agent: str = "CyberArena-SecurityScanner/1.0"
    extract_assets: bool = False
    search_pattern: str = ""
    delay: float = 0.0

@app.get("/api/hello")
def hello():
    return {"message": "Hello from backend!!"}

# Authentication Endpoints
@app.post("/api/auth/signup", response_model=UserResponse, tags=["Authentication"])
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    """Create a new operator account *and* their first Organization.

    SaaS onboarding: every signup atomically creates:
      - the User
      - one Organization (named by ``company_name``, defaulting to
        ``"<username>'s workspace"``)
      - an OrgMembership(role='owner') linking them

    The organization's Wazuh agent group + enrollment key are also
    generated here so the new tenant can immediately start onboarding
    agents from /settings/organization. Live provisioning against the
    Wazuh/TheHive APIs is opt-in via the ``PROVISIONING_ENABLED`` env
    flag (see backend/tenant_provisioning.py).
    """
    from models import Organization as OrgModel, OrgMembership as OrgMem
    from tenant import new_enrollment_key, unique_slug

    # Duplicate checks first so we never half-create on collision.
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    org_name = (user_data.company_name or "").strip() or f"{user_data.username}'s workspace"

    try:
        new_user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=get_password_hash(user_data.password),
        )
        db.add(new_user)
        db.flush()  # populate new_user.id

        org = OrgModel(
            name=org_name,
            slug=unique_slug(db, org_name),
            plan="free",
            status="active",
            enrollment_key=new_enrollment_key(),
            provisioned=False,
        )
        db.add(org)
        db.flush()  # populate org.id

        # Stable per-org identifiers on the shared SOC stack. These are
        # what our queries filter by — generated up-front so they work
        # even before live provisioning runs.
        org.wazuh_agent_group = f"arena_org_{org.id}"
        org.thehive_org_name = org.slug
        org.shuffle_tag = f"arena_org_{org.id}"

        db.add(OrgMem(
            organization_id=org.id,
            user_id=new_user.id,
            role="owner",
        ))
        db.commit()
        db.refresh(new_user)
    except Exception:
        db.rollback()
        raise

    # Best-effort live provisioning against Wazuh/TheHive. Gated by env
    # flag because the SOC stack might not be reachable at signup time.
    try:
        if os.getenv("PROVISIONING_ENABLED", "false").lower() == "true":
            from tenant_provisioning import provision_tenant
            provision_tenant(db, org)
    except Exception as exc:
        # Don't fail signup — the org row exists, owner can retry
        # provisioning from /settings/organization later.
        print(f"WARN: signup provisioning failed for org {org.id}: {exc}")

    return new_user

@app.post("/api/auth/login", response_model=Token, tags=["Authentication"])
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    """Authenticate and return access token or 2FA challenge"""
    user = authenticate_user(db, user_data.email, user_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if user.is_2fa_enabled:
        # Generate 6-digit OTP
        otp = "".join([str(random.randint(0, 9)) for _ in range(6)])
        user.email_otp = otp
        user.email_otp_expiry = datetime.utcnow() + timedelta(minutes=10)
        db.commit()
        
        # Simulate sending email
        print(f"\n[SECURITY] 2FA Code for {user.email}: {otp} (Expires in 10m)\n")
        
        return {
            "require_2fa": True, 
            "user_id": user.id,
            "access_token": None,
            "token_type": None
        }
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "require_2fa": False, "user_id": user.id}

@app.get("/api/auth/me", response_model=UserResponse, tags=["Authentication"])
def read_users_me(current_user: User = Depends(get_current_user)):
    """Get currently logged in operator profile"""
    return current_user

@app.post("/api/crawl", tags=["Web Tools"])
def web_crawler(request: CrawlRequest, current_user: User = Depends(get_current_user)):
    """Crawl a website and extract detailed mapping intelligence with depth perception and stealth"""
    try:
        url = validate_url(request.url)
        max_depth = min(request.depth, 3) 
        ua = request.user_agent or "CyberArena-SecurityScanner/1.0"
        pattern = None
        if request.search_pattern:
            try:
                pattern = re.compile(request.search_pattern, re.IGNORECASE)
            except:
                raise HTTPException(status_code=400, detail="Invalid Regex Pattern")
        
        print(f"DEBUG: Initializing Professional Crawler on {url} (Depth: {max_depth}, Pattern: {request.search_pattern})")
        
        headers = {'User-Agent': ua}
        results_links = []
        assets = []
        findings = []
        seen_urls = set()
        
        def process_page(current_url, current_depth):
            if current_depth > max_depth or current_url in seen_urls:
                return
            
            # Stealth delay
            if request.delay > 0 and len(seen_urls) > 0:
                time.sleep(request.delay)
            
            seen_urls.add(current_url)
            try:
                resp = requests.get(current_url, headers=headers, timeout=10, verify=False)
                if resp.status_code != 200: return
                
                soup = BeautifulSoup(resp.text, 'html.parser')
                page_text = soup.get_text()
                base_domain = url.split("//")[-1].split("/")[0]
                
                # Pattern Matching (Deep Search)
                if pattern:
                    matches = pattern.findall(page_text)
                    for match in set(matches):
                        findings.append({"match": match, "url": current_url, "context": "Page Content"})
                
                # Extract Links
                for a in soup.find_all('a', href=True):
                    href = a['href']
                    text = a.get_text(strip=True) or "No Anchor Text"
                    
                    full_link = href
                    link_type = "external"
                    
                    if href.startswith('/'):
                        full_link = url.rstrip('/') + href
                        link_type = "internal"
                    elif base_domain in href:
                        link_type = "internal"
                    elif href.startswith('#') or href.startswith('javascript:'):
                        continue
                        
                    results_links.append({"url": full_link, "text": text[:50], "type": link_type, "depth": current_depth})
                    
                    # Recursively crawl internal links
                    if link_type == "internal" and current_depth < max_depth:
                        process_page(full_link, current_depth + 1)

                # Extract Assets (if requested)
                if request.extract_assets:
                    for img in soup.find_all('img', src=True):
                        src = img['src']
                        if not src.startswith('http'): src = url.rstrip('/') + (src if src.startswith('/') else '/' + src)
                        assets.append({"url": src, "type": "image"})
                    for script in soup.find_all('script', src=True):
                        src = script['src']
                        if not src.startswith('http'): src = url.rstrip('/') + (src if src.startswith('/') else '/' + src)
                        assets.append({"url": src, "type": "script"})
                    for link in soup.find_all('link', rel='stylesheet'):
                        href = link.get('href')
                        if href:
                            if not href.startswith('http'): href = url.rstrip('/') + (href if href.startswith('/') else '/' + href)
                            assets.append({"url": href, "type": "style"})

            except Exception as e:
                print(f"DEBUG: Failed to process {current_url}: {str(e)}")

        process_page(url, 1)
        
        # Unique everything
        unique_links = []
        l_seen = set()
        for l in results_links:
            if l['url'] not in l_seen:
                l_seen.add(l['url'])
                unique_links.append(l)
                
        unique_assets = []
        a_seen = set()
        for a in assets:
            if a['url'] not in a_seen:
                a_seen.add(a['url'])
                unique_assets.append(a)
        
        unique_findings = []
        f_seen = set()
        for f in findings:
            key = (f['match'], f['url'])
            if key not in f_seen:
                f_seen.add(key)
                unique_findings.append(f)

        # Get core metadata from initial page
        first_resp = requests.get(url, headers=headers, timeout=10, verify=False)
        first_soup = BeautifulSoup(first_resp.text, 'html.parser')
        
        return {
            "status": "success",
            "url": url,
            "metadata": {
                "title": first_soup.title.string if first_soup.title else "N/A",
                "server": first_resp.headers.get('Server', 'Hidden'),
                "status_code": first_resp.status_code
            },
            "links_found": len(unique_links),
            "links": unique_links[:150], 
            "assets_found": len(unique_assets),
            "assets": unique_assets[:50],
            "findings_found": len(unique_findings),
            "findings": unique_findings[:100]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Professional Crawler Error: {str(e)}")

# --- Vulnerability Scanner ---
@app.post("/api/vuln-scan", tags=["Web Tools"])
def vuln_scan(
    request: CrawlRequest, 
    no_ping: bool = Query(False, description="Whether to skip host discovery (-Pn)"),
    current_user: User = Depends(get_current_user)
):
    """Run a real vulnerability scan using Nmap's vuln NSE scripts."""
    if not shutil.which("nmap"):
        raise HTTPException(
            status_code=503,
            detail="nmap binary not installed on server. Install with: sudo apt install nmap",
        )
    try:
        target = request.url.replace("http://", "").replace("https://", "").split("/")[0]
        target = validate_host(target)
        print(f"DEBUG: Initializing Vuln Scan on {target}")
        
        nm = nmap.PortScanner()
        # Scan top ports with version detection and vuln scripts
        args = "-F -sV --script vuln"
        if no_ping:
            args += " -Pn"
        nm.scan(target, arguments=args)
        
        vulns = []
        if nm.all_hosts():
            host = nm.all_hosts()[0]
            
            # Check host scripts
            if 'hostscript' in nm[host]:
                for script in nm[host]['hostscript']:
                    if 'vuln' in script['id'] or 'cve' in script['id'].lower():
                        vulns.append({
                            "severity": "High" if "vuln" in script['id'] else "Medium",
                            "name": script['id'],
                            "path": "Host Level",
                            "description": script['output'][:200] + "..." if len(script['output']) > 200 else script['output']
                        })
            
            # Check port scripts
            for proto in nm[host].all_protocols():
                for port in nm[host][proto]:
                    port_data = nm[host][proto][port]
                    if 'script' in port_data:
                        for script_id, script_output in port_data['script'].items():
                            severity = "Info"
                            if "vuln" in script_id or "cve" in script_id.lower() or "exploit" in script_output.lower():
                                severity = "High"
                            elif "dos" in script_id or "leak" in script_id:
                                severity = "Medium"
                                
                            vulns.append({
                                "severity": severity,
                                "name": script_id,
                                "path": f"Port {port}/{proto} ({port_data.get('name', 'unknown')})",
                                "description": script_output[:200] + "..." if len(script_output) > 200 else script_output
                            })
                            
        host_reachable = bool(nm.all_hosts())
        message = (
            "Target is up, but no NSE vuln-script findings."
            if host_reachable and not vulns
            else "Host appears down or blocking ICMP/probes."
            if not host_reachable
            else None
        )

        return record_scan(
            "vuln-scan", target,
            {
                "status": "success" if host_reachable else "no_host",
                "target": target,
                "host_reachable": host_reachable,
                "message": message,
                "vulnerabilities": vulns,
            },
            current_user,
        )
        
    except Exception as e:
        print(f"ERROR: Vuln scan failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Vuln Scanner Engine Error: {str(e)}")


import socket

# --- Subdomain Enumeration ---
class SubdomainRequest(BaseModel):
    domain: str
    resolve_ips: bool = False

from subdomain_sources import discover as _discover_subdomains


@app.post("/api/subdomains", tags=["Web Tools"])
def subdomain_enum(request: SubdomainRequest, current_user: User = Depends(get_current_user)):
    """Multi-source subdomain reconnaissance.

    Queries crt.sh, HackerTarget, AlienVault OTX, RapidDNS, Wayback Machine, and
    subfinder in parallel; merges results. Resilient to any individual source
    being down/rate-limited.
    """
    try:
        domain = request.domain.replace("http://", "").replace("https://", "").split("/")[0]
        domain = validate_host(domain)
        print(f"DEBUG: Subdomain recon on {domain} (Resolve: {request.resolve_ips})")

        all_set, source_counts, source_errors = _discover_subdomains(domain)
        sources = [name for name, n in source_counts.items() if n > 0]

        unique_subdomains = sorted(all_set)
        if not unique_subdomains:
            print("DEBUG: No subdomain sources returned data; using minimal stub.")
            unique_subdomains = [f"www.{domain}", f"mail.{domain}"]
            sources = ["stub"]

        unique_subdomains = unique_subdomains[:150]

        # Resolve in parallel — sequential socket.gethostbyname() blocks the
        # request worker for the full sum of DNS RTTs (often 30s+ on 150
        # records). A small thread pool with per-call timeouts is dramatic.
        def _resolve(sub: str):
            if not request.resolve_ips:
                return sub, "N/A", "unknown"
            try:
                ip = socket.gethostbyname(sub)
                return sub, ip, "active"
            except Exception:
                return sub, "N/A", "inactive"

        results = []
        if request.resolve_ips:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=32) as ex:
                for sub, ip, status in ex.map(_resolve, unique_subdomains):
                    results.append({"subdomain": sub, "ip": ip, "status": status})
        else:
            results = [{"subdomain": s, "ip": "N/A", "status": "unknown"}
                       for s in unique_subdomains]

        return record_scan("subdomains", domain, {
            "status": "success",
            "domain": domain,
            "engine": "+".join(sources) if sources else "stub",
            "sources": sources,
            "source_counts": source_counts,
            "source_errors": source_errors,
            "count": len(results),
            "subdomains": results,
        }, current_user)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Subdomain Engine Error: {str(e)}")
from fastapi.responses import Response


# ---------------------------------------------------------------------------
# Scan history & PDF report endpoints
# ---------------------------------------------------------------------------
@app.get("/api/v1/scans", tags=["Reports"])
def list_scans(
    limit: int = Query(50, le=200),
    tool: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_org=Depends(get_current_org),
):
    """List the current org's scan history (newest first).

    Multi-tenant: every member of the same organization sees the same
    history so they can collaborate. Cross-org data is never returned.
    """
    q = db.query(Scan).filter(Scan.organization_id == current_org.id)
    if tool:
        q = q.filter(Scan.tool == tool)
    rows = q.order_by(Scan.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "tool": r.tool,
            "tool_label": va.tool_label(r.tool),
            "target": r.target,
            "engine": r.engine,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "risk_score": r.risk_score,
            "risk_label": va.risk_label(r.risk_score or 0),
            "severity_counts": json.loads(r.severity_counts_json or "{}"),
            "summary": r.summary,
        }
        for r in rows
    ]


@app.get("/api/v1/scans/{scan_id}", tags=["Reports"])
def get_scan(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_org=Depends(get_current_org),
):
    """Return a single scan with its full normalized findings."""
    row = db.query(Scan).filter(Scan.id == scan_id, Scan.organization_id == current_org.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {
        "id": row.id,
        "tool": row.tool,
        "tool_label": va.tool_label(row.tool),
        "target": row.target,
        "engine": row.engine,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "risk_score": row.risk_score,
        "risk_label": va.risk_label(row.risk_score or 0),
        "severity_counts": json.loads(row.severity_counts_json or "{}"),
        "findings": json.loads(row.findings_json or "[]"),
        "summary": row.summary,
        "raw": json.loads(row.raw_json or "null"),
    }


@app.delete("/api/v1/scans/{scan_id}", tags=["Reports"])
def delete_scan(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_org=Depends(get_current_org),
):
    row = db.query(Scan).filter(Scan.id == scan_id, Scan.organization_id == current_org.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Scan not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": scan_id}


@app.get("/api/v1/scans/{scan_id}/report.pdf", tags=["Reports"])
def download_scan_report(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_org=Depends(get_current_org),
):
    """Generate and download a PDF report for a stored scan."""
    row = db.query(Scan).filter(Scan.id == scan_id, Scan.organization_id == current_org.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Scan not found")
    pdf_bytes = render_scan_pdf(row, current_user)
    safe_target = re.sub(r"[^A-Za-z0-9._-]+", "_", row.target)[:60]
    filename = f"cyber_arena_{row.tool}_{safe_target}_{row.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Tool availability health probe ----------------------------------------
# Tells the frontend which binaries are actually installed so we can dim the
# tile / surface a "not installed" hint instead of letting the user click and
# get a 503. Probed lazily on each call (cheap; just shutil.which).
_TOOL_BINARIES = {
    "nmap":        ["nmap"],
    "nikto":       ["nikto"],
    "vuln-scan":   ["nmap"],
    "nuclei":      ["nuclei"],
    "directories": ["gobuster"],
    "ffuf":        ["ffuf"],
    "sqlmap":      ["sqlmap"],
    "subdomains":  [],   # pure-python (subdomain_sources)
    "crawl":       [],
    "traffic":     [],
}


@app.get("/api/v1/tools/health", tags=["Scanners"])
def tools_health(current_user: User = Depends(get_current_user)):
    """Return per-tool binary availability for the frontend tools catalogue."""
    out = {}
    for key, bins in _TOOL_BINARIES.items():
        missing = [b for b in bins if not shutil.which(b)]
        out[key] = {
            "available": not missing,
            "binaries": bins,
            "missing":  missing,
        }
    return {"tools": out, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

# --- Subdomain Enumeration ---

# --- Nuclei Vulnerability Scanner (real binary) -----------------------------
class NucleiRequest(BaseModel):
    target: str
    severity: str = "low,medium,high,critical"   # comma-separated; matches nuclei -severity
    tags: str = ""                                # optional comma-separated tag filter
    timeout: int = 180                            # seconds


def _truncate(s: str, n: int = 600) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[:n] + "...[truncated]"


@app.post("/api/v1/nuclei", tags=["Scanners"])
def nuclei_scanner(
    request: NucleiRequest,
    current_user: User = Depends(get_current_user),
    _f = Depends(require_feature("nuclei")),
):
    """Run the Nuclei template-based vulnerability scanner against a target.

    Nuclei (https://github.com/projectdiscovery/nuclei) ships ~9000 community-
    maintained templates covering CVEs, misconfigurations, exposed panels,
    default credentials, etc. — the same use cases as OpenVAS NVTs but faster
    and simpler to deploy.
    """
    target_url = validate_url(request.target or "")
    # Severity filter is spliced into argv — accept only the official set.
    sev_set = {"info", "low", "medium", "high", "critical", "unknown"}
    parts = [p.strip().lower() for p in (request.severity or "").split(",") if p.strip()]
    bad = [p for p in parts if p not in sev_set]
    if bad:
        raise HTTPException(status_code=400, detail=f"Invalid severity values: {bad}")
    severity_arg = ",".join(parts) if parts else "low,medium,high,critical"
    tags_arg = safe_arg(request.tags, "tags") if request.tags else ""

    safety_timeout = max(30, min(int(request.timeout or 180), 600))

    cmd = [
        "nuclei",
        "-u", target_url,
        "-jsonl",
        "-silent",
        "-disable-update-check",
        "-no-color",
        "-rate-limit", "150",
        "-c", "25",                     # concurrency
        "-timeout", "10",
        "-severity", severity_arg,
    ]
    if tags_arg:
        cmd += ["-tags", tags_arg]

    findings: list[dict] = []
    raw_lines: list[str] = []
    error: str | None = None

    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=safety_timeout,
        )
    except FileNotFoundError:
        error = "nuclei binary not installed on server"
        proc = None
    except subprocess.TimeoutExpired as e:
        error = f"nuclei timed out after {safety_timeout}s"
        proc = e  # has .stdout/.stderr attrs

    if proc is not None and getattr(proc, "stdout", None):
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            raw_lines.append(line)
            try:
                d = json.loads(line)
            except Exception:
                continue
            info = d.get("info", {}) or {}
            severity = (info.get("severity") or "info").upper()
            # Pick the most informative evidence we can get without
            # blowing up the row size: prefer extracted matcher hits,
            # then matcher names, then a bounded slice of the response.
            extracted = d.get("extracted-results") or []
            if extracted:
                evidence = ", ".join(str(x) for x in extracted[:5])
            else:
                evidence = d.get("matcher-name") or d.get("response", "") or ""
            findings.append({
                "template_id":   d.get("template-id") or d.get("template_id"),
                "name":          info.get("name") or d.get("template-id"),
                "severity":      severity,
                "description":   _truncate(info.get("description") or "", 600),
                "tags":          info.get("tags") or [],
                "reference":     info.get("reference") or [],
                "url":           d.get("matched-at") or d.get("host") or target_url,
                "matcher":       d.get("matcher-name"),
                "type":          d.get("type"),
                "evidence":      _truncate(str(evidence), 800),
                "classification": info.get("classification") or {},
            })

    response = {
        "status": "success" if not error else "partial",
        "target": target_url,
        "engine": "nuclei-binary",
        "templates": "default (community)",
        "severity_filter": request.severity,
        "tags_filter": request.tags or None,
        "count": len(findings),
        "findings": findings,
        "error": error,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return record_scan("nuclei", target_url, response, current_user,
                       status="partial" if error else "success")

# --- Directory Enumeration (Real) ---
# Path (Status: NNN) [Size: NNN]   — works for gobuster v1 and v3.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\[\??\d+[A-Za-z]")
_GOBUSTER_LINE = re.compile(
    r"(?P<path>/\S+)\s+\(Status:\s*(?P<status>\d{3})\)(?:\s+\[Size:\s*(?P<size>\d+)\])?"
)


def _run_gobuster(url: str, wordlist: str, timeout: int = 180):
    """Try gobuster v3+ syntax, fall back to v1 syntax. Returns CompletedProcess or raises."""
    v3_cmd = ["gobuster", "dir", "-u", url, "-w", wordlist,
              "-q", "--no-error", "--timeout", "5s", "-t", "30"]
    v1_cmd = ["gobuster", "-m", "dir", "-u", url, "-w", wordlist,
              "-q", "-t", "30", "-to", "5s"]
    proc = subprocess.run(v3_cmd, capture_output=True, text=True, timeout=timeout)
    needs_fallback = (
        proc.returncode != 0
        and ("flag provided but not defined" in (proc.stderr + proc.stdout)
             or "unknown command" in (proc.stderr + proc.stdout)
             or "WordList (-w): Must be specified" in (proc.stderr + proc.stdout))
    )
    if needs_fallback:
        proc = subprocess.run(v1_cmd, capture_output=True, text=True, timeout=timeout)
    return proc


@app.post("/api/directories", tags=["Web Tools"])
def dir_enum(request: CrawlRequest, current_user: User = Depends(get_current_user)):
    """Run real directory enumeration via gobuster."""
    if not shutil.which("gobuster"):
        raise HTTPException(
            status_code=503,
            detail="gobuster binary not installed on server. Install with: sudo apt install gobuster",
        )
    url = validate_url(request.url)
    wordlist_path = get_wordlist_path("common")
    try:
        process = _run_gobuster(url, wordlist_path)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="gobuster timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gobuster execution failed: {e}")

    directories = []
    # gobuster v1 prefixes ANSI escapes ([2K) on each line — strip them.
    for line in process.stdout.splitlines():
        clean = _ANSI_RE.sub("", line).strip()
        m = _GOBUSTER_LINE.search(clean)
        if not m:
            continue
        directories.append({
            "path": m.group("path"),
            "status": m.group("status"),
            "size": int(m.group("size")) if m.group("size") else None,
            "full_url": url.rstrip('/') + m.group("path"),
        })

    return record_scan("directories", url, {
        "status": "success",
        "target": url,
        "count": len(directories),
        "directories": directories,
        "engine": "gobuster-binary",
        "wordlist": os.path.basename(wordlist_path),
    }, current_user)

# --- Traffic Analyzer (real OS-level network introspection) -----------------
# State labels for /proc/net/{tcp,udp} (hex codes used by the Linux kernel)
_TCP_STATES = {
    "01": "ESTABLISHED", "02": "SYN_SENT",   "03": "SYN_RECV",
    "04": "FIN_WAIT1",   "05": "FIN_WAIT2",  "06": "TIME_WAIT",
    "07": "CLOSE",       "08": "CLOSE_WAIT", "09": "LAST_ACK",
    "0A": "LISTEN",      "0B": "CLOSING",    "0C": "NEW_SYN_RECV",
}


def _hex_to_ipv4(h: str) -> str:
    # /proc/net stores IPv4 in little-endian hex e.g. "0100007F" => 127.0.0.1
    try:
        b = bytes.fromhex(h)
        return ".".join(str(b[i]) for i in (3, 2, 1, 0))
    except Exception:
        return h


def _hex_to_ipv6(h: str) -> str:
    # IPv6 stored as 32 hex chars in little-endian per 32-bit word
    try:
        words = [h[i:i+8] for i in range(0, 32, 8)]
        # reverse byte order within each 32-bit word, concat, then format
        rev = "".join(bytes.fromhex(w)[::-1].hex() for w in words)
        groups = [rev[i:i+4] for i in range(0, 32, 4)]
        return ":".join(groups)
    except Exception:
        return h


def _parse_net_file(path: str, ipv6: bool, proto: str):
    rows = []
    try:
        with open(path) as f:
            lines = f.readlines()[1:]  # skip header
    except FileNotFoundError:
        return rows
    for line in lines:
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[1]
        remote = parts[2]
        state = parts[3].upper() if proto == "TCP" else "—"
        try:
            l_ip, l_port = local.rsplit(":", 1)
            r_ip, r_port = remote.rsplit(":", 1)
            l_port = int(l_port, 16)
            r_port = int(r_port, 16)
            l_ip = _hex_to_ipv6(l_ip) if ipv6 else _hex_to_ipv4(l_ip)
            r_ip = _hex_to_ipv6(r_ip) if ipv6 else _hex_to_ipv4(r_ip)
        except Exception:
            continue
        rows.append({
            "protocol": proto + ("6" if ipv6 else ""),
            "source": f"{l_ip}:{l_port}",
            "destination": f"{r_ip}:{r_port}",
            "state": _TCP_STATES.get(state, state) if proto == "TCP" else "—",
        })
    return rows


def _read_iface_stats():
    """Parse /proc/net/dev — returns dict iface -> (rx_bytes, tx_bytes, rx_pkts, tx_pkts)."""
    out = {}
    try:
        with open("/proc/net/dev") as f:
            for line in f.readlines()[2:]:
                if ":" not in line:
                    continue
                name, rest = line.split(":", 1)
                name = name.strip()
                cols = rest.split()
                # rx: bytes packets errs drop fifo frame compressed multicast
                # tx: bytes packets errs drop fifo colls carrier compressed
                if len(cols) < 16:
                    continue
                out[name] = (int(cols[0]), int(cols[8]), int(cols[1]), int(cols[9]))
    except FileNotFoundError:
        pass
    return out


@app.get("/api/analyze", tags=["Network"])
def analyze_traffic(
    sample_seconds: float = Query(0.5, ge=0.1, le=3.0),
    limit: int = Query(50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
):
    """Real OS-level network analyzer.

    Reads `/proc/net/{tcp,tcp6,udp,udp6}` for live socket connections and
    samples `/proc/net/dev` twice over `sample_seconds` to compute real
    interface bandwidth (kbps) and packet rates. No root needed.
    """
    # 1) Live connections
    connections: list[dict] = []
    for path, ipv6, proto in [
        ("/proc/net/tcp",  False, "TCP"),
        ("/proc/net/tcp6", True,  "TCP"),
        ("/proc/net/udp",  False, "UDP"),
        ("/proc/net/udp6", True,  "UDP"),
    ]:
        connections.extend(_parse_net_file(path, ipv6, proto))

    # Sort: ESTABLISHED first, then by protocol
    connections.sort(key=lambda c: (0 if c["state"] == "ESTABLISHED" else 1, c["protocol"]))
    connections = connections[:limit]

    # 2) Bandwidth/packet rate sample
    s1 = _read_iface_stats()
    time.sleep(sample_seconds)
    s2 = _read_iface_stats()

    iface_stats = []
    total_rx_bps = total_tx_bps = total_rx_pps = total_tx_pps = 0.0
    for name in sorted(s2):
        if name not in s1 or name == "lo":
            continue
        d_rx = (s2[name][0] - s1[name][0]) / sample_seconds
        d_tx = (s2[name][1] - s1[name][1]) / sample_seconds
        d_rxp = (s2[name][2] - s1[name][2]) / sample_seconds
        d_txp = (s2[name][3] - s1[name][3]) / sample_seconds
        iface_stats.append({
            "iface": name,
            "rx_kbps": round(d_rx * 8 / 1000, 2),
            "tx_kbps": round(d_tx * 8 / 1000, 2),
            "rx_pps":  round(d_rxp, 1),
            "tx_pps":  round(d_txp, 1),
            "rx_bytes_total": s2[name][0],
            "tx_bytes_total": s2[name][1],
        })
        total_rx_bps += d_rx
        total_tx_bps += d_tx
        total_rx_pps += d_rxp
        total_tx_pps += d_txp

    # 3) Stats summary
    state_counts: dict[str, int] = {}
    proto_counts: dict[str, int] = {}
    for c in connections:
        state_counts[c["state"]] = state_counts.get(c["state"], 0) + 1
        proto_counts[c["protocol"]] = proto_counts.get(c["protocol"], 0) + 1

    return {
        "status": "success",
        "engine": "proc-net-real",
        "sample_seconds": sample_seconds,
        "data": connections,           # backwards-compatible field name for the UI
        "connections": connections,
        "interfaces": iface_stats,
        "stats": {
            "rx_kbps": round(total_rx_bps * 8 / 1000, 2),
            "tx_kbps": round(total_tx_bps * 8 / 1000, 2),
            "packets_sec": round(total_rx_pps + total_tx_pps, 1),
            "connection_count": len(connections),
            "state_counts": state_counts,
            "protocol_counts": proto_counts,
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

# --- FFUF Fuzzer ---
class FfufRequest(BaseModel):
    url: str
    wordlist: str = "common"
    method: str = "GET"
    filter_status: str = "404"
    threads: int = 40
    data: str = ""

@app.post("/api/v1/ffuf", tags=["Scanners"])
def ffuf_scanner(request: FfufRequest, current_user: User = Depends(get_current_user)):
    """Run a real FFUF web fuzzer scan. Requires the ffuf binary."""
    if not shutil.which("ffuf"):
        raise HTTPException(
            status_code=503,
            detail="ffuf binary not installed on server. Install with: sudo apt install ffuf",
        )
    url = validate_url(request.url, require_fuzz=("FUZZ" in (request.url or "")))
    if "FUZZ" not in url and not request.data:
        raise HTTPException(status_code=400, detail="URL must contain the 'FUZZ' keyword")

    # Whitelist user-provided fields that get spliced into argv.
    method = safe_arg(
        (request.method or "GET").upper(), "method",
        allowed={"GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS", "PATCH"},
    )
    # filter_status accepts a comma-separated list of HTTP codes.
    fc = (request.filter_status or "404").strip()
    if not re.fullmatch(r"\d{3}(?:,\d{3})*", fc):
        raise HTTPException(status_code=400, detail="filter_status must be comma-separated HTTP codes")
    # Wordlist must resolve to a file we ship — get_wordlist_path falls back
    # to common.txt if unknown, but prevent path-traversal-style names.
    wl_name = safe_arg(request.wordlist or "common", "wordlist")
    wordlist_path = get_wordlist_path(wl_name)

    import tempfile
    output_fd, output_file = tempfile.mkstemp(prefix="ffuf_", suffix=".json")
    os.close(output_fd)
    cmd = [
        "ffuf", "-u", url, "-w", wordlist_path,
        "-t", str(max(1, min(int(request.threads or 40), 100))),
        "-mc", "all",
        "-fc", fc,
        "-o", output_file, "-of", "json", "-s",
    ]
    if method != "GET":
        cmd += ["-X", method]
    if request.data:
        # ffuf -d takes a literal body; we pass via argv (no shell), so the
        # only worry here is shell metacharacters in logs — which are safe.
        cmd += ["-d", request.data[:4096]]

    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        with open(output_file, "r") as f:
            ffuf_data = json.load(f)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="ffuf timed out")
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"ffuf produced no output file: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FFUF execution failed: {e}")
    finally:
        try:
            os.unlink(output_file)
        except OSError:
            pass

    results = [
        {
            "input": r.get("input", {}).get("FUZZ", ""),
            "status": r.get("status", 0),
            "length": r.get("length", 0),
            "words": r.get("words", 0),
            "lines": r.get("lines", 0),
        }
        for r in ffuf_data.get("results", [])
    ]
    return record_scan("ffuf", url, {
        "status": "success", "target": url, "results": results,
        "engine": "ffuf-binary", "wordlist": os.path.basename(wordlist_path),
    }, current_user)


# --- SQLMap Scanner ---
class SQLMapRequest(BaseModel):
    url: str
    data: str = ""
    level: int = 1
    risk: int = 1
    dbms: str = ""

@app.post("/api/sqlmap", tags=["Scanners"])
def sqlmap_scanner(
    request: SQLMapRequest,
    current_user: User = Depends(get_current_user),
    _f = Depends(require_feature("sqlmap")),
):
    """Run a real SQLMap SQL-injection scan. Requires the sqlmap binary."""
    if not shutil.which("sqlmap"):
        raise HTTPException(
            status_code=503,
            detail="sqlmap binary not installed on server. Install with: sudo apt install sqlmap (or pipx install sqlmap)",
        )
    try:
        url = validate_url(request.url)
        try:
            level = max(1, min(int(request.level or 1), 5))
            risk = max(1, min(int(request.risk or 1), 3))
            cmd = [
                "sqlmap", "-u", url, "--batch", "--disable-coloring",
                "--level", str(level), "--risk", str(risk), "--random-agent",
            ]
            if request.data:
                cmd += ["--data", request.data[:4096]]
            if request.dbms:
                # Accept only documented DBMS names.
                allowed_dbms = {
                    "mysql", "postgresql", "mssql", "oracle", "sqlite",
                    "access", "firebird", "sybase", "sap maxdb", "db2",
                    "informix", "hsqldb",
                }
                cmd += ["--dbms", safe_arg(request.dbms.lower(), "dbms", allowed=allowed_dbms)]
            process = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            stdout = process.stdout or ""

            # Parse sqlmap output. Reliable signals:
            #  - "Parameter: <name> (<location>)"  → vulnerable param
            #  - "Type: <technique>"
            #  - "Title: <title>"
            #  - "Payload: <payload>"
            #  - "is vulnerable"  / "the back-end DBMS is <name>"
            vulns = []
            current = None
            param_re = re.compile(r"Parameter:\s*([^\s(]+)\s*\(([^)]+)\)")
            for raw in stdout.splitlines():
                line = raw.strip()
                m = param_re.search(line)
                if m:
                    if current:
                        vulns.append(current)
                    current = {
                        "parameter": m.group(1),
                        "location": m.group(2),
                        "type": None, "title": None, "payload": None,
                    }
                    continue
                if current is None:
                    continue
                if line.startswith("Type:"):
                    current["type"] = line.split(":", 1)[1].strip()
                elif line.startswith("Title:"):
                    current["title"] = line.split(":", 1)[1].strip()
                elif line.startswith("Payload:"):
                    current["payload"] = line.split(":", 1)[1].strip()
            if current:
                vulns.append(current)

            dbms_match = re.search(r"back-end DBMS:\s*([^\n\r]+)", stdout)
            dbms = dbms_match.group(1).strip() if dbms_match else None

            # Only trust the parsed parameter blocks. The substring check
            # "is vulnerable" matches sqlmap banner/help text and produced
            # false positives on completed-but-clean targets.
            is_vulnerable = bool(vulns)
            return record_scan("sqlmap", url, {
                "status": "success",
                "target": url,
                "vulnerable": is_vulnerable,
                "vulnerabilities": vulns,
                "dbms": dbms,
                "raw_output": stdout[-4000:],
                "engine": "sqlmap-binary",
            }, current_user)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="sqlmap timed out (5 minute limit)")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"SQLMap execution failed: {e}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQLMap Engine Error: {str(e)}")


@app.get("/", tags=["Health"])
def health_check():
    return {"status": "online", "message": "Cyber Arena Systems are Operational"}

# --- Profile Management ---
@app.put("/api/v1/profile", response_model=UserResponse, tags=["Profile"])
def update_profile(
    profile_data: UserUpdate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Update operator profile information"""
    for field, value in profile_data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    
    db.commit()
    db.refresh(current_user)
    return current_user

# --- Encrypted Chat (Backend Logic) ---
@app.post("/api/v1/chat/send", response_model=MessageResponse, tags=["Chat"])
def send_message(
    message: MessageCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Send an encrypted message to another operator"""
    from models import Message as MessageModel
    db_message = MessageModel(
        sender_id=current_user.id,
        recipient_id=message.recipient_id,
        content=message.content,
        is_encrypted=True
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

@app.get("/api/v1/chat/history", response_model=List[MessageResponse], tags=["Chat"])
def get_chat_history(
    other_user_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Retrieve message history with another operator"""
    from models import Message as MessageModel
    from sqlalchemy import or_, and_
    
    messages = db.query(MessageModel).filter(
        or_(
            and_(MessageModel.sender_id == current_user.id, MessageModel.recipient_id == other_user_id),
            and_(MessageModel.sender_id == other_user_id, MessageModel.recipient_id == current_user.id)
        )
    ).order_by(MessageModel.timestamp.asc()).all()
    
    return messages

@app.get("/api/v1/users/search", response_model=List[UserResponse], tags=["Chat"])
def search_users(
    query: str = "", 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Search for other operators to start a conversation"""
    from sqlalchemy import or_, and_
    users = db.query(User).filter(
        and_(
            User.id != current_user.id,
            or_(User.username.contains(query), User.email.contains(query))
        )
    ).limit(10).all()
    return users

# --- Security Hardening: Password & 2FA ---

@app.put("/api/v1/profile/password", tags=["Security"])
def update_password(
    password_data: PasswordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update operator password with validation"""
    # 1. Verify current password
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    # 2. Check confirmation
    if password_data.new_password != password_data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    
    # 3. Validate complexity
    password = password_data.new_password
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    if not re.search(r'[A-Z]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r'[a-z]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not re.search(r'[0-9]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")
    if not re.search(r'[!@#$%^&*(),.?\":{}|<>]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one special character")
    
    # 4. Hash and save
    current_user.hashed_password = get_password_hash(password_data.new_password)
    db.add(current_user) # Explicitly add to session
    db.commit()
    db.refresh(current_user)
    
    return {"message": "Credentials updated successfully"}

@app.post("/api/v1/auth/2fa/setup", response_model=TwoFASetup, tags=["Security"])
def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enable Email 2FA for the operator"""
    current_user.is_2fa_enabled = True
    db.add(current_user)
    db.commit()
    
    return {
        "message": "Email-based two-factor authentication has been enabled.",
        "email": current_user.email
    }

@app.post("/api/v1/auth/2fa/verify", tags=["Security"])
def verify_2fa(
    verify_data: TwoFAVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify email OTP code (Not needed for setup in email version but kept for API compatibility)"""
    if not current_user.email_otp or not current_user.email_otp_expiry:
        raise HTTPException(status_code=400, detail="2FA not initiated")
    
    if datetime.utcnow() > current_user.email_otp_expiry:
        raise HTTPException(status_code=400, detail="Verification code expired")
    
    if verify_data.token != current_user.email_otp:
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    current_user.is_2fa_enabled = True
    db.commit()
    
    return {"message": "Two-factor authentication verified"}

@app.post("/api/v1/auth/2fa/disable", tags=["Security"])
def disable_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disable 2FA for the operator"""
    current_user.is_2fa_enabled = False
    current_user.totp_secret = None
    current_user.backup_codes = None
    db.commit()
    return {"message": "Two-factor authentication disabled"}

@app.post("/api/auth/2fa/login", response_model=Token, tags=["Authentication"])
def login_2fa(
    login_data: TwoFALogin,
    db: Session = Depends(get_db)
):
    """Complete 2FA login flow using Email OTP"""
    user = db.query(User).filter(User.id == login_data.user_id).first()
    if not user or not user.is_2fa_enabled:
        raise HTTPException(status_code=401, detail="Invalid login session")
    
    if not user.email_otp or not user.email_otp_expiry:
        raise HTTPException(status_code=401, detail="No active 2FA session")
    
    if datetime.utcnow() > user.email_otp_expiry:
        raise HTTPException(status_code=401, detail="Verification code expired")
    
    if login_data.token != user.email_otp:
        raise HTTPException(status_code=401, detail="Invalid security token")
    
    # Clear OTP after successful use
    user.email_otp = None
    user.email_otp_expiry = None
    
    db.commit()
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "require_2fa": False, "user_id": user.id}
