"""
Native SIEM integration with Elasticsearch.

The frontend used to embed Kibana via an iframe. This module exposes a
small REST surface that the platform UI consumes directly so logs,
alerts, and aggregations are rendered inside Cyber Arena itself.

Configuration (all via env vars):

    ELASTIC_URL              base URL, e.g. https://elk.local:9200  (required)
    ELASTIC_USER             basic-auth username                    (optional)
    ELASTIC_PASSWORD         basic-auth password                    (optional)
    ELASTIC_VERIFY_SSL       "true"/"false" (default: true)
    ELASTIC_INDEX_PATTERN    default index pattern for log search
                             (default: "logs-*,*beat-*,filebeat-*,winlogbeat-*")
    ELASTIC_ALERTS_INDEX     index pattern for detection alerts
                             (default: ".alerts-security.alerts-*,.siem-signals-*")
    ELASTIC_TIMESTAMP_FIELD  timestamp field (default: "@timestamp")
    ELASTIC_CLIENT_FIELD     document field that holds the client name
                             (default: "client.name"). Empty disables.
    ELASTIC_CLIENT_INDEX_REGEX
                             regex applied to index names; capture group 1 is
                             the client name (e.g. "^logs-([^-]+)-.*"). Empty
                             disables.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from models import User


# ---------------------------------------------------------------------------
# Config / client
# ---------------------------------------------------------------------------

def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def get_config() -> Dict[str, Any]:
    return {
        "url": (os.environ.get("ELASTIC_URL") or "").rstrip("/"),
        "user": os.environ.get("ELASTIC_USER") or "",
        "password": os.environ.get("ELASTIC_PASSWORD") or "",
        "verify_ssl": _env_bool("ELASTIC_VERIFY_SSL", True),
        "index_pattern": os.environ.get("ELASTIC_INDEX_PATTERN")
            or "logs-*,*beat-*,filebeat-*,winlogbeat-*",
        "alerts_index": os.environ.get("ELASTIC_ALERTS_INDEX")
            or ".alerts-security.alerts-*,.siem-signals-*",
        "timestamp_field": os.environ.get("ELASTIC_TIMESTAMP_FIELD") or "@timestamp",
        "client_field": os.environ.get("ELASTIC_CLIENT_FIELD", "client.name"),
        "client_index_regex": os.environ.get("ELASTIC_CLIENT_INDEX_REGEX", ""),
    }


# ---------------------------------------------------------------------------
# Client (multi-tenant) helpers
# ---------------------------------------------------------------------------

def _list_indices(pattern: str) -> List[str]:
    raw = _es_request("GET", f"/_cat/indices/{pattern}",
                      params={"format": "json", "h": "index"})
    if not isinstance(raw, list):
        return []
    return [r.get("index") for r in raw if r.get("index")]


def _client_indices(client: str, cfg: dict) -> List[str]:
    """Return the indices whose names match the client regex for `client`."""
    if not cfg["client_index_regex"]:
        return []
    try:
        pat = re.compile(cfg["client_index_regex"])
    except re.error:
        return []
    indices = _list_indices(cfg["index_pattern"])
    out = []
    for idx in indices:
        m = pat.match(idx)
        if m and m.groups() and m.group(1) == client:
            out.append(idx)
    return out


def _client_filter_clause(client: Optional[str], cfg: dict) -> Optional[dict]:
    """Build an OR-clause that scopes a query to one client.

    Matches when EITHER the client_field equals `client` OR the document's
    `_index` is one of the client-named indices (per regex).
    """
    if not client:
        return None
    should: List[dict] = []
    if cfg["client_field"]:
        should.append({"term": {cfg["client_field"]: client}})
        # tolerate text-mapped fields too (no .keyword)
        should.append({"match_phrase": {cfg["client_field"]: client}})
    indices = _client_indices(client, cfg)
    if indices:
        should.append({"terms": {"_index": indices}})
    if not should:
        return None
    return {"bool": {"should": should, "minimum_should_match": 1}}


def _es_request(method: str, path: str, json_body: Optional[dict] = None,
                params: Optional[dict] = None, timeout: int = 20) -> Any:
    cfg = get_config()
    if not cfg["url"]:
        raise HTTPException(status_code=503, detail="Elasticsearch not configured. Set ELASTIC_URL.")
    url = f"{cfg['url']}{path}"
    auth = (cfg["user"], cfg["password"]) if cfg["user"] else None
    try:
        resp = requests.request(
            method, url,
            auth=auth, verify=cfg["verify_ssl"],
            json=json_body, params=params, timeout=timeout,
            headers={"Content-Type": "application/json"},
        )
    except requests.exceptions.SSLError as e:
        raise HTTPException(status_code=502, detail=f"Elasticsearch TLS error: {e}. Set ELASTIC_VERIFY_SSL=false if using a self-signed cert.")
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=502, detail=f"Cannot connect to Elasticsearch at {cfg['url']}: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Elasticsearch request timed out")
    if resp.status_code >= 400:
        # Surface ES error message but never the password
        body = resp.text[:1000]
        raise HTTPException(status_code=resp.status_code, detail=f"Elasticsearch {resp.status_code}: {body}")
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text}


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/soc/siem", tags=["SOC / SIEM"])


@router.get("/config")
def siem_config(_: User = Depends(get_current_user)):
    """Return non-secret SIEM config so the UI can show what's wired up."""
    cfg = get_config()
    return {
        "configured": bool(cfg["url"]),
        "url": cfg["url"],
        "auth": "basic" if cfg["user"] else "none",
        "verify_ssl": cfg["verify_ssl"],
        "index_pattern": cfg["index_pattern"],
        "alerts_index": cfg["alerts_index"],
        "timestamp_field": cfg["timestamp_field"],
        "client_field": cfg["client_field"],
        "client_index_regex": cfg["client_index_regex"],
        "client_scoping_enabled": bool(cfg["client_field"] or cfg["client_index_regex"]),
    }


