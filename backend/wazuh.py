"""
Wazuh integration — SIEM, XDR, Threat Intel.

Talks to a Wazuh stack that exposes **only** the Dashboard (the Indexer
port 9200 and Management API port 55000 are often firewalled off, as is the
case on our deployment). We authenticate against the Dashboard with
``POST /auth/login`` to obtain a session cookie, then issue Elasticsearch-
compatible queries via the Dashboard's built-in **console proxy**
(``POST /api/console/proxy``). The session is auto-refreshed on 401.

All Wazuh data we care about lives in the Indexer:

* ``wazuh-alerts-*``              — every rule-fired alert (SIEM)
* ``wazuh-monitoring-*``          — agent heartbeat / status
* ``wazuh-states-vulnerabilities-*`` — Vulnerability Detector inventory
* alert sub-objects ``data.virustotal.*``, ``data.misp.*``,
  ``data.abuseipdb.*``, ``data.urlhaus.*``, ``data.osquery.*``, etc.
  (Threat Intel + XDR enrichments)

Configuration (env vars):

    WAZUH_URL              https://wazuh-dashboard.example                (required)
    WAZUH_USER             e.g. "admin"
    WAZUH_PASSWORD         dashboard password (same as the browser UI)
    WAZUH_VERIFY_SSL       "true"/"false" (default: false — self-signed in prod)
    WAZUH_ALERTS_INDEX     default: "wazuh-alerts-*"
    WAZUH_VULN_INDEX       default: "wazuh-states-vulnerabilities-*"
    WAZUH_MONITORING_INDEX default: "wazuh-monitoring-*"
    WAZUH_TIMESTAMP_FIELD  default: "@timestamp"
    WAZUH_HTTP_TIMEOUT     seconds, default: 25
"""

from __future__ import annotations

import os
import threading
import urllib.parse
from contextvars import ContextVar
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import User, AlertVerdict, Organization
from tenant import get_current_org


# ---------------------------------------------------------------------------
# Multi-tenant filter
# ---------------------------------------------------------------------------
# Every route in this router is decorated with the ``_apply_org`` dependency
# (set at the APIRouter level), which writes the caller's Wazuh agent
# group to this ContextVar. The ``_query`` helper then automatically
# injects ``{term: {agent.group: <group>}}`` into every Elasticsearch
# bool query — that's how we isolate tenants on the *shared* Wazuh
# deployment without modifying each of the 20+ SIEM/XDR/TI endpoints.
_org_group_var: ContextVar[Optional[str]] = ContextVar("wazuh_org_group", default=None)


async def _apply_org(org: Organization = Depends(get_current_org)) -> Organization:
    """Router-level dep: capture the caller's Wazuh agent group for the
    duration of the request. Setting None is fine — it just means no
    extra filter is applied (e.g. for legacy orgs created before
    multi-tenancy).

    NOTE: this MUST be ``async`` so that the ContextVar.set propagates
    to the handler. Sync FastAPI deps run inside ``copy_context().run()``
    in a worker thread, which discards any ContextVar mutations on
    return. Async deps run in the request's main async context, so the
    set persists. (Confirmed: changing this to ``def`` silently breaks
    tenant isolation — every Wazuh query then runs unfiltered.)
    """
    _org_group_var.set(org.wazuh_agent_group)
    return org


def _org_clause() -> Optional[dict]:
    """Return the agent.group term filter for the active tenant, or None
    if multi-tenancy isn't engaged for this request."""
    group = _org_group_var.get()
    if not group:
        return None
    return {"term": {"agent.group": group}}


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
        "url": (os.environ.get("WAZUH_URL") or "").rstrip("/"),
        "user": os.environ.get("WAZUH_USER") or "",
        "password": os.environ.get("WAZUH_PASSWORD") or "",
        "verify_ssl": _env_bool("WAZUH_VERIFY_SSL", False),
        "alerts_index": os.environ.get("WAZUH_ALERTS_INDEX") or "wazuh-alerts-*",
        "vuln_index": os.environ.get("WAZUH_VULN_INDEX") or "wazuh-states-vulnerabilities-*",
        "monitoring_index": os.environ.get("WAZUH_MONITORING_INDEX") or "wazuh-monitoring-*",
        "ts_field": os.environ.get("WAZUH_TIMESTAMP_FIELD") or "@timestamp",
        "timeout": int(os.environ.get("WAZUH_HTTP_TIMEOUT") or 25),
    }


def _check_configured() -> Dict[str, Any]:
    cfg = _cfg()
    if not cfg["url"]:
        raise HTTPException(
            status_code=503,
            detail="Wazuh not configured. Set WAZUH_URL, WAZUH_USER, WAZUH_PASSWORD on the backend.",
        )
    if not cfg["user"] or not cfg["password"]:
        raise HTTPException(status_code=503, detail="WAZUH_USER / WAZUH_PASSWORD not set.")
    return cfg


# ---------------------------------------------------------------------------
#  Session / transport
# ---------------------------------------------------------------------------

