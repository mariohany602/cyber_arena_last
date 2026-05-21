"""Alert Triage — module 2 of the SOC platform extension.

Provides classification (true_positive / false_positive / benign / escalated /
resolved), severity override, assignee, notes, and timeline for any Wazuh /
SIEM alert _id. Co-exists with the existing per-user ``AlertVerdict`` (TP/FP
voting) table which is kept intact.
"""
from __future__ import annotations

import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import AlertTriage, AlertTriageEvent, Incident, User
from rbac import require_permission


router = APIRouter(prefix="/api/soc/triage", tags=["SOC / Alert Triage"])


VALID_CLASSIFICATIONS = {"true_positive", "false_positive", "benign", "escalated", "resolved"}
VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TriageUpdate(BaseModel):
    classification: Optional[str] = None
    severity_override: Optional[str] = None
    assignee_id: Optional[int] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


class LinkRequest(BaseModel):
    incident_id: Optional[int] = None
    case_id: Optional[int] = None


class TriageNote(BaseModel):
    content: str = Field(..., min_length=1)


class BulkClassify(BaseModel):
    alert_ids: List[str]
    classification: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _loads(v: Optional[str], default):
    if not v:
        return default
    try:
        return json.loads(v)
    except Exception:
        return default


def _dumps(v) -> str:
    try:
        return json.dumps(v, default=str)
    except Exception:
        return "[]"


def _serialize(t: AlertTriage) -> dict[str, Any]:
    return {
        "id": t.id,
        "alert_id": t.alert_id,
        "classification": t.classification,
        "severity_override": t.severity_override,
        "assignee_id": t.assignee_id,
        "incident_id": t.incident_id,
        "case_id": t.case_id,
        "notes": t.notes,
        "tags": _loads(t.tags, []),
        "updated_by": t.updated_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _serialize_event(e: AlertTriageEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "alert_id": e.alert_id,
        "user_id": e.user_id,
        "kind": e.kind,
        "content": e.content,
        "meta": _loads(e.meta_json, {}),
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _get_or_create(db: Session, alert_id: str) -> AlertTriage:
    t = db.query(AlertTriage).filter(AlertTriage.alert_id == alert_id).first()
    if not t:
        t = AlertTriage(alert_id=alert_id, tags="[]")
        db.add(t)
        db.flush()
    return t


def _record(db: Session, alert_id: str, user: Optional[User], kind: str,
            content: Optional[str] = None, meta: Optional[dict] = None) -> AlertTriageEvent:
    e = AlertTriageEvent(
        alert_id=alert_id,
        user_id=user.id if user else None,
        kind=kind,
        content=content,
        meta_json=_dumps(meta or {}),
    )
    db.add(e)
    db.flush()
    return e


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/{alert_id}")
def get_triage(
    alert_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("alert.read")),
):
    t = db.query(AlertTriage).filter(AlertTriage.alert_id == alert_id).first()
    events = (
        db.query(AlertTriageEvent).filter(AlertTriageEvent.alert_id == alert_id)
        .order_by(AlertTriageEvent.created_at.asc()).all()
    )
    return {
        "triage": _serialize(t) if t else None,
        "events": [_serialize_event(e) for e in events],
    }


@router.patch("/{alert_id}")
def update_triage(
    alert_id: str,
    payload: TriageUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("alert.triage")),
):
    t = _get_or_create(db, alert_id)
    changes: dict[str, Any] = {}

    if payload.classification is not None and payload.classification != t.classification:
        if payload.classification not in VALID_CLASSIFICATIONS:
            raise HTTPException(400, f"Invalid classification. Valid: {sorted(VALID_CLASSIFICATIONS)}")
        changes["classification"] = (t.classification, payload.classification)
        t.classification = payload.classification

    if payload.severity_override is not None and payload.severity_override != t.severity_override:
        if payload.severity_override not in VALID_SEVERITIES:
            raise HTTPException(400, "Invalid severity")
        changes["severity_override"] = (t.severity_override, payload.severity_override)
        t.severity_override = payload.severity_override

    if payload.assignee_id is not None and payload.assignee_id != t.assignee_id:
        changes["assignee_id"] = (t.assignee_id, payload.assignee_id)
        t.assignee_id = payload.assignee_id

    if payload.notes is not None and payload.notes != t.notes:
        changes["notes"] = ("…", "…")
        t.notes = payload.notes

    if payload.tags is not None:
        t.tags = _dumps(payload.tags)
        changes["tags"] = ("…", payload.tags)

    t.updated_by = user.id

    for kind, (frm, to) in changes.items():
        _record(db, alert_id, user, kind, meta={"from": str(frm), "to": str(to)})

    db.commit()
    db.refresh(t)
    log_action(db, user, "alert.triage", resource_type="alert", resource_id=alert_id,
               request=request, meta={"fields": list(changes.keys())})
    return _serialize(t)


@router.post("/{alert_id}/notes")
def add_note(
    alert_id: str,
    payload: TriageNote,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("alert.triage")),
):
    _get_or_create(db, alert_id)
    e = _record(db, alert_id, user, "note", content=payload.content)
    db.commit()
    db.refresh(e)
    return _serialize_event(e)


@router.post("/{alert_id}/link")
def link_alert(
    alert_id: str,
    payload: LinkRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("alert.triage")),
):
    t = _get_or_create(db, alert_id)
    if payload.incident_id is not None:
        # Also push alert_id into Incident.related_alert_ids for back-reference.
        inc = db.query(Incident).filter(Incident.id == payload.incident_id).first()
        if not inc:
            raise HTTPException(404, "Incident not found")
        ids = set(_loads(inc.related_alert_ids, [])) | {alert_id}
        inc.related_alert_ids = _dumps(sorted(ids))
        t.incident_id = payload.incident_id
    if payload.case_id is not None:
        t.case_id = payload.case_id
    t.updated_by = user.id
    _record(db, alert_id, user, "link", content="Linked",
            meta={"incident_id": payload.incident_id, "case_id": payload.case_id})
    db.commit()
    db.refresh(t)
    log_action(db, user, "alert.link", resource_type="alert", resource_id=alert_id,
               request=request, meta={"incident": payload.incident_id, "case": payload.case_id})
    return _serialize(t)


@router.post("/bulk-classify")
def bulk_classify(
    payload: BulkClassify,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("alert.triage")),
):
    if payload.classification not in VALID_CLASSIFICATIONS:
        raise HTTPException(400, "Invalid classification")
    n = 0
    for aid in payload.alert_ids:
        t = _get_or_create(db, aid)
        prev = t.classification
        t.classification = payload.classification
        t.updated_by = user.id
        _record(db, aid, user, "classification",
                meta={"from": prev, "to": payload.classification, "bulk": True})
        n += 1
    db.commit()
    log_action(db, user, "alert.triage.bulk", request=request,
               meta={"count": n, "classification": payload.classification})
    return {"ok": True, "count": n}


@router.get("")
def list_triage(
    classification: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("alert.read")),
):
    q = db.query(AlertTriage)
    if classification:
        q = q.filter(AlertTriage.classification == classification)
    if assignee_id is not None:
        q = q.filter(AlertTriage.assignee_id == assignee_id)
    total = q.count()
    rows = q.order_by(AlertTriage.updated_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(r) for r in rows]}
