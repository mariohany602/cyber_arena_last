"""
TheHive integration — read-only mirror of an external TheHive 4.x instance.

Provides cross-platform visibility on the cyber-arena `/thehive` page:
remote TheHive cases, alerts, tasks and observables are pulled through this
backend (so the frontend never speaks to TheHive directly and the API key
stays server-side).

Configuration (env vars):

    THEHIVE_URL           e.g. http://10.0.0.5:9000     (required)
    THEHIVE_API_KEY       user API key from TheHive UI  (required)
    THEHIVE_ORG           organisation header (TheHive 4 multi-tenant) — optional
    THEHIVE_VERIFY_SSL    "true"/"false" (default: false)
    THEHIVE_HTTP_TIMEOUT  seconds, default: 20

The endpoints below are mounted at ``/api/soc/thehive/*`` and are all
auth-protected against the platform's own session, **not** TheHive's. We
forward the API key as ``Authorization: Bearer <key>`` per TheHive 4 docs.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests
from contextvars import ContextVar

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from models import Organization, User
from tenant import get_current_org


# Multi-tenant header injection — same pattern as wazuh.py. The router
# dep below writes the tenant's TheHive Organisation name to this
# ContextVar; ``_headers`` reads it and sends ``X-Organisation: <org>``
# so TheHive enforces the isolation server-side.
_org_name_var: ContextVar[Optional[str]] = ContextVar("thehive_org_name", default=None)


async def _apply_org(org: Organization = Depends(get_current_org)) -> Organization:
    # Must be async — see wazuh._apply_org for why. Sync FastAPI deps run
    # in a copied context that's discarded on return, so the ContextVar
    # set is lost; async deps run in the handler's context and persist.
    _org_name_var.set(org.thehive_org_name)
    return org


# ---------------------------------------------------------------------------
#  Config
# ---------------------------------------------------------------------------

def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _cfg() -> Dict[str, Any]:
    return {
        "url": (os.environ.get("THEHIVE_URL") or "").rstrip("/"),
        "api_key": os.environ.get("THEHIVE_API_KEY") or "",
        "org": os.environ.get("THEHIVE_ORG") or "",
        "verify_ssl": _env_bool("THEHIVE_VERIFY_SSL", False),
        "timeout": int(os.environ.get("THEHIVE_HTTP_TIMEOUT") or 20),
    }


def _check_configured() -> Dict[str, Any]:
    cfg = _cfg()
    if not cfg["url"]:
        raise HTTPException(
            status_code=503,
            detail="TheHive not configured. Set THEHIVE_URL and THEHIVE_API_KEY on the backend.",
        )
    if not cfg["api_key"]:
        raise HTTPException(status_code=503, detail="THEHIVE_API_KEY not set.")
    return cfg


def _headers(cfg: Dict[str, Any]) -> Dict[str, str]:
    h = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    # Multi-tenant: prefer the per-tenant TheHive Organisation captured
    # from the current request. Falls back to the env-configured default
    # for legacy single-tenant deployments.
    tenant_org = _org_name_var.get()
    if tenant_org:
        h["X-Organisation"] = tenant_org
    elif cfg["org"]:
        h["X-Organisation"] = cfg["org"]
    return h


def _request(method: str, path: str, *, params=None, json=None) -> Any:
    cfg = _check_configured()
    url = f"{cfg['url']}{path}"
    try:
        r = requests.request(
            method, url,
            headers=_headers(cfg),
            params=params, json=json,
            verify=cfg["verify_ssl"], timeout=cfg["timeout"],
        )
    except requests.exceptions.SSLError as e:
        raise HTTPException(502, f"TheHive SSL error: {e}. Set THEHIVE_VERIFY_SSL=false for self-signed.")
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(502, f"Cannot reach TheHive at {cfg['url']}: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(504, f"TheHive request timed out after {cfg['timeout']}s")

    if r.status_code == 401:
        raise HTTPException(502, "TheHive rejected the API key (401). Check THEHIVE_API_KEY.")
    if r.status_code == 403:
        raise HTTPException(502, "TheHive denied access (403). The API key lacks permission, or the org is wrong.")
    if r.status_code >= 400:
        raise HTTPException(502, f"TheHive returned {r.status_code}: {r.text[:300]}")

    if not r.content:
        return None
    try:
        return r.json()
    except ValueError:
        return r.text


# ---------------------------------------------------------------------------
#  Normalisers
# ---------------------------------------------------------------------------

# TheHive severity is 1..4 (Low, Medium, High, Critical). TLP is 0..3.
_SEV_MAP = {1: "low", 2: "medium", 3: "high", 4: "critical"}
_TLP_MAP = {0: "white", 1: "green", 2: "amber", 3: "red"}


def _norm_case(c: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": c.get("_id") or c.get("id"),
        "case_id": c.get("caseId"),
        "title": c.get("title"),
        "description": c.get("description"),
        "status": c.get("status"),
        "severity": _SEV_MAP.get(int(c.get("severity") or 0), "info"),
        "severity_raw": c.get("severity"),
        "tlp": _TLP_MAP.get(int(c.get("tlp") or 0), "white"),
        "tlp_raw": c.get("tlp"),
        "tags": c.get("tags") or [],
        "owner": c.get("owner") or c.get("assignee"),
        "created_at": c.get("createdAt") or c.get("startDate"),
        "updated_at": c.get("updatedAt"),
        "end_date": c.get("endDate"),
        "flag": c.get("flag"),
        "resolution_status": c.get("resolutionStatus"),
        "impact_status": c.get("impactStatus"),
        "summary": c.get("summary"),
    }


def _norm_alert(a: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": a.get("_id") or a.get("id"),
        "type": a.get("type"),
        "source": a.get("source"),
        "source_ref": a.get("sourceRef"),
        "title": a.get("title"),
        "description": a.get("description"),
        "status": a.get("status"),
        "severity": _SEV_MAP.get(int(a.get("severity") or 0), "info"),
        "tlp": _TLP_MAP.get(int(a.get("tlp") or 0), "white"),
        "tags": a.get("tags") or [],
        "case_id": a.get("case"),
        "created_at": a.get("createdAt") or a.get("date"),
        "updated_at": a.get("updatedAt"),
        "follow": a.get("follow"),
        "artifact_count": a.get("artifactCount"),
    }


def _norm_task(t: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": t.get("_id") or t.get("id"),
        "title": t.get("title"),
        "group": t.get("group"),
        "description": t.get("description"),
        "status": t.get("status"),
        "flag": t.get("flag"),
        "owner": t.get("owner"),
        "start_date": t.get("startDate"),
        "due_date": t.get("dueDate"),
        "end_date": t.get("endDate"),
        "created_at": t.get("createdAt"),
    }


def _norm_observable(o: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": o.get("_id") or o.get("id"),
        "data_type": o.get("dataType"),
        "data": o.get("data"),
        "message": o.get("message"),
        "tags": o.get("tags") or [],
        "ioc": o.get("ioc"),
        "sighted": o.get("sighted"),
        "tlp": _TLP_MAP.get(int(o.get("tlp") or 0), "white"),
        "created_at": o.get("createdAt"),
    }


# ---------------------------------------------------------------------------
#  Router
# ---------------------------------------------------------------------------
router = APIRouter(
    prefix="/api/soc/thehive",
    tags=["SOC / TheHive"],
    # Router-level dep: every TheHive request is scoped to the caller's
    # tenant via the X-Organisation header (see _headers / _apply_org).
    dependencies=[Depends(_apply_org)],
)


@router.get("/config")
def get_config(_user: User = Depends(get_current_user)):
    """Non-secret config summary so the frontend can show a banner."""
    cfg = _cfg()
    return {
        "configured": bool(cfg["url"] and cfg["api_key"]),
        "url": cfg["url"],
        "org": cfg["org"] or None,
        "verify_ssl": cfg["verify_ssl"],
    }


@router.get("/health")
def health(_user: User = Depends(get_current_user)):
    """Probe TheHive — public ``/api/status`` works on TheHive 4 without auth.

    We still send the key so we can also confirm it's accepted.
    """
    cfg = _check_configured()
    try:
        r = requests.get(
            f"{cfg['url']}/api/status",
            headers=_headers(cfg),
            verify=cfg["verify_ssl"], timeout=cfg["timeout"],
        )
        ok = r.status_code == 200
        body: Any
        try:
            body = r.json()
        except ValueError:
            body = r.text[:300]
        return {"ok": ok, "status_code": r.status_code, "data": body}
    except requests.RequestException as e:
        return {"ok": False, "error": str(e)}


# ---------- cases -----------------------------------------------------------

@router.get("/cases")
def list_cases(
    range_: str = Query("0-50", alias="range", description="TheHive pagination, e.g. 0-50"),
    sort: str = Query("-startDate"),
    status_: Optional[str] = Query(None, alias="status"),
    severity: Optional[int] = Query(None, ge=1, le=4),
    q: Optional[str] = Query(None, description="Case title contains (client-side filter)"),
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """List cases via TheHive 4 ``GET /api/case``."""
    params: Dict[str, Any] = {"range": range_, "sort": sort}
    if status_:
        params["status"] = status_
    raw = _request("GET", "/api/case", params=params)
    items = raw if isinstance(raw, list) else (raw.get("data") if isinstance(raw, dict) else [])
    items = items or []
    if severity is not None:
        items = [c for c in items if int(c.get("severity") or 0) == severity]
    if q:
        ql = q.lower()
        items = [c for c in items if ql in (c.get("title") or "").lower()]
    return {"total": len(items), "items": [_norm_case(c) for c in items]}


@router.get("/cases/{case_id}")
def get_case(case_id: str, _user: User = Depends(get_current_user)) -> Dict[str, Any]:
    raw = _request("GET", f"/api/case/{case_id}")
    if not isinstance(raw, dict):
        raise HTTPException(404, "Case not found")
    return _norm_case(raw)


@router.get("/cases/{case_id}/tasks")
def list_case_tasks(case_id: str, _user: User = Depends(get_current_user)) -> List[Dict[str, Any]]:
    raw = _request("GET", f"/api/case/{case_id}/task")
    items = raw if isinstance(raw, list) else (raw.get("data") if isinstance(raw, dict) else [])
    return [_norm_task(t) for t in (items or [])]


@router.get("/cases/{case_id}/observables")
def list_case_observables(case_id: str, _user: User = Depends(get_current_user)) -> List[Dict[str, Any]]:
    raw = _request("GET", f"/api/case/{case_id}/artifact")
    items = raw if isinstance(raw, list) else (raw.get("data") if isinstance(raw, dict) else [])
    return [_norm_observable(o) for o in (items or [])]


# ---------- alerts ----------------------------------------------------------

@router.get("/alerts")
def list_alerts(
    range_: str = Query("0-50", alias="range"),
    sort: str = Query("-date"),
    status_: Optional[str] = Query(None, alias="status"),
    severity: Optional[int] = Query(None, ge=1, le=4),
    q: Optional[str] = Query(None),
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    params: Dict[str, Any] = {"range": range_, "sort": sort}
    if status_:
        params["status"] = status_
    raw = _request("GET", "/api/alert", params=params)
    items = raw if isinstance(raw, list) else (raw.get("data") if isinstance(raw, dict) else [])
    items = items or []
    if severity is not None:
        items = [a for a in items if int(a.get("severity") or 0) == severity]
    if q:
        ql = q.lower()
        items = [a for a in items if ql in (a.get("title") or "").lower()]
    return {"total": len(items), "items": [_norm_alert(a) for a in items]}


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: str, _user: User = Depends(get_current_user)) -> Dict[str, Any]:
    raw = _request("GET", f"/api/alert/{alert_id}")
    if not isinstance(raw, dict):
        raise HTTPException(404, "Alert not found")
    out = _norm_alert(raw)
    # also surface artifacts on detail
    arts = raw.get("artifacts") or []
    out["observables"] = [_norm_observable(o) for o in arts]
    return out


# ---------- summary ---------------------------------------------------------

@router.get("/summary")
def summary(_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Aggregate counters by status + severity for the dashboard tiles."""
    cases_raw = _request("GET", "/api/case", params={"range": "0-500", "sort": "-startDate"}) or []
    alerts_raw = _request("GET", "/api/alert", params={"range": "0-500", "sort": "-date"}) or []
    if isinstance(cases_raw, dict):
        cases_raw = cases_raw.get("data") or []
    if isinstance(alerts_raw, dict):
        alerts_raw = alerts_raw.get("data") or []

    def _bucketize(items: list, key: str) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for it in items:
            v = it.get(key)
            k = str(v) if v is not None else "unknown"
            out[k] = out.get(k, 0) + 1
        return out

    sev_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for c in cases_raw:
        sev = _SEV_MAP.get(int(c.get("severity") or 0), "info")
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    return {
        "cases": {
            "total": len(cases_raw),
            "by_status": _bucketize(cases_raw, "status"),
            "by_severity": sev_counts,
        },
        "alerts": {
            "total": len(alerts_raw),
            "by_status": _bucketize(alerts_raw, "status"),
            "by_type": _bucketize(alerts_raw, "type"),
        },
    }