class _WazuhSession:
    """Thread-safe cookie-jar wrapper with auto-refresh on 401.

    Wazuh Dashboard (OpenSearch Dashboards fork) uses a cookie-based session
    and requires the ``osd-xsrf`` header on state-changing requests.
    """

    def __init__(self) -> None:
        self._s = requests.Session()
        self._lock = threading.Lock()
        self._authed = False

    def _login(self, cfg: Dict[str, Any]) -> None:
        r = self._s.post(
            f"{cfg['url']}/auth/login",
            json={"username": cfg["user"], "password": cfg["password"]},
            headers={"osd-xsrf": "true", "Content-Type": "application/json"},
            verify=cfg["verify_ssl"],
            timeout=cfg["timeout"],
        )
        if r.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Wazuh Dashboard login failed: HTTP {r.status_code} — {r.text[:200]}",
            )
        self._authed = True

    def _ensure(self, cfg: Dict[str, Any]) -> None:
        if not self._authed:
            with self._lock:
                if not self._authed:
                    self._login(cfg)

    def proxy(
        self, method: str, es_path: str, body: Optional[dict] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Forward an ES-compatible request through the Dashboard console proxy."""
        cfg = _check_configured()
        self._ensure(cfg)

        # Build the proxied URL. The Dashboard expects `method` and `path` as
        # query params on the proxy endpoint. ES path + its own query params
        # are merged into `path` so the server forwards them to the Indexer.
        qs = ""
        if params:
            qs = "?" + urllib.parse.urlencode(
                {k: ("true" if v is True else "false" if v is False else v)
                 for k, v in params.items() if v is not None}
            )
        proxy_qs = urllib.parse.urlencode({"method": method.upper(), "path": f"{es_path}{qs}"})
        url = f"{cfg['url']}/api/console/proxy?{proxy_qs}"

        def _do() -> requests.Response:
            return self._s.post(
                url,
                headers={"osd-xsrf": "true", "Content-Type": "application/json"},
                json=body if body is not None else None,
                verify=cfg["verify_ssl"],
                timeout=cfg["timeout"],
            )

        try:
            resp = _do()
            if resp.status_code == 401:
                # Session expired — re-login once and retry
                with self._lock:
                    self._authed = False
                    self._login(cfg)
                resp = _do()
        except requests.exceptions.SSLError as e:
            raise HTTPException(status_code=502,
                                detail=f"Wazuh TLS error: {e}. Set WAZUH_VERIFY_SSL=false for self-signed certs.")
        except requests.exceptions.ConnectionError as e:
            raise HTTPException(status_code=502, detail=f"Cannot connect to Wazuh at {cfg['url']}: {e}")
        except requests.exceptions.Timeout:
            raise HTTPException(status_code=504, detail="Wazuh request timed out.")

        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code,
                                detail=f"Wazuh {resp.status_code}: {resp.text[:500]}")
        if not resp.content:
            return {}
        try:
            return resp.json()
        except ValueError:
            return {"raw": resp.text}


_session = _WazuhSession()


def _inject_org_filter(body: Optional[dict]) -> Optional[dict]:
    """Defense-in-depth: even if a route builds its own query inline
    instead of going through ``_query()``, this catches it and injects
    the tenant's agent.group filter at the lowest level — right before
    the HTTP call to Elasticsearch.

    The structure we look for is the standard
    ``{"query": {"bool": {"must": [...]}}}`` envelope. If the body uses
    ``match_all`` or ``term``/``match`` directly, we wrap it into a bool
    + must so we can add our filter cleanly.
    """
    org_filter = _org_clause()
    if not org_filter or not isinstance(body, dict):
        return body
    q = body.get("query")
    if not isinstance(q, dict):
        body = {**body, "query": {"bool": {"must": [org_filter]}}}
        return body
    # Already a bool query — append to its must (idempotent: avoid double
    # injection if we somehow get called twice).
    if "bool" in q and isinstance(q["bool"], dict):
        bq = dict(q["bool"])
        musts = list(bq.get("must") or [])
        # idempotent guard
        if org_filter not in musts:
            musts = [org_filter, *musts]
        bq["must"] = musts
        body = {**body, "query": {"bool": bq}}
        return body
    # Non-bool query (match_all / term / range / etc.) — wrap it.
    body = {**body, "query": {"bool": {"must": [org_filter, q]}}}
    return body


def _es(method: str, path: str, body: Optional[dict] = None) -> Any:
    # POST/_search and /_count carry queries; GET _cluster/health and
    # similar don't, so we only filter when the call has a body.
    if body is not None and "/_search" in path or (body and "/_count" in path):
        body = _inject_org_filter(body)
    return _session.proxy(method, path, body)


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _level_to_severity(level: Optional[int]) -> str:
    """Wazuh uses 0–15 rule levels. Map to the platform's 5-bucket scheme."""
    if level is None:
        return "info"
    lvl = int(level)
    if lvl >= 12: return "critical"
    if lvl >= 9:  return "high"
    if lvl >= 7:  return "medium"
    if lvl >= 4:  return "low"
    return "info"


def _time_clause(cfg: dict, start: Optional[str], end: Optional[str]) -> Optional[dict]:
    if not (start or end):
        return None
    rng: Dict[str, Any] = {}
    if start: rng["gte"] = start
    if end:   rng["lte"] = end
    return {"range": {cfg["ts_field"]: rng}}


def _agent_clause(agent: Optional[str]) -> Optional[dict]:
    """Match an alert by either ``agent.id`` or ``agent.name``. Returning
    ``None`` when ``agent`` is empty makes this a safe no-op filter."""
    if not agent or not str(agent).strip():
        return None
    a = str(agent).strip()
    return {"bool": {"should": [
        {"term": {"agent.id": a}},
        {"term": {"agent.name": a}},
    ], "minimum_should_match": 1}}


def _must(*clauses: Optional[dict]) -> List[dict]:
    return [c for c in clauses if c]


def _query(musts: List[dict]) -> dict:
    # Auto-inject the tenant's agent.group filter when multi-tenancy
    # context is active. Safe no-op when the ContextVar is empty (e.g.
    # for the /config and /health endpoints which don't query data).
    org_filter = _org_clause()
    if org_filter is not None:
        musts = [org_filter, *musts]
    return {"bool": {"must": musts}} if musts else {"match_all": {}}


# ---------------------------------------------------------------------------
#  Router
# ---------------------------------------------------------------------------
# `dependencies=[...]` installs ``_apply_org`` on every route in this
# router so individual endpoints don't need to thread current_org through
# manually. Endpoints that need the org object directly can still add
# ``current_org: Organization = Depends(get_current_org)`` to their
# signature — it's cached within the request.

router = APIRouter(
    prefix="/api/soc/wazuh",
    tags=["SOC / Wazuh"],
    dependencies=[Depends(_apply_org)],
)


# ---- Config + health ------------------------------------------------------

@router.get("/config")
def wazuh_config(_: User = Depends(get_current_user)):
    cfg = _cfg()
    return {
        "configured": bool(cfg["url"] and cfg["user"]),
        "url": cfg["url"],
        "verify_ssl": cfg["verify_ssl"],
        "alerts_index": cfg["alerts_index"],
        "vuln_index": cfg["vuln_index"],
        "monitoring_index": cfg["monitoring_index"],
        "timestamp_field": cfg["ts_field"],
    }


@router.get("/health")
def wazuh_health(_: User = Depends(get_current_user)):
    _check_configured()
    h = _es("GET", "_cluster/health")
    try:
        stats = _es("GET", "_cluster/stats")
        idx_count = (stats.get("indices") or {}).get("count")
        docs = ((stats.get("indices") or {}).get("docs") or {}).get("count")
    except HTTPException:
        idx_count, docs = None, None
    # alerts_index doc count
    try:
        cnt = _es("GET", f"{_cfg()['alerts_index']}/_count")
        alerts_total = cnt.get("count")
    except HTTPException:
        alerts_total = None
    return {
        "cluster_name": h.get("cluster_name"),
        "status": h.get("status"),
        "nodes": h.get("number_of_nodes"),
        "active_shards": h.get("active_shards"),
        "unassigned_shards": h.get("unassigned_shards"),
        "indices": idx_count,
        "docs": docs,
        "alerts_total": alerts_total,
    }


# ---- SIEM -----------------------------------------------------------------

@router.get("/siem/summary")
def siem_summary(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    agent: Optional[str] = Query(None),
    _: User = Depends(get_current_user),
):
    """High-level counters for the SIEM overview tab."""
    cfg = _check_configured()
    q = _query(_must(_time_clause(cfg, start, end), _agent_clause(agent)))
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": 0,
        "query": q,
        "track_total_hits": True,
        "aggs": {
            "by_level": {"terms": {"field": "rule.level", "size": 16, "order": {"_key": "desc"}}},
            "by_agent": {"cardinality": {"field": "agent.id"}},
            "by_rule":  {"cardinality": {"field": "rule.id"}},
            "mitre":    {"cardinality": {"field": "rule.mitre.id"}},
        },
    })
    aggs = res.get("aggregations", {}) or {}
    buckets = aggs.get("by_level", {}).get("buckets", []) or []
    by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for b in buckets:
        by_severity[_level_to_severity(b.get("key"))] += int(b.get("doc_count") or 0)
    return {
        "total": (res.get("hits", {}).get("total", {}) or {}).get("value", 0),
        "by_severity": by_severity,
        "by_level": [{"level": b.get("key"), "count": b.get("doc_count")} for b in buckets],
        "unique_agents": (aggs.get("by_agent") or {}).get("value", 0),
        "unique_rules": (aggs.get("by_rule") or {}).get("value", 0),
        "mitre_techniques": (aggs.get("mitre") or {}).get("value", 0),
    }


