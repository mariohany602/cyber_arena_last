"""RBAC admin endpoints — module 11 of the SOC platform extension.

These endpoints expose:

* ``GET /api/soc/rbac/me`` — current user's role + effective permissions
  (used by the frontend to gate UI affordances).
* ``GET /api/soc/rbac/roles`` — catalogue of roles + permission matrix.
* ``GET /api/soc/rbac/users`` — list users with their roles (admin only).
* ``POST /api/soc/rbac/users/{id}/role`` — set a user's role (admin only).

This is additive — the existing ``/api/auth/me`` endpoint keeps working.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from audit_log import log_action
from auth import get_current_user
from database import get_db
from models import User
from rbac import (
    ALL_ROLES, PERMISSIONS, ROLE_PERMISSIONS,
    get_user_permissions, require_role,
)


router = APIRouter(prefix="/api/soc/rbac", tags=["SOC / RBAC"])


class SetRoleRequest(BaseModel):
    role: str


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": getattr(user, "role", "analyst") or "analyst",
        "permissions": sorted(get_user_permissions(user)),
    }


@router.get("/roles")
def roles(_user: User = Depends(get_current_user)):
    return {
        "roles": list(ALL_ROLES),
        "permissions": sorted(PERMISSIONS),
        "matrix": {role: sorted(perms) for role, perms in ROLE_PERMISSIONS.items()},
    }


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    return [
        {"id": u.id, "email": u.email, "username": u.username,
         "role": getattr(u, "role", "analyst") or "analyst",
         "is_active": u.is_active}
        for u in db.query(User).order_by(User.id.asc()).all()
    ]


@router.post("/users/{user_id}/role")
def set_role(
    user_id: int,
    payload: SetRoleRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("admin")),
):
    role = payload.role.lower().strip()
    if role not in ALL_ROLES:
        raise HTTPException(400, f"Invalid role. Valid: {list(ALL_ROLES)}")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    prev = getattr(u, "role", "analyst") or "analyst"
    u.role = role
    db.commit()
    log_action(db, actor, "user.role.change", resource_type="user", resource_id=u.id,
               request=request, meta={"from": prev, "to": role})
    return {"id": u.id, "role": u.role}