@router.get("/clients")
def siem_clients(
    start: Optional[str] = Query(None, description="ES date math, e.g. now-30d"),
    size: int = Query(100, ge=1, le=500),
    _: User = Depends(get_current_user),
):
    """List distinct clients discovered from documents and from index names.

    Two sources, merged on lowercased name:
    - terms aggregation on ``ELASTIC_CLIENT_FIELD`` over the configured
      index pattern (and optional time range).
    - regex-extracted client name from index names matching
      ``ELASTIC_CLIENT_INDEX_REGEX``.
    """
    cfg = get_config()
    discovered: Dict[str, Dict[str, Any]] = {}

    # 1) field-based discovery via terms aggregation
    if cfg["client_field"]:
        must: List[dict] = []
        if start:
            must.append({"range": {cfg["timestamp_field"]: {"gte": start}}})
        try:
            res = _es_request("POST", f"/{cfg['index_pattern']}/_search", json_body={
                "size": 0,
                "query": {"bool": {"must": must}} if must else {"match_all": {}},
                "aggs": {"clients": {"terms": {"field": cfg["client_field"], "size": size}}},
            })
            for b in (res.get("aggregations", {}).get("clients", {}) or {}).get("buckets", []):
                key = str(b.get("key", "")).strip()
                if not key:
                    continue
                slot = discovered.setdefault(key.lower(), {"name": key, "doc_count": 0, "indices": [], "sources": set()})
                slot["doc_count"] += int(b.get("doc_count") or 0)
                slot["sources"].add("field")
        except HTTPException:
            # Field probably isn't mapped; ignore so the dropdown still shows index-based clients.
            pass

    # 2) index-name-based discovery
    if cfg["client_index_regex"]:
        try:
            pat = re.compile(cfg["client_index_regex"])
            for idx in _list_indices(cfg["index_pattern"]):
                m = pat.match(idx)
                if not m or not m.groups():
                    continue
                name = m.group(1)
                slot = discovered.setdefault(name.lower(), {"name": name, "doc_count": 0, "indices": [], "sources": set()})
                slot["indices"].append(idx)
                slot["sources"].add("index")
        except re.error:
            pass

    out = []
    for slot in discovered.values():
        out.append({
            "name": slot["name"],
            "doc_count": slot["doc_count"],
            "indices": sorted(slot["indices"]),
            "sources": sorted(slot["sources"]),
        })
    out.sort(key=lambda c: c["name"].lower())
    return {
        "field": cfg["client_field"],
        "index_regex": cfg["client_index_regex"],
        "clients": out,
    }