class AlertsQuery(BaseModel):
    start: Optional[str] = "now-24h"
    end: Optional[str] = "now"
    min_level: Optional[int] = None          # e.g. 7 for medium+
    severity: Optional[str] = None           # critical|high|medium|low|info
    agent: Optional[str] = None
    rule_id: Optional[str] = None
    q: Optional[str] = None                  # raw Lucene
    size: int = 50
    from_: int = 0


@router.post("/siem/alerts")
def siem_alerts(body: AlertsQuery, _: User = Depends(get_current_user)):
    cfg = _check_configured()
    musts = _must(_time_clause(cfg, body.start, body.end))
    if body.min_level is not None:
        musts.append({"range": {"rule.level": {"gte": body.min_level}}})
    if body.severity:
        # translate severity → level window
        sev = body.severity.lower()
        sev_ranges = {
            "critical": (12, 15), "high": (9, 11), "medium": (7, 8),
            "low": (4, 6), "info": (0, 3),
        }
        if sev in sev_ranges:
            lo, hi = sev_ranges[sev]
            musts.append({"range": {"rule.level": {"gte": lo, "lte": hi}}})
    if body.agent:
        musts.append({"bool": {"should": [
            {"term": {"agent.id": body.agent}},
            {"term": {"agent.name": body.agent}},
        ], "minimum_should_match": 1}})
    if body.rule_id:
        musts.append({"term": {"rule.id": body.rule_id}})
    if body.q and body.q.strip():
        musts.append({"query_string": {"query": body.q, "lenient": True}})

    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": min(max(1, body.size), 500),
        "from": max(0, body.from_),
        "sort": [{cfg["ts_field"]: {"order": "desc"}}],
        "query": _query(musts),
        "track_total_hits": True,
    })
    hits = res.get("hits", {}) or {}
    out: List[dict] = []
    for h in hits.get("hits", []):
        s = h.get("_source", {}) or {}
        rule = s.get("rule", {}) or {}
        agent = s.get("agent", {}) or {}
        mitre = rule.get("mitre", {}) or {}
        out.append({
            "id": h.get("_id"),
            "index": h.get("_index"),
            "timestamp": s.get(cfg["ts_field"]),
            "rule_id": rule.get("id"),
            "rule_level": rule.get("level"),
            "severity": _level_to_severity(rule.get("level")),
            "description": rule.get("description"),
            "groups": rule.get("groups") or [],
            "mitre_ids": mitre.get("id") or [],
            "mitre_tactics": mitre.get("tactic") or [],
            "mitre_techniques": mitre.get("technique") or [],
            "agent_id": agent.get("id"),
            "agent_name": agent.get("name"),
            "agent_ip": agent.get("ip"),
            "location": s.get("location"),
            "manager": (s.get("manager") or {}).get("name"),
            "full_log": s.get("full_log"),
            "data": s.get("data") or {},
            # compliance tags
            "pci_dss": rule.get("pci_dss") or [],
            "nist_800_53": rule.get("nist_800_53") or [],
            "hipaa": rule.get("hipaa") or [],
            "gdpr": rule.get("gdpr") or [],
            "tsc": rule.get("tsc") or [],
        })
    return {"total": (hits.get("total") or {}).get("value", 0), "alerts": out}


class OverTimeQuery(BaseModel):
    start: Optional[str] = "now-24h"
    end: Optional[str] = "now"
    interval: str = "30m"       # fixed_interval (e.g. 1m, 30m, 1h)
    by_severity: bool = True
    q: Optional[str] = None
    agent: Optional[str] = None


