"""Vulnerability Assessment helpers.

Each scanner endpoint produces tool-specific output. This module:
  - Normalizes findings into a uniform schema:
      {severity, title, description, location, evidence, references}
  - Computes severity counts and a 0-100 risk score.
  - Provides per-tool mapper functions.

Severity vocabulary (uppercase, ordered):
    CRITICAL > HIGH > MEDIUM > LOW > INFO
"""
from __future__ import annotations
from typing import Any, Iterable

SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
SEVERITY_WEIGHTS = {"CRITICAL": 25, "HIGH": 12, "MEDIUM": 5, "LOW": 1, "INFO": 0}


# --------------------------------------------------------------------------- #
# Severity helpers
# --------------------------------------------------------------------------- #
def normalize_severity(value: Any) -> str:
    """Coerce a tool-specific severity (string or numeric CVSS) into our vocab."""
    if value is None:
        return "INFO"
    if isinstance(value, (int, float)):
        cvss = float(value)
        if cvss >= 9.0:
            return "CRITICAL"
        if cvss >= 7.0:
            return "HIGH"
        if cvss >= 4.0:
            return "MEDIUM"
        if cvss > 0:
            return "LOW"
        return "INFO"
    s = str(value).strip().upper()
    aliases = {
        "CRIT": "CRITICAL",
        "HIGH SEVERITY": "HIGH",
        "MED": "MEDIUM",
        "MODERATE": "MEDIUM",
        "WARNING": "LOW",
        "INFORMATIONAL": "INFO",
        "INFORMATION": "INFO",
        "NONE": "INFO",
    }
    if s in SEVERITIES:
        return s
    return aliases.get(s, "INFO")


def empty_counts() -> dict:
    return {sev: 0 for sev in SEVERITIES}


def severity_counts(findings: Iterable[dict]) -> dict:
    counts = empty_counts()
    for f in findings:
        sev = normalize_severity(f.get("severity"))
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def risk_score(counts: dict) -> float:
    """Weighted score capped at 100. Critical=25 each, High=12, Medium=5, Low=1, Info=0."""
    raw = sum(SEVERITY_WEIGHTS[sev] * counts.get(sev, 0) for sev in SEVERITIES)
    return float(min(100.0, raw))


def risk_label(score: float) -> str:
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MEDIUM"
    if score > 0:
        return "LOW"
    return "INFO"


def assess(findings: list[dict]) -> dict:
    counts = severity_counts(findings)
    score = risk_score(counts)
    return {
        "severity_counts": counts,
        "risk_score": score,
        "risk_label": risk_label(score),
        "total_findings": sum(counts.values()),
    }


# --------------------------------------------------------------------------- #
# Per-tool mappers — convert raw API response → list[normalized finding]
# --------------------------------------------------------------------------- #
def _f(severity: str, title: str, description: str = "",
       location: str = "", evidence: str = "", references: list[str] | None = None) -> dict:
    return {
        "severity": normalize_severity(severity),
        "title": title,
        "description": description,
        "location": location,
        "evidence": evidence,
        "references": references or [],
    }


def from_nmap(resp: dict) -> list[dict]:
    """Map /api/v1/nmap response. Each open port is INFO; vuln-script results promote severity."""
    findings: list[dict] = []
    for port_data in resp.get("data", []):
        port = port_data.get("port")
        service = port_data.get("service") or "unknown"
        version = (port_data.get("version") or "").strip()
        state = port_data.get("state", "")
        scripts = port_data.get("scripts") or {}

        location = f"{port}/tcp ({service})"
        title = f"Open port {port}/{service}"
        description = f"Service: {service}" + (f", version: {version}" if version else "") + f", state: {state}"

        if scripts:
            # Promote: any vuln/cve script reference = HIGH
            for sid, sout in scripts.items():
                low = (sid + " " + str(sout)).lower()
                sev = "HIGH" if ("vuln" in low or "cve" in low) else "INFO"
                findings.append(_f(
                    sev,
                    f"NSE script {sid} on {location}",
                    str(sout)[:1000],
                    location,
                    str(sout)[:500],
                ))
        else:
            findings.append(_f("INFO", title, description, location))
    return findings


def from_vuln_scan(resp: dict) -> list[dict]:
    """Map /api/vuln-scan response (already partially structured)."""
    out = []
    for v in resp.get("vulnerabilities", []):
        out.append(_f(
            v.get("severity", "INFO"),
            v.get("name", "Vulnerability"),
            v.get("description", ""),
            v.get("path", ""),
        ))
    return out