@router.get("/health")
def siem_health(_: User = Depends(get_current_user)):
    """Cluster health + basic stats."""
    health = _es_request("GET", "/_cluster/health")
    try:
        stats = _es_request("GET", "/_cluster/stats", timeout=15)
    except HTTPException:
        stats = {}
    return {
        "cluster_name": health.get("cluster_name"),
        "status": health.get("status"),
        "number_of_nodes": health.get("number_of_nodes"),
        "active_shards": health.get("active_shards"),
        "unassigned_shards": health.get("unassigned_shards"),
        "indices": stats.get("indices", {}).get("count"),
        "docs": stats.get("indices", {}).get("docs", {}).get("count"),
        "store_bytes": stats.get("indices", {}).get("store", {}).get("size_in_bytes"),
    }


@router.get("/indices")
def siem_indices(
    pattern: Optional[str] = Query(None, description="Index pattern; defaults to ELASTIC_INDEX_PATTERN"),
    _: User = Depends(get_current_user),
):
    cfg = get_config()
    pat = pattern or cfg["index_pattern"]
    raw = _es_request("GET", f"/_cat/indices/{pat}", params={"format": "json", "h": "index,docs.count,store.size,health"})
    if not isinstance(raw, list):
        return []
    out = []
    for r in raw:
        out.append({
            "index": r.get("index"),
            "docs": int(r.get("docs.count") or 0),
            "size": r.get("store.size"),
            "health": r.get("health"),
        })
    out.sort(key=lambda x: x["docs"], reverse=True)
    return out


# --- Search / logs ---------------------------------------------------------

class SearchBody(BaseModel):
    index: Optional[str] = None
    q: Optional[str] = None        # Lucene query string
    start: Optional[str] = None    # ISO-8601 or ES date math, e.g. "now-15m"
    end: Optional[str] = None
    size: int = 50
    from_: int = Field(0, alias="from")
    sort_desc: bool = True
    client: Optional[str] = None   # scope to one client (multi-tenant)

    model_config = ConfigDict(populate_by_name=True)


def _build_time_range(cfg: dict, start: Optional[str], end: Optional[str]) -> Optional[dict]:
    if not (start or end):
        return None
    rng: Dict[str, Any] = {}
    if start: rng["gte"] = start
    if end: rng["lte"] = end
    return {"range": {cfg["timestamp_field"]: rng}}


@router.post("/search")
def siem_search(body: SearchBody, _: User = Depends(get_current_user)):
    cfg = get_config()
    index = body.index or cfg["index_pattern"]
    must: List[dict] = []
    if body.q and body.q.strip():
        must.append({"query_string": {"query": body.q, "lenient": True}})
    rng = _build_time_range(cfg, body.start, body.end)
    if rng: must.append(rng)
    cf = _client_filter_clause(body.client, cfg)
    if cf: must.append(cf)

    es_body = {
        "from": max(0, body.from_),
        "size": min(max(1, body.size), 500),
        "sort": [{cfg["timestamp_field"]: {"order": "desc" if body.sort_desc else "asc"}}],
        "query": {"bool": {"must": must}} if must else {"match_all": {}},
        "track_total_hits": True,
    }
    res = _es_request("POST", f"/{index}/_search", json_body=es_body)
    hits = res.get("hits", {})
    return {
        "total": hits.get("total", {}).get("value", 0),
        "took_ms": res.get("took"),
        "hits": [
            {
                "_id": h.get("_id"),
                "_index": h.get("_index"),
                "_source": h.get("_source", {}),
            }
            for h in hits.get("hits", [])
        ],
    }


# --- Alerts ----------------------------------------------------------------