@router.post("/siem/events_over_time")
def siem_events_over_time(body: OverTimeQuery, _: User = Depends(get_current_user)):
    cfg = _check_configured()
    musts = _must(_time_clause(cfg, body.start, body.end), _agent_clause(body.agent))
    if body.q and body.q.strip():
        musts.append({"query_string": {"query": body.q, "lenient": True}})

    aggs: Dict[str, Any] = {
        "t": {
            "date_histogram": {
                "field": cfg["ts_field"],
                "fixed_interval": body.interval,
                "min_doc_count": 0,
            },
        }
    }
    if body.by_severity:
        aggs["t"]["aggs"] = {"by_level": {"terms": {"field": "rule.level", "size": 16}}}

    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": 0, "query": _query(musts), "aggs": aggs,
    })
    buckets = ((res.get("aggregations") or {}).get("t") or {}).get("buckets") or []
    out = []
    for b in buckets:
        row: Dict[str, Any] = {
            "time": b.get("key_as_string") or b.get("key"),
            "count": b.get("doc_count") or 0,
        }
        if body.by_severity:
            sev: Dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
            for lb in ((b.get("by_level") or {}).get("buckets") or []):
                sev[_level_to_severity(lb.get("key"))] += int(lb.get("doc_count") or 0)
            row["by_severity"] = sev
        out.append(row)
    return out


class TopQuery(BaseModel):
    field: str                 # e.g. "rule.description", "agent.name", "rule.mitre.id"
    start: Optional[str] = "now-24h"
    end: Optional[str] = "now"
    size: int = 10
    q: Optional[str] = None
    agent: Optional[str] = None


@router.post("/siem/top")
def siem_top(body: TopQuery, _: User = Depends(get_current_user)):
    cfg = _check_configured()
    musts = _must(_time_clause(cfg, body.start, body.end), _agent_clause(body.agent))
    if body.q and body.q.strip():
        musts.append({"query_string": {"query": body.q, "lenient": True}})
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": 0,
        "query": _query(musts),
        "aggs": {"top": {"terms": {"field": body.field, "size": min(max(1, body.size), 100)}}},
    })
    buckets = ((res.get("aggregations") or {}).get("top") or {}).get("buckets") or []
    return [{"key": b.get("key"), "count": b.get("doc_count") or 0} for b in buckets]


# ---- Classifications (TP / FP / TN / FN) ----------------------------------
#
# Wazuh has no native concept of analyst verdicts — these are *opinions* an
# operator forms while triaging alerts. We persist them in our own SQLite
# table (`alert_verdicts`) keyed by (user_id, Wazuh alert _id). Every alert
# has at most one current verdict per user; the latest write wins.
#
#   * **TP — True Positive**  : real attack / activity matching the rule's intent
#   * **FP — False Positive** : rule fired but no real threat
#   * **TN — True Negative**  : informational/benign and correctly low priority
#   * **FN — False Negative** : something *should* have fired but didn't (free-text alert id)
#
# Counts on `/siem/classifications` come from this table only — alerts the
# operator hasn't reviewed are reported as `unreviewed`.

_VALID_VERDICTS = {"tp", "fp", "tn", "fn"}


class VerdictUpsert(BaseModel):
    alert_id: str
    verdict: str                    # tp | fp | tn | fn
    rule_id: Optional[str] = None
    rule_level: Optional[int] = None
    note: Optional[str] = None


