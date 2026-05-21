"""Multi-tenancy primitives — resolve the active Organization for a request.

Every tenant-owned row in the platform carries `organization_id`. Routers
get the active org via the ``get_current_org`` dependency below and filter
their queries by it. This module is intentionally tiny — keeping the
tenancy contract in one place means it's easy to audit.

Resolution order for the active org on a request:

1. ``X-Org-Id`` header (used by the frontend when a user belongs to more
   than one org and is switching between them).
2. ``org_id`` claim baked into the JWT at login (the user's default org).
3. The user's first (oldest) ``OrgMembership`` row.

If the resolved org isn't one the user is a member of, the request is
rejected with HTTP 403 — this prevents header-spoofing from leaking
cross-tenant data.
"""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Organization, OrgMembership, User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def slugify(name: str) -> str:
    """Reduce a free-text company name to a URL-safe slug."""
    out = []
    for ch in (name or "").lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_." and (out and out[-1] != "-"):
            out.append("-")
    slug = "".join(out).strip("-") or "org"
    return slug[:48]


def unique_slug(db: Session, base: str) -> str:
    """Return a slug that doesn't collide with existing organizations."""
    slug = slugify(base)
    if not db.query(Organization).filter(Organization.slug == slug).first():
        return slug
    # Append a short suffix until free.
    for _ in range(10):
        candidate = f"{slug}-{secrets.token_hex(2)}"
        if not db.query(Organization).filter(Organization.slug == candidate).first():
            return candidate
    raise RuntimeError("Could not allocate a unique slug")


def new_enrollment_key() -> str:
    """Opaque, URL-safe enrollment key for Wazuh agent installers."""
    return secrets.token_urlsafe(24)


def user_memberships(db: Session, user: User) -> list[OrgMembership]:
    return (
        db.query(OrgMembership)
        .filter(OrgMembership.user_id == user.id)
        .order_by(OrgMembership.joined_at.asc())
        .all()
    )


def user_orgs(db: Session, user: User) -> list[Organization]:
    memberships = user_memberships(db, user)
    if not memberships:
        return []
    ids = [m.organization_id for m in memberships]
    return db.query(Organization).filter(Organization.id.in_(ids)).all()


def is_member(db: Session, user: User, org_id: int) -> Optional[OrgMembership]:
    return (
        db.query(OrgMembership)
        .filter(OrgMembership.user_id == user.id,
                OrgMembership.organization_id == org_id)
        .first()
    )


# ---------------------------------------------------------------------------
# Dependency
# ---------------------------------------------------------------------------
def get_current_org(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_org_id: Optional[str] = Header(None, alias="X-Org-Id"),
) -> Organization:
    """Resolve the active Organization for this request.

    Order: explicit ``X-Org-Id`` header → user's first membership. (We don't
    yet bake org_id into the JWT, so step 2 of the docstring is currently
    a TODO; falling straight through to membership lookup is fine while
    each user has exactly one org.)
    """
    target_org_id: Optional[int] = None
    if x_org_id:
        try:
            target_org_id = int(x_org_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid X-Org-Id header")

    memberships = user_memberships(db, user)
    if not memberships:
        # Self-heal: every authenticated user MUST have an org. If they
        # don't (e.g. legacy account predating multi-tenancy and the
        # migration hasn't run), surface a 409 with a clear message so the
        # frontend can prompt re-onboarding instead of returning empty
        # data that hides the bug.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No organization for user — run migrate_to_multitenant.py",
        )

    if target_org_id is not None:
        m = next((m for m in memberships if m.organization_id == target_org_id), None)
        if not m:
            raise HTTPException(403, "Not a member of the requested organization")
        org = db.query(Organization).filter(Organization.id == target_org_id).first()
        if not org:
            raise HTTPException(404, "Organization not found")
        return org

    org = db.query(Organization).filter(Organization.id == memberships[0].organization_id).first()
    if not org:
        raise HTTPException(500, "Membership references missing organization")
    return org


