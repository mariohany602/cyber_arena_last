"""Tenant management API — routes under ``/api/org``.

This router is what the SaaS settings page talks to. It exposes the bits
of an Organization a tenant can self-serve:

* read the current org + their plan + enabled features
* manage members + invitations (very minimal for the demo: list, invite
  an existing user, change role, remove)
* switch plan (no Stripe — demo only)
* rotate the Wazuh enrollment key
* (re)provision the org against Wazuh/TheHive

A handful of routes also work for the platform super-admin (User.role
== 'admin' on the platform RBAC), but anything cross-org-admin lives in
a future ``/api/admin`` router, not here.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Organization, OrgMembership, Plan, User
from tenant import (
    get_current_org,
    get_current_membership,
    new_enrollment_key,
    require_org_role,
)


router = APIRouter(prefix="/api/org", tags=["SaaS / Organization"])


VALID_PLANS = {"free", "starter", "pro", "enterprise"}
VALID_ROLES = {"owner", "admin", "analyst", "viewer"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class OrgPatch(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    logo_url: Optional[str] = Field(None, max_length=512)


class PlanChange(BaseModel):
    plan: str  # free | starter | pro | enterprise


class InviteUser(BaseModel):
    """Invite by email. For the demo we only handle the case where the
    user already exists on the platform (we look them up by email and
    attach a membership). Email-based pending invites are a TODO."""
    email: EmailStr
    role: str = "analyst"


class MembershipPatch(BaseModel):
    role: str  # owner | admin | analyst | viewer


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _features_for(db: Session, plan_code: str) -> dict[str, Any]:
    p = db.query(Plan).filter(Plan.code == plan_code).first()
    if not p:
        return {}
    try:
        return json.loads(p.features_json or "{}")
    except Exception:
        return {}


def _serialize_org(org: Organization, *, features: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "logo_url": org.logo_url,
        "plan": org.plan,
        "status": org.status,
        "trial_ends_at": org.trial_ends_at.isoformat() if org.trial_ends_at else None,
        "wazuh_agent_group": org.wazuh_agent_group,
        "thehive_org_name": org.thehive_org_name,
        "shuffle_tag": org.shuffle_tag,
        "enrollment_key": org.enrollment_key,
        "provisioned": bool(org.provisioned),
        "provision_error": org.provision_error,
        "features": features or {},
        "created_at": org.created_at.isoformat() if org.created_at else None,
    }


def _serialize_member(m: OrgMembership, user: User) -> dict[str, Any]:
    return {
        "id": m.id,
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "role": m.role,
        "joined_at": m.joined_at.isoformat() if m.joined_at else None,
    }


# ---------------------------------------------------------------------------
# Public org info
# ---------------------------------------------------------------------------
@router.get("/current")
def get_current(
    org: Organization = Depends(get_current_org),
    membership: OrgMembership = Depends(get_current_membership),
    db: Session = Depends(get_db),
):
    """Return the active org + the caller's role + plan features. The
    frontend hits this once on app load to populate the org context."""
    return {
        **_serialize_org(org, features=_features_for(db, org.plan)),
        "my_role": membership.role,
    }


@router.get("/mine")
def list_my_orgs(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All orgs the current user is a member of — feeds the org-switcher.

    Almost everyone will have exactly one for the demo, but the endpoint
    exists so the UI can render a single-item dropdown today and a real
    multi-org switcher tomorrow without an API change.
    """
    rows = (
        db.query(OrgMembership, Organization)
        .join(Organization, Organization.id == OrgMembership.organization_id)
        .filter(OrgMembership.user_id == user.id)
        .order_by(OrgMembership.joined_at.asc())
        .all()
    )
    return [
        {
            **_serialize_org(o, features=_features_for(db, o.plan)),
            "my_role": m.role,
        }
        for m, o in rows
    ]


