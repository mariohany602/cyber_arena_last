"""Incident Management — module 1 of the SOC platform extension.

Endpoints (all under ``/api/soc/incidents``):

  GET  /                  list/search/filter incidents
  POST /                  create incident
  GET  /{id}              detail (incident + timeline)
  PATCH /{id}             update fields (status, severity, assignee, …)
  POST /{id}/events       append timeline event (note, action, attach)
  GET  /{id}/events       list timeline events
  POST /{id}/assign       assign analyst
  POST /{id}/status       change status (open → … → closed) with audit trail
  POST /{id}/related      link related alerts / incidents
  DELETE /{id}            soft-deny unless incident.delete permission
  GET  /stats/summary     counters for dashboards (open / by severity / by status)
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func as sql_func
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import Incident, IncidentEvent, Organization, User
from rbac import require_permission, user_has_permission
from tenant import get_current_org


router = APIRouter(prefix="/api/soc/incidents", tags=["SOC / Incidents"])


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
VALID_STATUSES = {"open", "investigating", "escalated", "resolved", "closed"}
VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class IncidentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    severity: str = "medium"
    status: str = "open"
    category: Optional[str] = None
    source: Optional[str] = "manual"
    assignee_id: Optional[int] = None
    related_alert_ids: List[str] = []
    mitre_techniques: List[str] = []
    tags: List[str] = []


class IncidentPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    category: Optional[str] = None
    assignee_id: Optional[int] = None
    case_id: Optional[int] = None
    related_alert_ids: Optional[List[str]] = None
    related_incident_ids: Optional[List[int]] = None
    mitre_techniques: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    resolution: Optional[str] = None


class EventCreate(BaseModel):
    kind: str = "note"           # note, action, attach, soar, status
    content: Optional[str] = None
    meta: dict[str, Any] = {}


class AssignRequest(BaseModel):
    assignee_id: Optional[int] = None      # None = unassign


class StatusChangeRequest(BaseModel):
    status: str
    reason: Optional[str] = None


class RelatedRequest(BaseModel):
    alert_ids: List[str] = []
    incident_ids: List[int] = []


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------
def _loads(value: Optional[str], default):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _dumps(value) -> str:
    try:
        return json.dumps(value, default=str)
    except Exception:
        return "[]"


def _serialize(inc: Incident) -> dict[str, Any]:
    return {
        "id": inc.id,
        "title": inc.title,
        "description": inc.description,
        "status": inc.status,
        "severity": inc.severity,
        "category": inc.category,
        "source": inc.source,
        "created_by": inc.created_by,
        "assignee_id": inc.assignee_id,
        "case_id": inc.case_id,
        "related_alert_ids": _loads(inc.related_alert_ids, []),
        "related_incident_ids": _loads(inc.related_incident_ids, []),
        "mitre_techniques": _loads(inc.mitre_techniques, []),
        "tags": _loads(inc.tags, []),
        "detected_at": inc.detected_at.isoformat() if inc.detected_at else None,
        "acknowledged_at": inc.acknowledged_at.isoformat() if inc.acknowledged_at else None,
        "resolved_at": inc.resolved_at.isoformat() if inc.resolved_at else None,
        "closed_at": inc.closed_at.isoformat() if inc.closed_at else None,
        "created_at": inc.created_at.isoformat() if inc.created_at else None,
        "updated_at": inc.updated_at.isoformat() if inc.updated_at else None,
        "resolution": inc.resolution,
    }


def _serialize_event(ev: IncidentEvent) -> dict[str, Any]:
    return {
        "id": ev.id,
        "incident_id": ev.incident_id,
        "user_id": ev.user_id,
        "kind": ev.kind,
        "content": ev.content,
        "meta": _loads(ev.meta_json, {}),
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
    }


def _add_event(db: Session, incident_id: int, user: Optional[User], kind: str,
               content: Optional[str] = None, meta: Optional[dict] = None) -> IncidentEvent:
    ev = IncidentEvent(
        incident_id=incident_id,
        user_id=user.id if user else None,
        kind=kind,
        content=content,
        meta_json=_dumps(meta or {}),
    )
    db.add(ev)
    db.flush()
    return ev


def _get_or_404(db: Session, incident_id: int, org_id: int | None = None) -> Incident:
    q = db.query(Incident).filter(Incident.id == incident_id)
    if org_id is not None:
        # Tenant isolation: id-guess from another org returns 404, not a leak.
        q = q.filter(Incident.organization_id == org_id)
    inc = q.first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("")
def list_incidents(
    status_: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None, description="free-text search in title/description"),
    tag: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("incident.read")),
    current_org: Organization = Depends(get_current_org),
):
    query = db.query(Incident).filter(Incident.organization_id == current_org.id)
    if status_:
        query = query.filter(Incident.status == status_)
    if severity:
        query = query.filter(Incident.severity == severity)
    if assignee_id is not None:
        query = query.filter(Incident.assignee_id == assignee_id)
    if q:
        like = f"%{q}%"
        query = query.filter((Incident.title.ilike(like)) | (Incident.description.ilike(like)))
    if tag:
        # SQLite has no native JSON ops here; LIKE is fine for our scale.
        query = query.filter(Incident.tags.like(f'%"{tag}"%'))

    total = query.count()
    rows = query.order_by(Incident.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.create")),
    current_org: Organization = Depends(get_current_org),
):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(400, f"Invalid status. Valid: {sorted(VALID_STATUSES)}")
    if payload.severity not in VALID_SEVERITIES:
        raise HTTPException(400, f"Invalid severity. Valid: {sorted(VALID_SEVERITIES)}")

    inc = Incident(
        organization_id=current_org.id,
        title=payload.title,
        description=payload.description,
        status=payload.status,
        severity=payload.severity,
        category=payload.category,
        source=payload.source or "manual",
        created_by=user.id,
        assignee_id=payload.assignee_id,
        related_alert_ids=_dumps(payload.related_alert_ids),
        mitre_techniques=_dumps(payload.mitre_techniques),
        tags=_dumps(payload.tags),
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)

    _add_event(db, inc.id, user, "created", content=f"Incident '{inc.title}' created", meta={"severity": inc.severity})
    db.commit()
    log_action(db, user, "incident.create", resource_type="incident", resource_id=inc.id,
               request=request, meta={"severity": inc.severity, "status": inc.status})
    return _serialize(inc)


@router.get("/stats/summary")
def stats_summary(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("incident.read")),
    current_org: Organization = Depends(get_current_org),
):
    """Counters used by the executive dashboard and incident list header."""
    org_q = db.query(Incident).filter(Incident.organization_id == current_org.id)
    by_status = dict(
        org_q.with_entities(Incident.status, sql_func.count(Incident.id))
        .group_by(Incident.status).all()
    )
    by_severity = dict(
        org_q.with_entities(Incident.severity, sql_func.count(Incident.id))
        .group_by(Incident.severity).all()
    )
    total = org_q.with_entities(sql_func.count(Incident.id)).scalar() or 0
    open_count = sum(by_status.get(s, 0) for s in ("open", "investigating", "escalated"))
    return {
        "total": int(total),
        "open": int(open_count),
        "by_status": {k: int(v) for k, v in by_status.items()},
        "by_severity": {k: int(v) for k, v in by_severity.items()},
    }


@router.get("/{incident_id}")
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("incident.read")),
    current_org: Organization = Depends(get_current_org),
):
    inc = _get_or_404(db, incident_id, org_id=current_org.id)
    events = (
        db.query(IncidentEvent)
        .filter(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.created_at.asc())
        .all()
    )
    data = _serialize(inc)
    data["events"] = [_serialize_event(e) for e in events]
    return data


@router.patch("/{incident_id}")
def patch_incident(
    incident_id: int,
    payload: IncidentPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.update")),
    current_org: Organization = Depends(get_current_org),
):
    inc = _get_or_404(db, incident_id, org_id=current_org.id)
    changes: dict[str, Any] = {}

    if payload.status is not None:
        if payload.status not in VALID_STATUSES:
            raise HTTPException(400, "Invalid status")
        if payload.status != inc.status:
            changes["status"] = (inc.status, payload.status)
            _apply_status(inc, payload.status)

    if payload.severity is not None:
        if payload.severity not in VALID_SEVERITIES:
            raise HTTPException(400, "Invalid severity")
        if payload.severity != inc.severity:
            changes["severity"] = (inc.severity, payload.severity)
            inc.severity = payload.severity

    for field in ("title", "description", "category", "case_id", "resolution"):
        new = getattr(payload, field)
        if new is not None and new != getattr(inc, field):
            changes[field] = (getattr(inc, field), new)
            setattr(inc, field, new)

    if payload.assignee_id is not None and payload.assignee_id != inc.assignee_id:
        changes["assignee_id"] = (inc.assignee_id, payload.assignee_id)
        inc.assignee_id = payload.assignee_id

    for field, attr in (
        ("related_alert_ids", "related_alert_ids"),
        ("related_incident_ids", "related_incident_ids"),
        ("mitre_techniques", "mitre_techniques"),
        ("tags", "tags"),
    ):
        new = getattr(payload, field)
        if new is not None:
            setattr(inc, attr, _dumps(new))
            changes[field] = ("…", new)

    if not changes:
        return _serialize(inc)

    db.commit()
    db.refresh(inc)
    _add_event(db, inc.id, user, "update", content="Incident updated",
               meta={k: {"from": str(v[0]), "to": str(v[1])} for k, v in changes.items()})
    db.commit()
    log_action(db, user, "incident.update", resource_type="incident", resource_id=inc.id,
               request=request, meta={"fields": list(changes.keys())})
    return _serialize(inc)


@router.post("/{incident_id}/events")
def add_event(
    incident_id: int,
    payload: EventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.update")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, incident_id, org_id=current_org.id)
    ev = _add_event(db, incident_id, user, payload.kind, payload.content, payload.meta)
    db.commit()
    db.refresh(ev)
    return _serialize_event(ev)


@router.get("/{incident_id}/events")
def list_events(
    incident_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("incident.read")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, incident_id, org_id=current_org.id)
    events = (
        db.query(IncidentEvent)
        .filter(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.created_at.asc())
        .all()
    )
    return [_serialize_event(e) for e in events]


@router.post("/{incident_id}/assign")
def assign(
    incident_id: int,
    payload: AssignRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.assign")),
    current_org: Organization = Depends(get_current_org),
):
    inc = _get_or_404(db, incident_id, org_id=current_org.id)
    prev = inc.assignee_id
    inc.assignee_id = payload.assignee_id
    db.commit()
    _add_event(db, inc.id, user, "assignment",
               content=f"Assignee changed: {prev} → {payload.assignee_id}",
               meta={"from": prev, "to": payload.assignee_id})
    db.commit()
    log_action(db, user, "incident.assign", resource_type="incident", resource_id=inc.id,
               request=request, meta={"assignee_id": payload.assignee_id})
    return _serialize(inc)


@router.post("/{incident_id}/status")
def change_status(
    incident_id: int,
    payload: StatusChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.update")),
    current_org: Organization = Depends(get_current_org),
):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(400, "Invalid status")
    inc = _get_or_404(db, incident_id, org_id=current_org.id)
    if payload.status == "resolved" and not user_has_permission(user, "incident.resolve"):
        raise HTTPException(403, "Missing permission: incident.resolve")
    prev = inc.status
    _apply_status(inc, payload.status)
    db.commit()
    _add_event(db, inc.id, user, "status",
               content=f"Status {prev} → {payload.status}" + (f" ({payload.reason})" if payload.reason else ""),
               meta={"from": prev, "to": payload.status, "reason": payload.reason})
    db.commit()
    log_action(db, user, "incident.status", resource_type="incident", resource_id=inc.id,
               request=request, meta={"from": prev, "to": payload.status})
    return _serialize(inc)


@router.post("/{incident_id}/related")
def link_related(
    incident_id: int,
    payload: RelatedRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.update")),
    current_org: Organization = Depends(get_current_org),
):
    inc = _get_or_404(db, incident_id, org_id=current_org.id)
    alert_set = set(_loads(inc.related_alert_ids, [])) | set(payload.alert_ids)
    inc_set = set(_loads(inc.related_incident_ids, [])) | set(payload.incident_ids)
    inc.related_alert_ids = _dumps(sorted(alert_set))
    inc.related_incident_ids = _dumps(sorted(inc_set))
    db.commit()
    _add_event(db, inc.id, user, "link", content="Related items linked",
               meta={"alerts": list(payload.alert_ids), "incidents": list(payload.incident_ids)})
    db.commit()
    return _serialize(inc)


@router.delete("/{incident_id}")
def delete_incident(
    incident_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("incident.delete")),
    current_org: Organization = Depends(get_current_org),
):
    inc = _get_or_404(db, incident_id, org_id=current_org.id)
    db.query(IncidentEvent).filter(IncidentEvent.incident_id == incident_id).delete()
    db.delete(inc)
    db.commit()
    log_action(db, user, "incident.delete", resource_type="incident", resource_id=incident_id,
               request=request)
    return {"ok": True, "id": incident_id}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _apply_status(inc: Incident, new_status: str) -> None:
    """Set status + the appropriate timestamp(s)."""
    inc.status = new_status
    now = datetime.utcnow()
    if new_status == "investigating" and not inc.acknowledged_at:
        inc.acknowledged_at = now
    elif new_status == "resolved":
        inc.resolved_at = now
    elif new_status == "closed":
        if not inc.resolved_at:
            inc.resolved_at = now
        inc.closed_at = now