@router.post("/siem/verdict")
def siem_set_verdict(
    body: VerdictUpsert,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set / update / clear an analyst's verdict on a single alert."""
    if body.verdict not in _VALID_VERDICTS and body.verdict != "":
        raise HTTPException(status_code=400, detail="verdict must be tp|fp|tn|fn (or '' to clear)")
    row = (
        db.query(AlertVerdict)
        .filter(AlertVerdict.user_id == user.id, AlertVerdict.alert_id == body.alert_id)
        .first()
    )
    if body.verdict == "":
        if row:
            db.delete(row); db.commit()
        return {"alert_id": body.alert_id, "verdict": None}

    if row:
        row.verdict = body.verdict
        if body.rule_id is not None: row.rule_id = body.rule_id
        if body.rule_level is not None: row.rule_level = body.rule_level
        row.note = body.note
    else:
        row = AlertVerdict(
            user_id=user.id, alert_id=body.alert_id, verdict=body.verdict,
            rule_id=body.rule_id, rule_level=body.rule_level, note=body.note,
        )
        db.add(row)
    db.commit()
    return {
        "alert_id": row.alert_id, "verdict": row.verdict,
        "rule_id": row.rule_id, "rule_level": row.rule_level, "note": row.note,
    }


class VerdictsBulkQuery(BaseModel):
    alert_ids: List[str]


@router.post("/siem/verdicts/bulk")
def siem_get_verdicts_bulk(
    body: VerdictsBulkQuery,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk-fetch verdicts for a set of alert ids (used by the Events table)."""
    if not body.alert_ids:
        return {"verdicts": {}}
    rows = (
        db.query(AlertVerdict)
        .filter(AlertVerdict.user_id == user.id, AlertVerdict.alert_id.in_(body.alert_ids))
        .all()
    )
    return {"verdicts": {r.alert_id: r.verdict for r in rows}}


@router.get("/siem/classifications")
def siem_classifications(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    agent: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-user analyst verdicts roll-up + total alerts in the window so the
    UI can show how many are still unreviewed."""
    cfg = _check_configured()

    # Count of alerts in this window from Wazuh
    total_q = _query(_must(_time_clause(cfg, start, end), _agent_clause(agent)))
    try:
        total = int((_es("POST", f"{cfg['alerts_index']}/_count", {"query": total_q}) or {}).get("count") or 0)
    except HTTPException:
        total = 0

    rows = db.query(AlertVerdict).filter(AlertVerdict.user_id == user.id).all()
    counts = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    for r in rows:
        if r.verdict in counts:
            counts[r.verdict] += 1

    labeled = sum(counts.values())
    unreviewed = max(0, total - labeled)
    precision = counts["tp"] / max(1, counts["tp"] + counts["fp"])
    recall    = counts["tp"] / max(1, counts["tp"] + counts["fn"])

    return {
        **counts,
        "labeled": labeled,
        "unreviewed": unreviewed,
        "total_alerts": total,
        "precision": round(precision, 4),
        "recall":    round(recall, 4),
        "fp_rate":   round(counts["fp"] / max(1, labeled), 4),
        "fn_rate":   round(counts["fn"] / max(1, labeled), 4),
        "note": (
            "Counts come from analyst verdicts stored in this platform "
            "(per-user). Click TP/FP/TN/FN on an alert in Security Events "
            "to label it. Unreviewed = alerts in this window with no verdict yet."
        ),
    }


# ---- Geo origins ----------------------------------------------------------

@router.get("/siem/geo")
def siem_geo(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    size: int = Query(20, ge=1, le=200),
    agent: Optional[str] = Query(None),
    _: User = Depends(get_current_user),
):
    """Top source countries / IPs across alerts.

    Wazuh exposes geo enrichment at several places depending on integrations
    and rule decoders. We probe the common ones in priority order and return
    the first non-empty bucket set, plus a fallback srcip aggregation.
    """
    cfg = _check_configured()
    base_q = _query(_must(_time_clause(cfg, start, end), _agent_clause(agent)))

    country_fields = [
        "GeoLocation.country_name",
        "data.geoip.country_name",
        "data.geoip.country_name.keyword",
        "data.aws.sourceIPAddress",
        "data.src_country",
    ]
    countries: List[dict] = []
    field_used: Optional[str] = None
    for f in country_fields:
        try:
            r = _es("POST", f"{cfg['alerts_index']}/_search", {
                "size": 0, "query": base_q,
                "aggs": {"c": {"terms": {"field": f, "size": size}}},
            })
            buckets = ((r.get("aggregations") or {}).get("c") or {}).get("buckets") or []
            if buckets:
                field_used = f
                countries = [{"key": b.get("key"), "count": b.get("doc_count") or 0} for b in buckets]
                break
        except HTTPException:
            continue

    # Always also return top source IPs (helpful when geo-enrichment is off)
    src_ips: List[dict] = []
    for f in ("data.srcip", "data.src_ip", "src_ip"):
        try:
            r = _es("POST", f"{cfg['alerts_index']}/_search", {
                "size": 0, "query": base_q,
                "aggs": {"ip": {"terms": {"field": f, "size": size}}},
            })
            buckets = ((r.get("aggregations") or {}).get("ip") or {}).get("buckets") or []
            if buckets:
                src_ips = [{"key": b.get("key"), "count": b.get("doc_count") or 0} for b in buckets]
                break
        except HTTPException:
            continue

    return {
        "country_field_used": field_used,
        "countries": countries,
        "source_ips": src_ips,
        "note": (
            "No geo enrichment populated. Configure GeoIP in ossec.conf "
            "(`<geoip_db_path>`) or ensure your integrations populate "
            "`GeoLocation.country_name` / `data.geoip.*`."
        ) if not (countries or src_ips) else None,
    }


# ---- Rule performance -----------------------------------------------------

@router.get("/siem/rule_performance")
def siem_rule_performance(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    size: int = Query(15, ge=1, le=100),
    agent: Optional[str] = Query(None),
    _: User = Depends(get_current_user),
):
    """Per-rule firing metrics + an FP-rate derived from the
    ``false_positive`` rule-group convention."""
    cfg = _check_configured()
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": 0,
        "query": _query(_must(_time_clause(cfg, start, end), _agent_clause(agent))),
        "aggs": {
            "rules": {
                "terms": {"field": "rule.id", "size": size, "order": {"_count": "desc"}},
                "aggs": {
                    "desc":     {"terms": {"field": "rule.description", "size": 1}},
                    "level":    {"max":   {"field": "rule.level"}},
                    "agents":   {"cardinality": {"field": "agent.id"}},
                    "last":     {"max":   {"field": cfg["ts_field"]}},
                    "fp_count": {"filter": {"term": {"rule.groups": "false_positive"}}},
                },
            }
        },
    })
    buckets = ((res.get("aggregations") or {}).get("rules") or {}).get("buckets") or []
    out = []
    for b in buckets:
        fires = int(b.get("doc_count") or 0)
        fp = int(((b.get("fp_count") or {}).get("doc_count")) or 0)
        desc_buckets = ((b.get("desc") or {}).get("buckets") or [])
        out.append({
            "rule_id": b.get("key"),
            "description": (desc_buckets[0].get("key") if desc_buckets else None),
            "level": int((b.get("level") or {}).get("value") or 0),
            "fires": fires,
            "unique_agents": int((b.get("agents") or {}).get("value") or 0),
            "last_seen": (b.get("last") or {}).get("value_as_string"),
            "fp_count": fp,
            "fp_rate": round(fp / fires, 4) if fires else 0.0,
        })
    return {"rules": out}


# ---- XDR ------------------------------------------------------------------

@router.get("/xdr/agents")
def xdr_agents(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    size: int = Query(50, ge=1, le=500),
    _: User = Depends(get_current_user),
):
    """Per-agent rollup derived from alerts: activity, highest severity seen."""
    cfg = _check_configured()
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": 0,
        "query": _query(_must(_time_clause(cfg, start, end))),
        "aggs": {
            "agents": {
                "terms": {"field": "agent.id", "size": size, "missing": "unknown"},
                "aggs": {
                    "name": {"terms": {"field": "agent.name", "size": 1}},
                    "ip":   {"terms": {"field": "agent.ip",   "size": 1}},
                    "last_seen": {"max": {"field": cfg["ts_field"]}},
                    "max_level": {"max": {"field": "rule.level"}},
                    "by_level":  {"terms": {"field": "rule.level", "size": 16}},
                },
            }
        }
    })
    buckets = ((res.get("aggregations") or {}).get("agents") or {}).get("buckets") or []
    agents = []
    for b in buckets:
        name = (((b.get("name") or {}).get("buckets") or [{}])[0].get("key") or "")
        ip = (((b.get("ip") or {}).get("buckets") or [{}])[0].get("key") or "")
        sev = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for lb in ((b.get("by_level") or {}).get("buckets") or []):
            sev[_level_to_severity(lb.get("key"))] += int(lb.get("doc_count") or 0)
        max_level = int((b.get("max_level") or {}).get("value") or 0)
        agents.append({
            "agent_id": b.get("key"),
            "name": name,
            "ip": ip,
            "alerts": b.get("doc_count") or 0,
            "max_level": max_level,
            "top_severity": _level_to_severity(max_level),
            "last_seen": (b.get("last_seen") or {}).get("value_as_string"),
            "severity_breakdown": sev,
        })
    agents.sort(key=lambda a: (a["max_level"], a["alerts"]), reverse=True)
    return {"agents": agents}


