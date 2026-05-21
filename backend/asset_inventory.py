"""Asset Inventory — module 7 of the SOC platform extension.

Local asset store with sync-from-Wazuh support. Risk score is computed
from criticality + open vuln count.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import AssetInventory, Organization, User
from rbac import require_permission
from tenant import get_current_org

try:
    import wazuh  # type: ignore[import-not-found]
except Exception:                # pragma: no cover
    wazuh = None  # type: ignore[assignment]


router = APIRouter(prefix="/api/soc/assets", tags=["SOC / Assets"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class AssetCreate(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=255)
    ip: Optional[str] = None
    mac: Optional[str] = None
    os: Optional[str] = None
    os_version: Optional[str] = None
    criticality: int = 50
    owner: Optional[str] = None
    tags: List[str] = []
    notes: Optional[str] = None
    open_ports: List[int] = []
    services: List[dict] = []
    software: List[dict] = []


class AssetPatch(BaseModel):
    ip: Optional[str] = None
    mac: Optional[str] = None
    os: Optional[str] = None
    os_version: Optional[str] = None
    criticality: Optional[int] = None
    owner: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    open_ports: Optional[List[int]] = None
    services: Optional[List[dict]] = None
    software: Optional[List[dict]] = None
    vuln_count: Optional[int] = None
    agent_status: Optional[str] = None


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
        return "[]"


def _compute_risk(a: AssetInventory) -> int:
    """Simple, transparent risk score: criticality weight + vuln pressure."""
    crit = max(0, min(100, a.criticality or 50)) / 100.0
    vulns = max(0, a.vuln_count or 0)
    vuln_pressure = min(1.0, vulns / 30.0)         # 30 vulns → max pressure
    agent_penalty = 0.15 if (a.agent_status and a.agent_status != "active") else 0.0
    score = (0.55 * crit + 0.35 * vuln_pressure + agent_penalty) * 100
    return int(min(100, max(0, score)))


def _serialize(a: AssetInventory) -> dict[str, Any]:
    return {
        "id": a.id,
        "hostname": a.hostname,
        "ip": a.ip,
        "mac": a.mac,
        "os": a.os,
        "os_version": a.os_version,
        "agent_id": a.agent_id,
        "agent_status": a.agent_status,
        "criticality": a.criticality,
        "risk_score": a.risk_score,
        "vuln_count": a.vuln_count,
        "open_ports": _loads(a.open_ports, []),
        "services": _loads(a.services, []),
        "software": _loads(a.software, []),
        "tags": _loads(a.tags, []),
        "owner": a.owner,
        "notes": a.notes,
        "last_seen": a.last_seen.isoformat() if a.last_seen else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("")
def list_assets(
    q: Optional[str] = Query(None),
    min_risk: int = Query(0, ge=0, le=100),
    agent_status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("asset.read")),
    current_org: Organization = Depends(get_current_org),
):
    qry = db.query(AssetInventory).filter(AssetInventory.organization_id == current_org.id)
    if q:
        like = f"%{q}%"
        qry = qry.filter((AssetInventory.hostname.ilike(like)) | (AssetInventory.ip.ilike(like)))
    if min_risk:
        qry = qry.filter(AssetInventory.risk_score >= min_risk)
    if agent_status:
        qry = qry.filter(AssetInventory.agent_status == agent_status)
    total = qry.count()
    rows = qry.order_by(AssetInventory.risk_score.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(r) for r in rows]}


@router.get("/stats/summary")
def stats(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("asset.read")),
    current_org: Organization = Depends(get_current_org),
):
    rows = (
        db.query(AssetInventory)
        .filter(AssetInventory.organization_id == current_org.id)
        .all()
    )
    by_status: dict[str, int] = {}
    risk_buckets = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    total_vulns = 0
    for r in rows:
        by_status[r.agent_status or "unknown"] = by_status.get(r.agent_status or "unknown", 0) + 1
        total_vulns += r.vuln_count or 0
        if (r.risk_score or 0) >= 80:
            risk_buckets["critical"] += 1
        elif (r.risk_score or 0) >= 60:
            risk_buckets["high"] += 1
        elif (r.risk_score or 0) >= 30:
            risk_buckets["medium"] += 1
        else:
            risk_buckets["low"] += 1
    return {
        "total": len(rows),
        "by_agent_status": by_status,
        "risk_buckets": risk_buckets,
        "total_vulnerabilities": total_vulns,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_asset(
    payload: AssetCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("asset.update")),
    current_org: Organization = Depends(get_current_org),
):
    existing = (
        db.query(AssetInventory)
        .filter(AssetInventory.hostname == payload.hostname,
                AssetInventory.organization_id == current_org.id)
        .first()
    )
    if existing:
        raise HTTPException(409, "Hostname already exists")
    a = AssetInventory(
        organization_id=current_org.id,
        hostname=payload.hostname,
        ip=payload.ip, mac=payload.mac,
        os=payload.os, os_version=payload.os_version,
        criticality=payload.criticality,
        owner=payload.owner,
        tags=_dumps(payload.tags),
        notes=payload.notes,
        open_ports=_dumps(payload.open_ports),
        services=_dumps(payload.services),
        software=_dumps(payload.software),
    )
    a.risk_score = _compute_risk(a)
    db.add(a)
    db.commit()
    db.refresh(a)
    log_action(db, user, "asset.create", resource_type="asset", resource_id=a.id, request=request)
    return _serialize(a)


@router.get("/{asset_id}")
def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("asset.read")),
    current_org: Organization = Depends(get_current_org),
):
    a = (
        db.query(AssetInventory)
        .filter(AssetInventory.id == asset_id,
                AssetInventory.organization_id == current_org.id)
        .first()
    )
    if not a:
        raise HTTPException(404, "Asset not found")
    return _serialize(a)


@router.patch("/{asset_id}")
def patch_asset(
    asset_id: int,
    payload: AssetPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("asset.update")),
    current_org: Organization = Depends(get_current_org),
):
    a = (
        db.query(AssetInventory)
        .filter(AssetInventory.id == asset_id,
                AssetInventory.organization_id == current_org.id)
        .first()
    )
    if not a:
        raise HTTPException(404, "Asset not found")
    for field in ("ip", "mac", "os", "os_version", "criticality", "owner",
                  "notes", "vuln_count", "agent_status"):
        new = getattr(payload, field)
        if new is not None:
            setattr(a, field, new)
    for field, attr in (("tags", "tags"), ("open_ports", "open_ports"),
                        ("services", "services"), ("software", "software")):
        new = getattr(payload, field)
        if new is not None:
            setattr(a, attr, _dumps(new))
    a.risk_score = _compute_risk(a)
    db.commit()
    db.refresh(a)
    log_action(db, user, "asset.update", resource_type="asset", resource_id=a.id, request=request)
    return _serialize(a)


@router.delete("/{asset_id}")
def delete_asset(
    asset_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("asset.update")),
    current_org: Organization = Depends(get_current_org),
):
    a = (
        db.query(AssetInventory)
        .filter(AssetInventory.id == asset_id,
                AssetInventory.organization_id == current_org.id)
        .first()
    )
    if not a:
        raise HTTPException(404, "Asset not found")
    db.delete(a)
    db.commit()
    log_action(db, user, "asset.delete", resource_type="asset", resource_id=asset_id, request=request)
    return {"ok": True, "id": asset_id}


# ---------------------------------------------------------------------------
# Wazuh sync — pulls Wazuh agents into the local inventory.
# Idempotent: matches on (agent_id) or (hostname).
# ---------------------------------------------------------------------------
@router.post("/sync/wazuh")
def sync_from_wazuh(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("asset.update")),
    current_org: Organization = Depends(get_current_org),
):
    if wazuh is None or not hasattr(wazuh, "es_search"):
        raise HTTPException(503, "Wazuh client unavailable")

    # Use the Wazuh agent monitoring index for per-agent rollups, scoped
    # to this tenant via Wazuh's agent group tag. Agents joined the group
    # at enrollment time using the org's enrollment key.
    body = {
        "size": 1000,
        "_source": ["agent", "@timestamp"],
        "sort": [{"@timestamp": {"order": "desc"}}],
        "query": {
            "bool": {
                "must": [{"term": {"agent.group": current_org.wazuh_agent_group}}]
                if current_org.wazuh_agent_group else [{"match_all": {}}]
            }
        },
    }
    try:
        result = wazuh.es_search(  # type: ignore[attr-defined]
            os.getenv("WAZUH_MONITORING_INDEX", "wazuh-monitoring-*"),
            body,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Wazuh query failed: {e}")

    seen: dict[str, dict] = {}
    for h in ((result or {}).get("hits") or {}).get("hits") or []:
        src = h.get("_source") or {}
        agent = src.get("agent") or {}
        aid = str(agent.get("id") or "")
        if not aid or aid in seen:
            continue
        seen[aid] = {
            "agent_id": aid,
            "hostname": agent.get("name") or aid,
            "ip": agent.get("ip"),
            "os": (agent.get("os") or {}).get("name") if isinstance(agent.get("os"), dict) else agent.get("os"),
            "agent_status": agent.get("status") or "unknown",
            "last_seen": src.get("@timestamp"),
        }

    created, updated = 0, 0
    for aid, info in seen.items():
        a = (
            db.query(AssetInventory)
            .filter(AssetInventory.agent_id == aid,
                    AssetInventory.organization_id == current_org.id)
            .first()
        )
        if not a:
            a = AssetInventory(
                organization_id=current_org.id,
                agent_id=aid,
                hostname=info["hostname"],
            )
            db.add(a)
            created += 1
        else:
            updated += 1
        a.hostname = info["hostname"] or a.hostname
        a.ip = info["ip"] or a.ip
        a.os = info["os"] or a.os
        a.agent_status = info["agent_status"]
        try:
            a.last_seen = datetime.fromisoformat(info["last_seen"].replace("Z", "+00:00")) \
                if info["last_seen"] else a.last_seen
        except Exception:
            pass
        a.risk_score = _compute_risk(a)

    db.commit()
    log_action(db, user, "asset.sync.wazuh", request=request,
               meta={"created": created, "updated": updated})
    return {"ok": True, "created": created, "updated": updated, "total_agents": len(seen)}