def get_current_membership(
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> OrgMembership:
    """Like ``get_current_org`` but also returns the user's role in that org."""
    m = is_member(db, user, org.id)
    if not m:
        raise HTTPException(403, "Not a member of this organization")
    return m


def require_org_role(*roles: str):
    """Dependency factory: gate an endpoint by the user's *org-level* role
    (owner > admin > analyst > viewer). Distinct from the platform-wide
    RBAC layer in rbac.py.
    """
    valid = {"owner", "admin", "analyst", "viewer"}
    rs = set(roles) or valid
    bad = rs - valid
    if bad:
        raise RuntimeError(f"Unknown org role(s): {bad}")

    def dep(m: OrgMembership = Depends(get_current_membership)) -> OrgMembership:
        if m.role not in rs:
            raise HTTPException(403, f"Requires org role in {sorted(rs)}, you are '{m.role}'")
        return m
    return dep


# ---------------------------------------------------------------------------
# Plan / feature gating
# ---------------------------------------------------------------------------
# Source of truth for plan catalogue. Seeded on startup if the table is empty.
# Each plan's ``features`` blob is what the upgrade UI displays and what
# ``require_feature(...)`` checks against.
PLAN_CATALOGUE = [
    {
        "code": "free",
        "name": "Free",
        "price_monthly_cents": 0,
        "sort_order": 0,
        "features": {
            "sqlmap": False,
            "nuclei": False,
            "ai_assistant": False,
            "max_users": 3,
            "max_engagements": 10,
        },
    },
    {
        "code": "starter",
        "name": "Starter",
        "price_monthly_cents": 4900,
        "sort_order": 1,
        "features": {
            "sqlmap": True,
            "nuclei": False,
            "ai_assistant": False,
            "max_users": 10,
            "max_engagements": 100,
        },
    },
    {
        "code": "pro",
        "name": "Pro",
        "price_monthly_cents": 19900,
        "sort_order": 2,
        "features": {
            "sqlmap": True,
            "nuclei": True,
            "ai_assistant": True,
            "max_users": 50,
            "max_engagements": 1000,
        },
    },
    {
        "code": "enterprise",
        "name": "Enterprise",
        "price_monthly_cents": 0,  # contact-us
        "sort_order": 3,
        "features": {
            "sqlmap": True,
            "nuclei": True,
            "ai_assistant": True,
            "max_users": -1,
            "max_engagements": -1,
        },
    },
]


def seed_plans(db: Session) -> None:
    """Idempotent — insert the default plan rows if the table is empty,
    and upsert features on existing rows so the catalogue stays in sync
    after a deploy that changes feature flags."""
    import json as _json
    from models import Plan
    for spec in PLAN_CATALOGUE:
        existing = db.query(Plan).filter(Plan.code == spec["code"]).first()
        feats_json = _json.dumps(spec["features"])
        if existing:
            existing.name = spec["name"]
            existing.price_monthly_cents = spec["price_monthly_cents"]
            existing.sort_order = spec["sort_order"]
            existing.features_json = feats_json
        else:
            db.add(Plan(
                code=spec["code"],
                name=spec["name"],
                price_monthly_cents=spec["price_monthly_cents"],
                features_json=feats_json,
                is_public=True,
                sort_order=spec["sort_order"],
            ))
    db.commit()


def plan_features(db: Session, plan_code: str) -> dict:
    """Return the parsed feature dict for the given plan code, or {} if
    the plan isn't seeded."""
    import json as _json
    from models import Plan
    p = db.query(Plan).filter(Plan.code == plan_code).first()
    if not p:
        return {}
    try:
        return _json.loads(p.features_json or "{}")
    except Exception:
        return {}


def require_feature(feature: str):
    """Dependency factory: 403 if the current org's plan doesn't include
    ``feature``. The error body carries enough context for the frontend
    to render an inline upgrade prompt (the current plan, the gated
    feature, and the cheapest plan that unlocks it).

    Usage::

        @app.post("/api/sqlmap")
        def sqlmap_scanner(..., _f = Depends(require_feature("sqlmap"))):
            ...
    """
    def dep(
        org: Organization = Depends(get_current_org),
        db: Session = Depends(get_db),
    ) -> Organization:
        feats = plan_features(db, org.plan)
        if feats.get(feature):
            return org
        # Find the cheapest plan that unlocks this feature so the UI can
        # suggest a direct upgrade target instead of dumping the catalogue.
        unlock = None
        for spec in sorted(PLAN_CATALOGUE, key=lambda s: s["sort_order"]):
            if spec["features"].get(feature):
                unlock = spec["code"]
                break
        raise HTTPException(
            status_code=403,
            detail={
                "error": "feature_locked",
                "feature": feature,
                "current_plan": org.plan,
                "upgrade_to": unlock,
                "message": f"'{feature}' is not included in the {org.plan} plan. "
                           f"Upgrade to {unlock or 'a higher tier'} to unlock it.",
            },
        )
    return dep
