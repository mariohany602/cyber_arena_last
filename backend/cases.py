"""Case Management — module 8 of the SOC platform extension.

Local cases + evidence with chain-of-custody. Designed to mirror TheHive's
case model so we can optionally sync with TheHive without depending on it
being online.

Endpoints under ``/api/soc/cases``.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, Request,
    UploadFile, status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import Case, CaseEvent, CaseEvidence, Organization, User
from rbac import require_permission
from tenant import get_current_org


router = APIRouter(prefix="/api/soc/cases", tags=["SOC / Cases"])


# ---------------------------------------------------------------------------
# Evidence storage: backend/data/case_evidence/<case_id>/<sha256>_<filename>
# ---------------------------------------------------------------------------
EVIDENCE_ROOT = Path(__file__).resolve().parent / "data" / "case_evidence"
EVIDENCE_ROOT.mkdir(parents=True, exist_ok=True)


VALID_STATUSES = {"open", "in_progress", "closed"}
VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}
VALID_TLP = {"white", "green", "amber", "red"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CaseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    summary: Optional[str] = None
    severity: str = "medium"
    status: str = "open"
    tlp: str = "amber"
    assignee_id: Optional[int] = None
    tags: List[str] = []


class CasePatch(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    status: Optional[str] = None
    severity: Optional[str] = None
    tlp: Optional[str] = None
    assignee_id: Optional[int] = None
    thehive_case_id: Optional[str] = None
    tags: Optional[List[str]] = None
    resolution: Optional[str] = None


class CaseEventCreate(BaseModel):
    kind: str = "note"
    content: Optional[str] = None
    meta: dict[str, Any] = {}


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


def _serialize(c: Case) -> dict[str, Any]:
    return {
        "id": c.id,
        "title": c.title,
        "summary": c.summary,
        "status": c.status,
        "severity": c.severity,
        "tlp": c.tlp,
        "created_by": c.created_by,
        "assignee_id": c.assignee_id,
        "thehive_case_id": c.thehive_case_id,
        "tags": _loads(c.tags, []),
        "resolution": c.resolution,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "closed_at": c.closed_at.isoformat() if c.closed_at else None,
    }


def _serialize_evt(e: CaseEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "case_id": e.case_id,
        "user_id": e.user_id,
        "kind": e.kind,
        "content": e.content,
        "meta": _loads(e.meta_json, {}),
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _serialize_evidence(ev: CaseEvidence) -> dict[str, Any]:
    return {
        "id": ev.id,
        "case_id": ev.case_id,
        "uploaded_by": ev.uploaded_by,
        "name": ev.name,
        "kind": ev.kind,
        "mime_type": ev.mime_type,
        "size_bytes": ev.size_bytes,
        "sha256": ev.sha256,
        "description": ev.description,
        "custody_log": _loads(ev.custody_log, []),
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
    }


def _add_event(db: Session, case_id: int, user: Optional[User], kind: str,
               content: Optional[str] = None, meta: Optional[dict] = None) -> CaseEvent:
    e = CaseEvent(
        case_id=case_id,
        user_id=user.id if user else None,
        kind=kind,
        content=content,
        meta_json=_dumps(meta or {}),
    )
    db.add(e)
    db.flush()
    return e


def _get_or_404(db: Session, case_id: int, org_id: int | None = None) -> Case:
    q = db.query(Case).filter(Case.id == case_id)
    if org_id is not None:
        # Multi-tenant: every case lookup is scoped to the caller's org so
        # an id-guess from another tenant returns 404 instead of leaking.
        q = q.filter(Case.organization_id == org_id)
    c = q.first()
    if not c:
        raise HTTPException(404, "Case not found")
    return c


def _push_custody(ev: CaseEvidence, user: User, action: str, note: str = "") -> None:
    log = _loads(ev.custody_log, [])
    log.append({
        "at": datetime.utcnow().isoformat() + "Z",
        "by_user_id": user.id if user else None,
        "by_email": getattr(user, "email", None),
        "action": action,
        "note": note,
    })
    ev.custody_log = _dumps(log)


# ---------------------------------------------------------------------------
# Case CRUD
# ---------------------------------------------------------------------------
@router.get("")
def list_cases(
    status_: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("case.read")),
    current_org: Organization = Depends(get_current_org),
):
    qry = db.query(Case).filter(Case.organization_id == current_org.id)
    if status_:
        qry = qry.filter(Case.status == status_)
    if severity:
        qry = qry.filter(Case.severity == severity)
    if assignee_id is not None:
        qry = qry.filter(Case.assignee_id == assignee_id)
    if q:
        like = f"%{q}%"
        qry = qry.filter((Case.title.ilike(like)) | (Case.summary.ilike(like)))
    total = qry.count()
    rows = qry.order_by(Case.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.create")),
    current_org: Organization = Depends(get_current_org),
):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(400, "Invalid status")
    if payload.severity not in VALID_SEVERITIES:
        raise HTTPException(400, "Invalid severity")
    if payload.tlp not in VALID_TLP:
        raise HTTPException(400, "Invalid TLP")

    c = Case(
        organization_id=current_org.id,
        title=payload.title,
        summary=payload.summary,
        status=payload.status,
        severity=payload.severity,
        tlp=payload.tlp,
        created_by=user.id,
        assignee_id=payload.assignee_id,
        tags=_dumps(payload.tags),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    _add_event(db, c.id, user, "created", content=f"Case '{c.title}' opened")
    db.commit()
    log_action(db, user, "case.create", resource_type="case", resource_id=c.id, request=request)
    return _serialize(c)


@router.get("/{case_id}")
def get_case(
    case_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("case.read")),
    current_org: Organization = Depends(get_current_org),
):
    c = _get_or_404(db, case_id, org_id=current_org.id)
    events = (
        db.query(CaseEvent).filter(CaseEvent.case_id == case_id)
        .order_by(CaseEvent.created_at.asc()).all()
    )
    evidence = (
        db.query(CaseEvidence).filter(CaseEvidence.case_id == case_id)
        .order_by(CaseEvidence.created_at.desc()).all()
    )
    data = _serialize(c)
    data["events"] = [_serialize_evt(e) for e in events]
    data["evidence"] = [_serialize_evidence(e) for e in evidence]
    return data


@router.patch("/{case_id}")
def patch_case(
    case_id: int,
    payload: CasePatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.update")),
    current_org: Organization = Depends(get_current_org),
):
    c = _get_or_404(db, case_id, org_id=current_org.id)
    changes: dict[str, Any] = {}

    if payload.status is not None and payload.status != c.status:
        if payload.status not in VALID_STATUSES:
            raise HTTPException(400, "Invalid status")
        changes["status"] = (c.status, payload.status)
        c.status = payload.status
        if payload.status == "closed":
            c.closed_at = datetime.utcnow()

    for field in ("title", "summary", "severity", "tlp", "assignee_id",
                  "thehive_case_id", "resolution"):
        new = getattr(payload, field)
        if new is not None and new != getattr(c, field):
            if field == "severity" and new not in VALID_SEVERITIES:
                raise HTTPException(400, "Invalid severity")
            if field == "tlp" and new not in VALID_TLP:
                raise HTTPException(400, "Invalid TLP")
            changes[field] = (getattr(c, field), new)
            setattr(c, field, new)

    if payload.tags is not None:
        c.tags = _dumps(payload.tags)
        changes["tags"] = ("…", payload.tags)

    if not changes:
        return _serialize(c)

    db.commit()
    db.refresh(c)
    _add_event(db, c.id, user, "update", content="Case updated",
               meta={k: {"from": str(v[0]), "to": str(v[1])} for k, v in changes.items()})
    db.commit()
    log_action(db, user, "case.update", resource_type="case", resource_id=c.id,
               request=request, meta={"fields": list(changes.keys())})
    return _serialize(c)


@router.delete("/{case_id}")
def delete_case(
    case_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.delete")),
    current_org: Organization = Depends(get_current_org),
):
    c = _get_or_404(db, case_id, org_id=current_org.id)
    db.query(CaseEvent).filter(CaseEvent.case_id == case_id).delete()
    # Evidence rows + files
    for ev in db.query(CaseEvidence).filter(CaseEvidence.case_id == case_id).all():
        try:
            if ev.storage_path and os.path.exists(ev.storage_path):
                os.unlink(ev.storage_path)
        except Exception:
            pass
        db.delete(ev)
    db.delete(c)
    db.commit()
    log_action(db, user, "case.delete", resource_type="case", resource_id=case_id, request=request)
    return {"ok": True, "id": case_id}


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------
@router.post("/{case_id}/events")
def add_case_event(
    case_id: int,
    payload: CaseEventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.update")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, case_id, org_id=current_org.id)
    e = _add_event(db, case_id, user, payload.kind, payload.content, payload.meta)
    db.commit()
    db.refresh(e)
    return _serialize_evt(e)


@router.get("/{case_id}/events")
def list_case_events(
    case_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("case.read")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, case_id, org_id=current_org.id)
    return [
        _serialize_evt(e)
        for e in db.query(CaseEvent).filter(CaseEvent.case_id == case_id)
        .order_by(CaseEvent.created_at.asc()).all()
    ]


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------
@router.post("/{case_id}/evidence")
async def upload_evidence(
    case_id: int,
    request: Request,
    description: Optional[str] = Form(None),
    kind: str = Form("file"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.evidence.upload")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, case_id, org_id=current_org.id)
    case_dir = EVIDENCE_ROOT / str(case_id)
    case_dir.mkdir(parents=True, exist_ok=True)

    contents = await file.read()
    sha256 = hashlib.sha256(contents).hexdigest()
    safe_name = (file.filename or "evidence").replace("/", "_").replace("\\", "_")
    storage_path = case_dir / f"{sha256[:12]}_{safe_name}"
    storage_path.write_bytes(contents)

    ev = CaseEvidence(
        case_id=case_id,
        uploaded_by=user.id,
        name=safe_name,
        kind=kind,
        mime_type=file.content_type,
        size_bytes=len(contents),
        sha256=sha256,
        storage_path=str(storage_path),
        description=description,
        custody_log="[]",
    )
    _push_custody(ev, user, "uploaded", note=f"size={len(contents)} mime={file.content_type}")
    db.add(ev)
    db.commit()
    db.refresh(ev)

    _add_event(db, case_id, user, "attach", content=f"Evidence '{safe_name}' attached",
               meta={"evidence_id": ev.id, "sha256": sha256, "size": len(contents)})
    db.commit()
    log_action(db, user, "case.evidence.upload", resource_type="case", resource_id=case_id,
               request=request, meta={"name": safe_name, "sha256": sha256})
    return _serialize_evidence(ev)


@router.get("/{case_id}/evidence")
def list_evidence(
    case_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("case.read")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, case_id, org_id=current_org.id)
    rows = (
        db.query(CaseEvidence).filter(CaseEvidence.case_id == case_id)
        .order_by(CaseEvidence.created_at.desc()).all()
    )
    return [_serialize_evidence(e) for e in rows]


@router.get("/{case_id}/evidence/{evidence_id}/download")
def download_evidence(
    case_id: int,
    evidence_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.read")),
    current_org: Organization = Depends(get_current_org),
):
    # Verify the parent case belongs to the caller's org before any
    # evidence lookup — otherwise an id-guess could leak a download.
    _get_or_404(db, case_id, org_id=current_org.id)
    ev = (
        db.query(CaseEvidence)
        .filter(CaseEvidence.id == evidence_id, CaseEvidence.case_id == case_id)
        .first()
    )
    if not ev or not ev.storage_path or not os.path.exists(ev.storage_path):
        raise HTTPException(404, "Evidence not found")
    _push_custody(ev, user, "downloaded")
    db.commit()
    log_action(db, user, "case.evidence.download", resource_type="case_evidence",
               resource_id=ev.id, request=request)
    return FileResponse(ev.storage_path, filename=ev.name, media_type=ev.mime_type or "application/octet-stream")


@router.delete("/{case_id}/evidence/{evidence_id}")
def delete_evidence(
    case_id: int,
    evidence_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("case.delete")),
    current_org: Organization = Depends(get_current_org),
):
    _get_or_404(db, case_id, org_id=current_org.id)
    ev = (
        db.query(CaseEvidence)
        .filter(CaseEvidence.id == evidence_id, CaseEvidence.case_id == case_id)
        .first()
    )
    if not ev:
        raise HTTPException(404, "Evidence not found")
    try:
        if ev.storage_path and os.path.exists(ev.storage_path):
            os.unlink(ev.storage_path)
    except Exception:
        pass
    db.delete(ev)
    db.commit()
    log_action(db, user, "case.evidence.delete", resource_type="case_evidence",
               resource_id=evidence_id, request=request)
    return {"ok": True, "id": evidence_id}
