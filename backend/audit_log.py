"""Audit logging utility + read-only router.

`log_action()` is the single entry point new modules use to record a
privileged action. It never raises — audit failures must not break the
underlying request.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from models import AuditLog, User
from rbac import require_permission


def log_action(
    db: Session,
    user: Optional[User],
    action: str,
    *,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    status: str = "success",
    request: Optional[Request] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """Record a privileged action. Best-effort; never raises."""
    try:
        ip = None
        if request is not None and request.client:
            ip = request.client.host
        entry = AuditLog(
            user_id=user.id if user else None,
            actor_email=getattr(user, "email", None) if user else None,
            actor_role=getattr(user, "role", None) if user else None,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            status=status,
            ip=ip,
            meta_json=json.dumps(meta or {}, default=str),
        )
        db.add(entry)
        db.commit()
    except Exception:  # noqa: BLE001 — audit must never break requests
        try:
            db.rollback()
        except Exception:
            pass


router = APIRouter(prefix="/api/soc/audit", tags=["SOC / Audit"])


@router.get("")
def list_audit(
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("audit.read")),
):
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        q = q.filter(AuditLog.action == action)
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "actor_email": r.actor_email,
                "actor_role": r.actor_role,
                "action": r.action,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "status": r.status,
                "ip": r.ip,
                "meta": _safe_json(r.meta_json),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


def _safe_json(value: Optional[str]) -> Any:
    if not value:
        return {}
    try:
        return json.loads(value)
    except Exception:
        return {}