@router.patch("/current")
def patch_current_org(
    payload: OrgPatch,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    _m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    changed = False
    if payload.name is not None and payload.name.strip() and payload.name != org.name:
        org.name = payload.name.strip()
        changed = True
    if payload.logo_url is not None and payload.logo_url != org.logo_url:
        org.logo_url = payload.logo_url
        changed = True
    if changed:
        db.commit()
        db.refresh(org)
    return _serialize_org(org, features=_features_for(db, org.plan))


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------
@router.get("/usage")
def get_usage(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
):
    """Per-tenant usage rollup for the Settings → Organization quota tiles.

    Compares live counters (members, scans this month) against the org's
    plan limits so the UI can render progress bars. ``-1`` from the plan
    means "unlimited" and the bar renders as ∞.
    """
    from datetime import datetime, timedelta
    from models import Scan as _Scan

    members = (
        db.query(OrgMembership).filter(OrgMembership.organization_id == org.id).count()
    )
    one_month_ago = datetime.utcnow() - timedelta(days=30)
    scans_30d = (
        db.query(_Scan)
        .filter(_Scan.organization_id == org.id, _Scan.created_at >= one_month_ago)
        .count()
    )
    feats = _features_for(db, org.plan)
    return {
        "plan": org.plan,
        "limits": {
            "max_users": feats.get("max_users"),
            "max_engagements": feats.get("max_engagements"),
        },
        "current": {
            "users": members,
            "scans_30d": scans_30d,
        },
    }


@router.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    """Public plan catalogue used by the upgrade UI."""
    rows = db.query(Plan).filter(Plan.is_public.is_(True)).order_by(Plan.sort_order.asc()).all()
    out = []
    for p in rows:
        try:
            feats = json.loads(p.features_json or "{}")
        except Exception:
            feats = {}
        out.append({
            "code": p.code,
            "name": p.name,
            "price_monthly_cents": p.price_monthly_cents,
            "features": feats,
            "sort_order": p.sort_order,
        })
    return out


@router.post("/plan")
def change_plan(
    payload: PlanChange,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    _m: OrgMembership = Depends(require_org_role("owner")),
):
    """Demo-only plan switch. In production this hooks into Stripe; for
    now the owner can flip plans freely so the professor can see the
    feature-gating UX without paying anything."""
    if payload.plan not in VALID_PLANS:
        raise HTTPException(400, f"Plan must be one of {sorted(VALID_PLANS)}")
    plan = db.query(Plan).filter(Plan.code == payload.plan).first()
    if not plan:
        raise HTTPException(404, f"Plan '{payload.plan}' not configured")
    org.plan = payload.plan
    db.commit()
    db.refresh(org)
    return _serialize_org(org, features=_features_for(db, org.plan))


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------
@router.get("/members")
def list_members(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
):
    rows = (
        db.query(OrgMembership, User)
        .join(User, User.id == OrgMembership.user_id)
        .filter(OrgMembership.organization_id == org.id)
        .order_by(OrgMembership.joined_at.asc())
        .all()
    )
    return [_serialize_member(m, u) for m, u in rows]


@router.post("/invite", status_code=status.HTTP_201_CREATED)
def invite_member(
    payload: InviteUser,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    caller: User = Depends(get_current_user),
    _m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    """Attach an existing platform user to this org.

    Demo simplification: the invitee must already have an account. A
    proper email-invite flow (pending invitation token → signup → join)
    is left for after the demo.
    """
    if payload.role not in VALID_ROLES:
        raise HTTPException(400, f"Role must be one of {sorted(VALID_ROLES)}")
    target = db.query(User).filter(User.email == payload.email).first()
    if not target:
        raise HTTPException(
            404,
            "User not found. Ask them to sign up first; full email-invite "
            "flow is coming after the demo.",
        )

    existing = (
        db.query(OrgMembership)
        .filter(OrgMembership.organization_id == org.id,
                OrgMembership.user_id == target.id)
        .first()
    )
    if existing:
        raise HTTPException(409, "User is already a member of this organization")

    m = OrgMembership(
        organization_id=org.id,
        user_id=target.id,
        role=payload.role,
        invited_by=caller.id,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _serialize_member(m, target)


@router.patch("/members/{user_id}")
def patch_member(
    user_id: int,
    payload: MembershipPatch,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    _m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    if payload.role not in VALID_ROLES:
        raise HTTPException(400, f"Role must be one of {sorted(VALID_ROLES)}")
    m = (
        db.query(OrgMembership)
        .filter(OrgMembership.organization_id == org.id,
                OrgMembership.user_id == user_id)
        .first()
    )
    if not m:
        raise HTTPException(404, "Membership not found")
    # Guard: don't allow demoting the last owner.
    if m.role == "owner" and payload.role != "owner":
        owners = (
            db.query(OrgMembership)
            .filter(OrgMembership.organization_id == org.id,
                    OrgMembership.role == "owner")
            .count()
        )
        if owners <= 1:
            raise HTTPException(409, "Cannot demote the last owner")
    m.role = payload.role
    db.commit()
    db.refresh(m)
    user = db.query(User).filter(User.id == user_id).first()
    return _serialize_member(m, user)


@router.delete("/members/{user_id}")
def remove_member(
    user_id: int,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    caller_m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    m = (
        db.query(OrgMembership)
        .filter(OrgMembership.organization_id == org.id,
                OrgMembership.user_id == user_id)
        .first()
    )
    if not m:
        raise HTTPException(404, "Membership not found")
    if m.role == "owner":
        owners = (
            db.query(OrgMembership)
            .filter(OrgMembership.organization_id == org.id,
                    OrgMembership.role == "owner")
            .count()
        )
        if owners <= 1:
            raise HTTPException(409, "Cannot remove the last owner")
    db.delete(m)
    db.commit()
    return {"ok": True, "user_id": user_id}


# ---------------------------------------------------------------------------
# Wazuh enrollment + provisioning
# ---------------------------------------------------------------------------
@router.post("/enrollment/rotate")
def rotate_enrollment(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    _m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    """Invalidate the current enrollment key and issue a new one. Any
    pre-existing installer one-liners stop working immediately."""
    org.enrollment_key = new_enrollment_key()
    db.commit()
    db.refresh(org)
    return {"enrollment_key": org.enrollment_key}


@router.post("/provision")
def reprovision(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
    _m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    """Re-run live provisioning against Wazuh/TheHive. Useful when those
    machines were offline at signup time and you want to retry."""
    try:
        from tenant_provisioning import provision_tenant
    except Exception as exc:
        raise HTTPException(500, f"Provisioning module unavailable: {exc}")
    try:
        result = provision_tenant(db, org)
        return {"ok": True, "result": result}
    except Exception as exc:
        org.provision_error = str(exc)[:1000]
        db.commit()
        raise HTTPException(502, f"Provisioning failed: {exc}")