@router.get("/xdr/vulnerabilities")
def xdr_vulnerabilities(
    severity: Optional[str] = Query(None, description="Critical|High|Medium|Low"),
    agent: Optional[str] = Query(None),
    size: int = Query(50, ge=1, le=500),
    _: User = Depends(get_current_user),
):
    """Vulnerability Detector inventory from ``wazuh-states-vulnerabilities-*``."""
    cfg = _check_configured()
    musts: List[dict] = []
    if severity:
        # Field names differ slightly across 4.3→4.8; search both common forms
        sev = severity.capitalize()
        musts.append({"bool": {"should": [
            {"term": {"vulnerability.severity": sev}},
            {"term": {"data.vulnerability.severity": sev}},
        ], "minimum_should_match": 1}})
    if agent:
        musts.append({"bool": {"should": [
            {"term": {"agent.id": agent}},
            {"term": {"agent.name": agent}},
        ], "minimum_should_match": 1}})

    try:
        res = _es("POST", f"{cfg['vuln_index']}/_search", {
            "size": min(max(1, size), 500),
            "query": _query(musts),
            "sort": [{"vulnerability.severity": {"order": "desc", "unmapped_type": "keyword"}}],
            "track_total_hits": True,
        })
    except HTTPException as e:
        # Index probably doesn't exist on this cluster — return empty gracefully
        if e.status_code in (404, 400):
            return {"total": 0, "vulnerabilities": [], "enabled": False,
                    "note": "wazuh-states-vulnerabilities-* not present. Enable the Vulnerability Detector module."}
        raise

    out = []
    hits = res.get("hits", {}) or {}
    for h in hits.get("hits", []) or []:
        s = h.get("_source", {}) or {}
        v = s.get("vulnerability") or s.get("data", {}).get("vulnerability") or {}
        pkg = s.get("package") or s.get("data", {}).get("package") or {}
        agent_ = s.get("agent", {}) or {}
        out.append({
            "id": h.get("_id"),
            "cve": v.get("id") or v.get("cve"),
            "severity": v.get("severity"),
            "cvss3": (v.get("cvss") or {}).get("cvss3", {}).get("base_score")
                     or v.get("cvss3_score"),
            "title": v.get("title") or v.get("name"),
            "package": pkg.get("name"),
            "version": pkg.get("version"),
            "agent_id": agent_.get("id"),
            "agent_name": agent_.get("name"),
            "published": v.get("published") or v.get("published_at"),
            "detection_time": v.get("detection_time"),
            "reference": v.get("reference") or (v.get("references") or [None])[0],
        })
    return {"total": (hits.get("total") or {}).get("value", 0),
            "vulnerabilities": out, "enabled": True}


def _fim_base_musts(cfg: dict, start: Optional[str], end: Optional[str],
                    agent: Optional[str] = None,
                    event: Optional[str] = None) -> List[dict]:
    """Common 'must' clauses for any FIM aggregation/listing — restricts the
    query to documents that have a ``syscheck.path`` (i.e. real FIM events).
    """
    musts: List[dict] = [
        _time_clause(cfg, start, end),
        _agent_clause(agent),
        {"exists": {"field": "syscheck.path"}},
    ]
    if event:
        musts.append({"term": {"syscheck.event": event.lower()}})
    return [m for m in musts if m]


@router.get("/xdr/fim/dashboard")
def xdr_fim_dashboard(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    interval: str = Query("30m"),
    agent: Optional[str] = Query(None),
    top_size: int = Query(10, ge=1, le=50),
    _: User = Depends(get_current_user),
):
    """Aggregated FIM metrics for the XDR Dashboard tab — single round-trip
    that returns overview cards, time series, top agents/users/rules, and
    action distribution. Scoped to alerts that have ``syscheck.path``."""
    cfg = _check_configured()
    q = _query(_fim_base_musts(cfg, start, end, agent=agent))

    body: Dict[str, Any] = {
        "size": 0,
        "track_total_hits": True,
        "query": q,
        "aggs": {
            "by_action":  {"terms": {"field": "syscheck.event", "size": 8}},
            "agents_card": {"cardinality": {"field": "agent.id"}},
            "critical":   {"filter": {"range": {"rule.level": {"gte": 12}}}},
            "top_agents": {
                "terms": {"field": "agent.id", "size": top_size, "order": {"_count": "desc"}},
                "aggs": {"name": {"terms": {"field": "agent.name", "size": 1}}},
            },
            "top_rules": {
                "terms": {"field": "rule.description", "size": top_size, "order": {"_count": "desc"}},
                "aggs": {
                    "rid":   {"terms": {"field": "rule.id", "size": 1}},
                    "level": {"max":   {"field": "rule.level"}},
                },
            },
            "top_users": {
                "terms": {"field": "syscheck.uname_after", "size": top_size, "order": {"_count": "desc"}},
                "aggs": {
                    "agent_id":   {"terms": {"field": "agent.id",   "size": 1}},
                    "agent_name": {"terms": {"field": "agent.name", "size": 1}},
                },
            },
            "over_time": {
                "date_histogram": {
                    "field": cfg["ts_field"],
                    "fixed_interval": interval,
                    "min_doc_count": 0,
                },
                "aggs": {"by_action": {"terms": {"field": "syscheck.event", "size": 8}}},
            },
        },
    }
    res = _es("POST", f"{cfg['alerts_index']}/_search", body)
    aggs = res.get("aggregations", {}) or {}
    total = ((res.get("hits") or {}).get("total") or {}).get("value", 0)

    actions = {"added": 0, "modified": 0, "deleted": 0}
    for b in (aggs.get("by_action") or {}).get("buckets") or []:
        k = str(b.get("key") or "").lower()
        if k in actions:
            actions[k] = int(b.get("doc_count") or 0)

    def _first(buckets, key="key"):
        return (buckets or [{}])[0].get(key)

    top_agents = [{
        "agent_id":   b.get("key"),
        "agent_name": _first((b.get("name") or {}).get("buckets")),
        "count":      int(b.get("doc_count") or 0),
    } for b in (aggs.get("top_agents") or {}).get("buckets") or []]

    top_rules = [{
        "description": b.get("key"),
        "rule_id":     _first((b.get("rid") or {}).get("buckets")),
        "level":       int((b.get("level") or {}).get("value") or 0),
        "count":       int(b.get("doc_count") or 0),
    } for b in (aggs.get("top_rules") or {}).get("buckets") or []]

    top_users = [{
        "user":       b.get("key"),
        "agent_id":   _first((b.get("agent_id")   or {}).get("buckets")),
        "agent_name": _first((b.get("agent_name") or {}).get("buckets")),
        "count":      int(b.get("doc_count") or 0),
    } for b in (aggs.get("top_users") or {}).get("buckets") or []]

    over_time = []
    for b in (aggs.get("over_time") or {}).get("buckets") or []:
        a = {"added": 0, "modified": 0, "deleted": 0}
        for ab in ((b.get("by_action") or {}).get("buckets") or []):
            k = str(ab.get("key") or "").lower()
            if k in a:
                a[k] = int(ab.get("doc_count") or 0)
        over_time.append({
            "time":      b.get("key_as_string") or b.get("key"),
            "count":     int(b.get("doc_count") or 0),
            "by_action": a,
        })

    return {
        "total": int(total),
        "actions": actions,
        "affected_agents": int((aggs.get("agents_card") or {}).get("value") or 0),
        "critical": int(((aggs.get("critical") or {}).get("doc_count")) or 0),
        "top_agents": top_agents,
        "top_rules":  top_rules,
        "top_users":  top_users,
        "over_time":  over_time,
    }


