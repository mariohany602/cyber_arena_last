"""Threat Hunting Portal — module 3 of the SOC platform extension.

Saved hunts + execution history. Query execution is delegated to the
existing Wazuh client (``wazuh.py``) so we reuse SIEM auth/transport. If
Wazuh is unavailable we still return a deterministic empty result so the
hunting UI degrades gracefully instead of crashing.
"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import HuntExecution, SavedHunt, User
from rbac import require_permission

# Lazy import — wazuh module is large; only needed when we actually execute.
try:
    import wazuh  # type: ignore[import-not-found]
except Exception:                # pragma: no cover — env-dependent
    wazuh = None  # type: ignore[assignment]


router = APIRouter(prefix="/api/soc/hunts", tags=["SOC / Threat Hunting"])


HUNT_FIELDS: dict[str, list[str]] = {
    # logical key → list of candidate ES/Wazuh fields
    "ip": ["src_ip", "agent.ip", "data.srcip", "data.dstip", "data.win.eventdata.ipAddress"],
    "username": ["data.win.eventdata.targetUserName", "data.srcuser", "data.dstuser", "user.name"],
    "hostname": ["agent.name", "host.name", "data.win.system.computer"],
    "process": ["data.win.eventdata.processName", "process.name", "data.command"],
    "hash": ["data.win.eventdata.hashes", "file.hash.sha256", "file.hash.md5"],
    "command_line": ["data.win.eventdata.commandLine", "process.command_line", "data.command"],
    "mitre": ["rule.mitre.id"],
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class HuntFilters(BaseModel):
    ip: Optional[str] = None
    username: Optional[str] = None
    hostname: Optional[str] = None
    process: Optional[str] = None
    hash: Optional[str] = None
    command_line: Optional[str] = None
    mitre: Optional[str] = None
    time_from: Optional[str] = "now-24h"
    time_to: Optional[str] = "now"
    free_text: Optional[str] = None
    size: int = Field(100, ge=1, le=1000)


class SavedHuntCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: Optional[str] = None
    filters: HuntFilters
    query_dsl: Optional[str] = None
    is_shared: bool = False
    tags: List[str] = []


class SavedHuntPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    filters: Optional[HuntFilters] = None
    query_dsl: Optional[str] = None
    is_shared: Optional[bool] = None
    tags: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _loads(v, d):
    if not v:
        return d
    try:
        return json.loads(v)
    except Exception:
        return d


def _dumps(v) -> str:
    try:
        return json.dumps(v, default=str)
    except Exception:
        return "{}"


def _serialize_saved(h: SavedHunt) -> dict[str, Any]:
    return {
        "id": h.id,
        "user_id": h.user_id,
        "name": h.name,
        "description": h.description,
        "filters": _loads(h.filters_json, {}),
        "query_dsl": h.query_dsl,
        "is_shared": h.is_shared,
        "tags": _loads(h.tags, []),
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "updated_at": h.updated_at.isoformat() if h.updated_at else None,
    }


def _build_dsl(filters: HuntFilters) -> Dict[str, Any]:
    """Translate logical filters → Elasticsearch DSL."""
    must: List[Dict[str, Any]] = []
    fields_used: List[str] = []

    def _add_match(value: Optional[str], key: str) -> None:
        if not value:
            return
        candidates = HUNT_FIELDS.get(key, [])
        if len(candidates) == 1:
            must.append({"match_phrase": {candidates[0]: value}})
        else:
            must.append({
                "bool": {"should": [{"match_phrase": {f: value}} for f in candidates],
                         "minimum_should_match": 1}
            })
        fields_used.extend(candidates)

    _add_match(filters.ip, "ip")
    _add_match(filters.username, "username")
    _add_match(filters.hostname, "hostname")
    _add_match(filters.process, "process")
    _add_match(filters.hash, "hash")
    _add_match(filters.command_line, "command_line")
    _add_match(filters.mitre, "mitre")
    if filters.free_text:
        must.append({"query_string": {"query": filters.free_text, "default_operator": "AND"}})

    body: Dict[str, Any] = {
        "size": filters.size,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "query": {
            "bool": {
                "must": must or [{"match_all": {}}],
                "filter": [{
                    "range": {
                        "@timestamp": {
                            "gte": filters.time_from or "now-24h",
                            "lte": filters.time_to or "now",
                        }
                    }
                }],
            }
        },
    }
    return body


# ---------------------------------------------------------------------------
# Saved hunts CRUD
# ---------------------------------------------------------------------------
@router.get("/saved")
def list_saved(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("hunt.read")),
):
    rows = (
        db.query(SavedHunt)
        .filter((SavedHunt.user_id == user.id) | (SavedHunt.is_shared == True))  # noqa: E712
        .order_by(SavedHunt.updated_at.desc())
        .all()
    )
    return [_serialize_saved(r) for r in rows]


@router.post("/saved", status_code=status.HTTP_201_CREATED)
def create_saved(
    payload: SavedHuntCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("hunt.save")),
):
    h = SavedHunt(
        user_id=user.id,
        name=payload.name,
        description=payload.description,
        filters_json=_dumps(payload.filters.model_dump()),
        query_dsl=payload.query_dsl,
        is_shared=payload.is_shared,
        tags=_dumps(payload.tags),
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return _serialize_saved(h)


@router.patch("/saved/{hunt_id}")
def patch_saved(
    hunt_id: int,
    payload: SavedHuntPatch,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("hunt.save")),
):
    h = db.query(SavedHunt).filter(SavedHunt.id == hunt_id).first()
    if not h:
        raise HTTPException(404, "Saved hunt not found")
    if h.user_id != user.id and (getattr(user, "role", "") != "admin"):
        raise HTTPException(403, "Not owner of this saved hunt")
    if payload.name is not None:
        h.name = payload.name
    if payload.description is not None:
        h.description = payload.description
    if payload.filters is not None:
        h.filters_json = _dumps(payload.filters.model_dump())
    if payload.query_dsl is not None:
        h.query_dsl = payload.query_dsl
    if payload.is_shared is not None:
        h.is_shared = payload.is_shared
    if payload.tags is not None:
        h.tags = _dumps(payload.tags)
    db.commit()
    db.refresh(h)
    return _serialize_saved(h)


@router.delete("/saved/{hunt_id}")
def delete_saved(
    hunt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("hunt.delete")),
):
    h = db.query(SavedHunt).filter(SavedHunt.id == hunt_id).first()
    if not h:
        raise HTTPException(404, "Saved hunt not found")
    if h.user_id != user.id and (getattr(user, "role", "") != "admin"):
        raise HTTPException(403, "Not owner of this saved hunt")
    db.delete(h)
    db.commit()
    return {"ok": True, "id": hunt_id}


# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------
@router.post("/execute")
def execute_hunt(
    filters: HuntFilters,
    request: Request,
    saved_hunt_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("hunt.execute")),
):
    body = _build_dsl(filters)
    started = time.time()
    hits: List[Dict[str, Any]] = []
    total = 0
    err: Optional[str] = None

    if wazuh is not None and hasattr(wazuh, "es_search"):
        try:
            # `es_search(index, body)` is the canonical helper inside wazuh.py.
            result = wazuh.es_search(  # type: ignore[attr-defined]
                os.getenv("WAZUH_ALERTS_INDEX", "wazuh-alerts-*"),
                body,
            )
            total = (((result or {}).get("hits") or {}).get("total") or {}).get("value", 0)
            hits = [h.get("_source", {}) | {"_id": h.get("_id")} for h in (((result or {}).get("hits") or {}).get("hits") or [])]
        except Exception as e:  # noqa: BLE001
            err = str(e)
    else:
        err = "wazuh client unavailable"

    duration_ms = int((time.time() - started) * 1000)
    db.add(HuntExecution(
        user_id=user.id,
        saved_hunt_id=saved_hunt_id,
        filters_json=_dumps(filters.model_dump()),
        result_count=len(hits),
        duration_ms=duration_ms,
    ))
    db.commit()
    log_action(db, user, "hunt.execute", request=request,
               meta={"count": len(hits), "duration_ms": duration_ms, "err": err})

    return {
        "total": total,
        "count": len(hits),
        "duration_ms": duration_ms,
        "hits": hits,
        "query": body,
        "error": err,
    }


@router.get("/history")
def list_history(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("hunt.read")),
):
    rows = (
        db.query(HuntExecution)
        .filter(HuntExecution.user_id == user.id)
        .order_by(HuntExecution.created_at.desc())
        .limit(limit).all()
    )
    return [
        {
            "id": r.id,
            "saved_hunt_id": r.saved_hunt_id,
            "filters": _loads(r.filters_json, {}),
            "result_count": r.result_count,
            "duration_ms": r.duration_ms,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# Required for hunts.execute() to read the env var lazily.
import os  # noqa: E402