def from_nikto(resp: dict) -> list[dict]:
    out = []
    for f in resp.get("findings", []):
        out.append(_f(
            f.get("severity", "INFO"),
            f.get("msg", "Nikto finding"),
            f.get("msg", ""),
            f.get("path", "/"),
        ))
    return out


def from_nuclei(resp: dict) -> list[dict]:
    """Map /api/v1/nuclei response into normalized findings."""
    out = []
    for f in resp.get("findings", []):
        out.append(_f(
            f.get("severity", "INFO"),
            f.get("name") or f.get("template_id") or "Nuclei finding",
            f.get("description", ""),
            f.get("url") or "",
            f.get("evidence", ""),
            list(f.get("reference") or []),
        ))
    return out


def from_directories(resp: dict) -> list[dict]:
    """Each discovered directory → LOW (sensitive paths get MEDIUM/HIGH)."""
    out = []
    for d in resp.get("directories", []):
        path = d.get("path", "/")
        status = str(d.get("status", ""))
        low = path.lower()
        sev = "LOW"
        if any(k in low for k in ("/admin", "/config", "/.git", "/.env", "/backup", "/wp-config", "/phpmyadmin")):
            sev = "MEDIUM"
        if status.startswith("2"):  # accessible 2xx is worse
            sev = {"LOW": "LOW", "MEDIUM": "HIGH"}[sev]
        out.append(_f(
            sev,
            f"Discovered path {path} ({status})",
            f"HTTP {status} response observed during directory enumeration.",
            d.get("full_url", path),
        ))
    return out


def from_ffuf(resp: dict) -> list[dict]:
    out = []
    for r in resp.get("results", []):
        inp = r.get("input", "")
        status = str(r.get("status", ""))
        sev = "LOW"
        if status.startswith("2"):
            sev = "MEDIUM"
        out.append(_f(
            sev,
            f"FFUF hit /{inp} ({status})",
            f"Length={r.get('length')}, words={r.get('words')}, lines={r.get('lines')}",
            f"/{inp}",
        ))
    return out


def from_sqlmap(resp: dict) -> list[dict]:
    out = []
    if resp.get("vulnerable"):
        for v in resp.get("vulnerabilities", []) or []:
            out.append(_f(
                "CRITICAL",
                f"SQL Injection in parameter '{v.get('parameter')}'",
                f"Type: {v.get('type')}\nTitle: {v.get('title')}",
                v.get("location", ""),
                v.get("payload", ""),
            ))
        if not out:
            # vulnerable=True but no parsed details
            out.append(_f("HIGH", "SQL injection signal detected",
                          "sqlmap reported the target is vulnerable but no parameter detail was parsed.",
                          resp.get("target", "")))
    else:
        out.append(_f("INFO", "No SQL injection detected",
                      "sqlmap completed without reporting any vulnerable parameter.",
                      resp.get("target", "")))
    return out


def from_subdomains(resp: dict) -> list[dict]:
    out = []
    for s in resp.get("subdomains", []):
        sub = s.get("subdomain", "")
        ip = s.get("ip", "N/A")
        status = s.get("status", "unknown")
        out.append(_f(
            "INFO",
            f"Subdomain {sub}",
            f"Resolved IP: {ip}, status: {status}",
            sub,
        ))
    return out


# Registry: tool key → (mapper, human label)
TOOL_REGISTRY: dict = {
    "nmap":        (from_nmap,        "Nmap Port Scan"),
    "nikto":       (from_nikto,       "Nikto Web Scan"),
    "vuln-scan":   (from_vuln_scan,   "Nmap Vulnerability Scan"),
    "nuclei":      (from_nuclei,      "Nuclei Vulnerability Scan"),
    "directories": (from_directories, "Directory Enumeration"),
    "ffuf":        (from_ffuf,        "FFUF Fuzzing"),
    "sqlmap":      (from_sqlmap,      "SQLMap Injection Test"),
    "subdomains":  (from_subdomains,  "Subdomain Enumeration"),
}


def normalize(tool: str, response: dict) -> list[dict]:
    """Dispatch to the right mapper. Returns [] if tool is unknown."""
    entry = TOOL_REGISTRY.get(tool)
    if not entry:
        return []
    mapper, _label = entry
    try:
        return mapper(response or {})
    except Exception as e:
        # Mapper bug or unexpected payload — never crash the scan.
        return [_f("INFO", "Assessment mapper error",
                   f"Could not normalize tool '{tool}' output: {e}")]


def tool_label(tool: str) -> str:
    entry = TOOL_REGISTRY.get(tool)
    return entry[1] if entry else tool