@router.get("/alerts")
def siem_alerts(
    size: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    severity: Optional[str] = Query(None, description="critical|high|medium|low"),
    status_: Optional[str] = Query(None, alias="status", description="open|acknowledged|closed"),
    client: Optional[str] = Query(None, description="scope to one client"),
    _: User = Depends(get_current_user),
):
    cfg = get_config()
    must: List[dict] = []
    rng = _build_time_range(cfg, start, end)
    if rng: must.append(rng)
    if severity:
        must.append({"term": {"kibana.alert.severity": severity.lower()}})
    if status_:
        must.append({"term": {"kibana.alert.workflow_status": status_.lower()}})
    cf = _client_filter_clause(client, cfg)
    if cf: must.append(cf)

    es_body = {
        "size": size,
        "sort": [{cfg["timestamp_field"]: {"order": "desc"}}],
        "query": {"bool": {"must": must}} if must else {"match_all": {}},
        "track_total_hits": True,
    }
    res = _es_request("POST", f"/{cfg['alerts_index']}/_search", json_body=es_body)
    hits = res.get("hits", {})
    out = []
    for h in hits.get("hits", []):
        s = h.get("_source", {}) or {}
        kib = s.get("kibana", {}).get("alert", {}) if isinstance(s.get("kibana"), dict) else {}
        out.append({
            "_id": h.get("_id"),
            "_index": h.get("_index"),
            "timestamp": s.get(cfg["timestamp_field"]),
            "rule": (kib.get("rule") or {}).get("name") or s.get("rule", {}).get("name"),
            "severity": kib.get("severity") or s.get("signal", {}).get("rule", {}).get("severity"),
            "risk_score": kib.get("risk_score") or s.get("signal", {}).get("rule", {}).get("risk_score"),
            "status": kib.get("workflow_status"),
            "host": (s.get("host") or {}).get("name"),
            "user": (s.get("user") or {}).get("name"),
            "message": s.get("message") or kib.get("reason"),
            "_source": s,
        })
    return {"total": hits.get("total", {}).get("value", 0), "alerts": out}


# --- Aggregations / charts -------------------------------------------------

class AggOverTimeBody(BaseModel):
    index: Optional[str] = None
    q: Optional[str] = None
    start: Optional[str] = "now-24h"
    end: Optional[str] = "now"
    interval: str = "1h"   # ES date_histogram fixed_interval
    client: Optional[str] = None


@router.post("/aggs/over_time")
def siem_events_over_time(body: AggOverTimeBody, _: User = Depends(get_current_user)):
    cfg = get_config()
    index = body.index or cfg["index_pattern"]
    must: List[dict] = []
    if body.q and body.q.strip():
        must.append({"query_string": {"query": body.q, "lenient": True}})
    rng = _build_time_range(cfg, body.start, body.end)
    if rng: must.append(rng)
    cf = _client_filter_clause(body.client, cfg)
    if cf: must.append(cf)

    es_body = {
        "size": 0,
        "query": {"bool": {"must": must}} if must else {"match_all": {}},
        "aggs": {
            "events_over_time": {
                "date_histogram": {
                    "field": cfg["timestamp_field"],
                    "fixed_interval": body.interval,
                    "min_doc_count": 0,
                }
            }
        },
    }
    res = _es_request("POST", f"/{index}/_search", json_body=es_body)
    buckets = (res.get("aggregations", {}).get("events_over_time", {}) or {}).get("buckets", [])
    return [{"time": b.get("key_as_string") or b.get("key"), "count": b.get("doc_count", 0)} for b in buckets]


class AggTopBody(BaseModel):
    index: Optional[str] = None
    field: str
    q: Optional[str] = None
    start: Optional[str] = "now-24h"
    end: Optional[str] = "now"
    size: int = 10
    client: Optional[str] = None


@router.post("/aggs/top")
def siem_top_terms(body: AggTopBody, _: User = Depends(get_current_user)):
    cfg = get_config()
    index = body.index or cfg["index_pattern"]
    must: List[dict] = []
    if body.q and body.q.strip():
        must.append({"query_string": {"query": body.q, "lenient": True}})
    rng = _build_time_range(cfg, body.start, body.end)
    if rng: must.append(rng)
    cf = _client_filter_clause(body.client, cfg)
    if cf: must.append(cf)

    es_body = {
        "size": 0,
        "query": {"bool": {"must": must}} if must else {"match_all": {}},
        "aggs": {"top": {"terms": {"field": body.field, "size": min(max(1, body.size), 100)}}},
    }
    res = _es_request("POST", f"/{index}/_search", json_body=es_body)
    buckets = (res.get("aggregations", {}).get("top", {}) or {}).get("buckets", [])
    return [{"key": b.get("key"), "count": b.get("doc_count", 0)} for b in buckets]
