"""Role-Based Access Control for the SOC platform extension (Phase 1).

This module is **additive only** — existing routes that use ``get_current_user``
keep working exactly as before. New SOC routes opt-in to RBAC via the
``require_permission`` / ``require_role`` dependencies.

Roles (stored on ``User.role``):

    admin                  — full access, including user/role management
    incident_responder     — incidents/cases full, SOAR execute, triage
    tier2                  — incidents create/update, cases collaborate, SOAR low-risk
    tier1 / analyst        — triage alerts, create incidents, read-only on SOAR
    readonly               — view everything, mutate nothing

The decision logic is centralised here so new modules just declare the
permission they need.
"""
from __future__ import annotations

from typing import Iterable, Set

from fastapi import Depends, HTTPException, status

from auth import get_current_user
from models import User


# ---------------------------------------------------------------------------
# Permission catalogue. Add new permissions here so they're discoverable.
# ---------------------------------------------------------------------------
PERMISSIONS: Set[str] = {
    # Incident management
    "incident.read", "incident.create", "incident.update", "incident.assign",
    "incident.delete", "incident.resolve",
    # Case management
    "case.read", "case.create", "case.update", "case.delete", "case.evidence.upload",
    # Alert triage
    "alert.read", "alert.triage", "alert.assign",
    # IOC intel
    "ioc.read", "ioc.create", "ioc.update", "ioc.delete", "ioc.enrich",
    # Threat hunting
    "hunt.read", "hunt.execute", "hunt.save", "hunt.delete",
    # SOAR
    "soar.read", "soar.execute.low", "soar.execute.high",
    # Assets
    "asset.read", "asset.update",
    # MITRE / dashboards
    "mitre.read", "exec.read",
    # Admin
    "user.manage", "audit.read", "settings.manage",
    # AI assistant
    "ai.chat",
}

# Role → permissions matrix. "admin" gets everything implicitly.
ROLE_PERMISSIONS: dict[str, Set[str]] = {
    "readonly": {
        "incident.read", "case.read", "alert.read", "ioc.read", "hunt.read",
        "soar.read", "asset.read", "mitre.read", "exec.read", "ai.chat",
    },
    "analyst": {
        "incident.read", "incident.create",
        "case.read",
        "alert.read", "alert.triage",
        "ioc.read",
        "hunt.read", "hunt.execute", "hunt.save",
        "soar.read",
        "asset.read",
        "mitre.read", "exec.read",
        "ai.chat",
    },
    "tier1": {
        "incident.read", "incident.create", "incident.update",
        "case.read",
        "alert.read", "alert.triage", "alert.assign",
        "ioc.read", "ioc.create", "ioc.enrich",
        "hunt.read", "hunt.execute", "hunt.save", "hunt.delete",
        "soar.read", "soar.execute.low",
        "asset.read",
        "mitre.read", "exec.read",
        "ai.chat",
    },
    "tier2": {
        "incident.read", "incident.create", "incident.update", "incident.assign", "incident.resolve",
        "case.read", "case.create", "case.update", "case.evidence.upload",
        "alert.read", "alert.triage", "alert.assign",
        "ioc.read", "ioc.create", "ioc.update", "ioc.enrich",
        "hunt.read", "hunt.execute", "hunt.save", "hunt.delete",
        "soar.read", "soar.execute.low",
        "asset.read", "asset.update",
        "mitre.read", "exec.read",
        "ai.chat",
    },
    "incident_responder": {
        "incident.read", "incident.create", "incident.update", "incident.assign",
        "incident.resolve", "incident.delete",
        "case.read", "case.create", "case.update", "case.delete", "case.evidence.upload",
        "alert.read", "alert.triage", "alert.assign",
        "ioc.read", "ioc.create", "ioc.update", "ioc.delete", "ioc.enrich",
        "hunt.read", "hunt.execute", "hunt.save", "hunt.delete",
        "soar.read", "soar.execute.low", "soar.execute.high",
        "asset.read", "asset.update",
        "mitre.read", "exec.read",
        "audit.read",
        "ai.chat",
    },
    # admin is handled by short-circuit below.
}

ALL_ROLES: tuple[str, ...] = (
    "admin", "incident_responder", "tier2", "tier1", "analyst", "readonly",
)


def get_user_permissions(user: User) -> Set[str]:
    role = (getattr(user, "role", None) or "analyst").lower()
    if role == "admin":
        return set(PERMISSIONS)
    return set(ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["analyst"]))


def user_has_permission(user: User, permission: str) -> bool:
    if not user:
        return False
    role = (getattr(user, "role", None) or "analyst").lower()
    if role == "admin":
        return True
    return permission in ROLE_PERMISSIONS.get(role, set())


# ---------------------------------------------------------------------------
# FastAPI dependency factories
# ---------------------------------------------------------------------------
def require_permission(permission: str):
    """Return a FastAPI dependency that 403s if the current user lacks
    ``permission``. Also injects the user for the route handler to use."""
    if permission not in PERMISSIONS:
        # Fail loudly at import-time during dev so typos don't get silently allowed.
        raise RuntimeError(f"Unknown permission '{permission}'")

    def _dep(user: User = Depends(get_current_user)) -> User:
        if not user_has_permission(user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {permission}",
            )
        return user

    return _dep


def require_role(*roles: str):
    """Return a FastAPI dependency that 403s unless the user has one of
    ``roles`` (admin always passes)."""
    role_set = {r.lower() for r in roles}

    def _dep(user: User = Depends(get_current_user)) -> User:
        role = (getattr(user, "role", None) or "analyst").lower()
        if role == "admin" or role in role_set:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires one of roles: {sorted(role_set)}",
        )

    return _dep