@router.get("/xdr/fim")
def xdr_fim(
    start: str = Query("now-24h"),
    end: str = Query("now"),
    size: int = Query(50, ge=1, le=500),
    from_: int = Query(0, ge=0, alias="from"),
    event: Optional[str] = Query(None, description="added|modified|deleted"),
    agent: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Lucene query (e.g. path search)"),
    _: User = Depends(get_current_user),
):
    """File Integrity Monitoring events — from ``data.syscheck.*`` on alerts.

    Returns a paginated list of FIM events plus a ``total`` count for the
    table footer / paging UI.
    """
    cfg = _check_configured()
    musts = _fim_base_musts(cfg, start, end, agent=agent, event=event)
    if q and q.strip():
        musts.append({"query_string": {"query": q, "lenient": True}})
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": min(max(1, size), 500),
        "from": max(0, from_),
        "query": _query([m for m in musts if m]),
        "sort": [{cfg["ts_field"]: {"order": "desc"}}],
        "track_total_hits": True,
    })
    hits = res.get("hits", {}) or {}
    out = []
    for h in hits.get("hits", []) or []:
        s = h.get("_source", {}) or {}
        sc = s.get("syscheck") or {}
        ag = s.get("agent", {}) or {}
        rule = s.get("rule", {}) or {}
        # ``changed_attributes`` is sometimes a list, sometimes a string
        changed = sc.get("changed_attributes")
        if isinstance(changed, str):
            changed = [c.strip() for c in changed.split(",") if c.strip()]
        out.append({
            "id": h.get("_id"),
            "timestamp": s.get(cfg["ts_field"]),
            "event": sc.get("event"),
            "path": sc.get("path"),
            "mode": sc.get("mode"),
            "size_after":  sc.get("size_after"),
            "size_before": sc.get("size_before"),
            "md5_after":    sc.get("md5_after"),
            "sha1_after":   sc.get("sha1_after"),
            "sha256_after": sc.get("sha256_after"),
            "uname_after": sc.get("uname_after"),
            "uname_before": sc.get("uname_before"),
            "uid_after": sc.get("uid_after"),
            "gid_after": sc.get("gid_after"),
            "perm_after":  sc.get("perm_after"),
            "perm_before": sc.get("perm_before"),
            "changed_attributes": changed or [],
            "agent_id":   ag.get("id"),
            "agent_name": ag.get("name"),
            "rule_id":          rule.get("id"),
            "rule_level":       rule.get("level"),
            "rule_description": rule.get("description"),
            "mitre_ids":     (rule.get("mitre") or {}).get("id") or [],
            "mitre_tactics": (rule.get("mitre") or {}).get("tactic") or [],
        })
    return {
        "total":  (hits.get("total") or {}).get("value", 0),
        "events": out,
    }


@router.get("/xdr/sca")
def xdr_sca(
    size: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None, description="passed|failed"),
    _: User = Depends(get_current_user),
):
    """Security Configuration Assessment findings — from ``data.sca.*``."""
    cfg = _check_configured()
    musts: List[dict] = [{"exists": {"field": "data.sca.check.id"}}]
    if status:
        musts.append({"term": {"data.sca.check.result": status}})
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": min(max(1, size), 200),
        "query": _query(musts),
        "sort": [{cfg["ts_field"]: {"order": "desc"}}],
    })
    out = []
    for h in (res.get("hits", {}) or {}).get("hits", []) or []:
        s = h.get("_source", {}) or {}
        sca = ((s.get("data") or {}).get("sca") or {})
        check = sca.get("check") or {}
        ag = s.get("agent", {}) or {}
        out.append({
            "id": h.get("_id"),
            "timestamp": s.get(cfg["ts_field"]),
            "policy": sca.get("policy"),
            "check_id": check.get("id"),
            "title": check.get("title"),
            "result": check.get("result"),
            "rationale": check.get("rationale"),
            "compliance": check.get("compliance") or {},
            "agent_id": ag.get("id"),
            "agent_name": ag.get("name"),
        })
    return {"findings": out}


# ---- Threat Intel ---------------------------------------------------------

def _ti_fetch(field_prefix: str, start: str, end: str, size: int) -> List[dict]:
    """Generic threat-intel fetch for any ``data.<source>.*`` sub-object."""
    cfg = _check_configured()
    musts = _must(
        _time_clause(cfg, start, end),
        {"exists": {"field": f"{field_prefix}.source"}},
    )
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": min(max(1, size), 200),
        "sort": [{cfg["ts_field"]: {"order": "desc"}}],
        "query": _query(musts),
    })
    return [
        {
            "id": h.get("_id"),
            "timestamp": (h.get("_source") or {}).get(cfg["ts_field"]),
            "agent": (h.get("_source", {}).get("agent") or {}),
            "rule": (h.get("_source", {}).get("rule") or {}),
            "data": (h.get("_source", {}).get("data") or {}),
        }
        for h in (res.get("hits", {}) or {}).get("hits", []) or []
    ]


@router.get("/ti/summary")
def ti_summary(
    start: str = Query("now-7d"),
    end: str = Query("now"),
    _: User = Depends(get_current_user),
):
    """Cross-source TI counters (how many enriched alerts per feed)."""
    cfg = _check_configured()
    sources = ["virustotal", "misp", "abuseipdb", "urlhaus", "maltiverse", "osquery"]
    out: Dict[str, Any] = {}
    tc = _time_clause(cfg, start, end)
    for src in sources:
        q = _query(_must(tc, {"exists": {"field": f"data.{src}.source"}}))
        try:
            r = _es("POST", f"{cfg['alerts_index']}/_count", {"query": q})
            out[src] = r.get("count") or 0
        except HTTPException:
            out[src] = 0
    # VirusTotal malicious breakdown
    try:
        r = _es("POST", f"{cfg['alerts_index']}/_search", {
            "size": 0,
            "query": _query(_must(tc, {"exists": {"field": "data.virustotal.malicious"}})),
            "aggs": {"malicious_gt_0": {"filter": {"range": {"data.virustotal.malicious": {"gt": 0}}}}},
        })
        out["virustotal_malicious_hits"] = (
            ((r.get("aggregations") or {}).get("malicious_gt_0") or {}).get("doc_count") or 0
        )
    except HTTPException:
        out["virustotal_malicious_hits"] = 0
    return {"range": {"start": start, "end": end}, "counts": out}


@router.get("/ti/virustotal")
def ti_virustotal(
    start: str = Query("now-7d"),
    end: str = Query("now"),
    malicious_only: bool = Query(True),
    size: int = Query(50, ge=1, le=200),
    _: User = Depends(get_current_user),
):
    cfg = _check_configured()
    musts = _must(_time_clause(cfg, start, end),
                  {"exists": {"field": "data.virustotal.source"}})
    if malicious_only:
        musts.append({"range": {"data.virustotal.malicious": {"gt": 0}}})
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": min(max(1, size), 200),
        "sort": [{cfg["ts_field"]: {"order": "desc"}}],
        "query": _query(musts),
        "track_total_hits": True,
    })
    hits = res.get("hits", {}) or {}
    out = []
    for h in hits.get("hits") or []:
        s = h.get("_source", {}) or {}
        vt = (s.get("data") or {}).get("virustotal") or {}
        src = vt.get("source") or {}
        ag = s.get("agent", {}) or {}
        out.append({
            "id": h.get("_id"),
            "timestamp": s.get(cfg["ts_field"]),
            "malicious": vt.get("malicious"),
            "positives": vt.get("positives"),
            "total": vt.get("total"),
            "permalink": vt.get("permalink"),
            "sha1": src.get("sha1") or vt.get("sha1"),
            "md5":  src.get("md5")  or vt.get("md5"),
            "scan_id": vt.get("scan_id"),
            "source_file": src.get("file"),
            "source_alert": src.get("alert_id"),
            "description": vt.get("description"),
            "agent_id": ag.get("id"),
            "agent_name": ag.get("name"),
        })
    return {"total": (hits.get("total") or {}).get("value", 0), "hits": out}


@router.get("/ti/misp")
def ti_misp(
    start: str = Query("now-7d"),
    end: str = Query("now"),
    size: int = Query(50, ge=1, le=200),
    _: User = Depends(get_current_user),
):
    rows = _ti_fetch("data.misp", start, end, size)
    out = []
    for r in rows:
        m = (r["data"].get("misp") or {})
        src = m.get("source") or {}
        out.append({
            "id": r["id"], "timestamp": r["timestamp"],
            "event_id": src.get("event_id") or m.get("event_id"),
            "category": m.get("category"),
            "description": m.get("description") or src.get("description"),
            "value": m.get("value") or src.get("value"),
            "type": m.get("type") or src.get("type"),
            "agent_id": (r["agent"] or {}).get("id"),
            "agent_name": (r["agent"] or {}).get("name"),
        })
    return {"hits": out}


@router.get("/ti/abuseipdb")
def ti_abuseipdb(
    start: str = Query("now-7d"),
    end: str = Query("now"),
    size: int = Query(50, ge=1, le=200),
    _: User = Depends(get_current_user),
):
    rows = _ti_fetch("data.abuseipdb", start, end, size)
    out = []
    for r in rows:
        a = (r["data"].get("abuseipdb") or {})
        out.append({
            "id": r["id"], "timestamp": r["timestamp"],
            "score": a.get("score") or a.get("abuseConfidenceScore"),
            "country": a.get("countryCode") or a.get("country"),
            "ip": a.get("ipAddress") or a.get("ip"),
            "isp": a.get("isp"),
            "usage_type": a.get("usageType"),
            "total_reports": a.get("totalReports"),
            "agent_id": (r["agent"] or {}).get("id"),
            "agent_name": (r["agent"] or {}).get("name"),
        })
    return {"hits": out}


# ---- MITRE ATT&CK coverage -----------------------------------------------

@router.get("/mitre/matrix")
def mitre_matrix(
    start: str = Query("now-7d"),
    end: str = Query("now"),
    size: int = Query(200, ge=1, le=1000),
    _: User = Depends(get_current_user),
):
    """MITRE technique hit counts for heatmap / coverage panels."""
    cfg = _check_configured()
    tc = _time_clause(cfg, start, end)
    musts = _must(tc, {"exists": {"field": "rule.mitre.id"}})
    res = _es("POST", f"{cfg['alerts_index']}/_search", {
        "size": 0,
        "query": _query(musts),
        "aggs": {
            "techniques": {
                "terms": {"field": "rule.mitre.id", "size": size},
                "aggs": {
                    "tactic": {"terms": {"field": "rule.mitre.tactic", "size": 10}},
                    "technique_name": {"terms": {"field": "rule.mitre.technique", "size": 3}},
                },
            },
            "tactics": {"terms": {"field": "rule.mitre.tactic", "size": 20}},
        },
    })
    aggs = res.get("aggregations", {}) or {}
    techniques = []
    for b in (aggs.get("techniques") or {}).get("buckets", []) or []:
        tactics = [x.get("key") for x in ((b.get("tactic") or {}).get("buckets") or [])]
        name = (((b.get("technique_name") or {}).get("buckets") or [{}])[0].get("key") or "")
        techniques.append({
            "id": b.get("key"),
            "name": name,
            "count": b.get("doc_count") or 0,
            "tactics": tactics,
        })
    tactics = [
        {"key": b.get("key"), "count": b.get("doc_count") or 0}
        for b in (aggs.get("tactics") or {}).get("buckets", []) or []
    ]
    return {"techniques": techniques, "tactics": tactics}
