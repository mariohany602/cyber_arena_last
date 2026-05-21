"""One-shot migration: turn the single-tenant DB into a multi-tenant one.

Run once after upgrading the codebase. Safe to re-run — every step is
idempotent and skips work it has already done.

What it does
------------
1.  Creates the new tables (`organizations`, `org_memberships`, `plans`)
    via SQLAlchemy ``Base.metadata.create_all``.
2.  Adds the new `organization_id` column to every pre-existing tenant
    table via raw ``ALTER TABLE ADD COLUMN`` (SQLite supports this since
    3.35; for MySQL/Postgres the ``ADD COLUMN IF NOT EXISTS`` form is
    used). Wrapped in try/except so re-runs are no-ops.
3.  Seeds the four default plans (free / starter / pro / enterprise) with
    sensible feature flags.
4.  For every existing User: creates one Organization
    (``<username>'s workspace``) plus an ``OrgMembership(role='owner')``
    row, then backfills `organization_id` on every row that user owns
    (scans, assets, conversations, …).
5.  Best-effort backfill of `organization_id` on SOC tables that aren't
    user-keyed (cases / incidents / iocs / asset_inventory) using
    `created_by` where available; orphan rows are assigned to the first
    org as a fallback so nothing becomes invisible.

Usage
-----
    cd backend && .venv/bin/python migrate_to_multitenant.py
"""
from __future__ import annotations

import json
import sys
from typing import Optional

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
import models  # noqa: F401 — ensure all tables are imported on Base.metadata
from models import (
    AIConversation,
    Asset,
    AssetInventory,
    AlertTriage,
    AuditLog,
    Case,
    IOC,
    Incident,
    Organization,
    OrgMembership,
    Plan,
    SavedHunt,
    Scan,
    SoarExecution,
    User,
)
from tenant import new_enrollment_key, unique_slug


# Tables that get a new organization_id column. Matches the columns we
# declared in models.py — keep in sync.
ORG_COLUMN_TABLES = [
    "scans",
    "assets",
    "asset_inventory",
    "incidents",
    "cases",
    "iocs",
    "alert_triage",
    "audit_log",
    "ai_conversations",
    "saved_hunts",
    "soar_executions",
]


def _has_column(conn, table: str, column: str) -> bool:
    rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def add_organization_id_columns() -> None:
    """ALTER TABLE … ADD COLUMN organization_id INTEGER (nullable, indexed)."""
    with engine.connect() as conn:
        for table in ORG_COLUMN_TABLES:
            # The table might not exist yet in pristine installs — create_all
            # will handle those. Skip if missing.
            if table not in inspect(engine).get_table_names():
                continue
            if _has_column(conn, table, "organization_id"):
                continue
            print(f"[+] ALTER TABLE {table} ADD COLUMN organization_id")
            conn.exec_driver_sql(
                f"ALTER TABLE {table} ADD COLUMN organization_id INTEGER"
            )
            # Best-effort index. CREATE INDEX IF NOT EXISTS is supported.
            conn.exec_driver_sql(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_organization_id "
                f"ON {table}(organization_id)"
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Plan seeding
# ---------------------------------------------------------------------------
DEFAULT_PLANS = [
    {
        "code": "free",
        "name": "Free",
        "price_monthly_cents": 0,
        "sort_order": 1,
        "features": {
            "nmap": True, "web_crawler": True, "subdomains": True,
            "directories": True, "traffic": True,
            "nikto": False, "nuclei": False, "ffuf": False,
            "sqlmap": False, "vuln_scan": False,
            "ai_assistant": False,
            "soc_siem": True, "soc_xdr": False, "soc_ti": False,
            "thehive": False, "soar": False,
            "max_users": 2, "max_agents": 1, "max_scans_per_month": 25,
            "retention_days": 7,
        },
    },
    {
        "code": "starter",
        "name": "Starter",
        "price_monthly_cents": 4900,
        "sort_order": 2,
        "features": {
            "nmap": True, "web_crawler": True, "subdomains": True,
            "directories": True, "traffic": True,
            "nikto": True, "nuclei": True, "ffuf": True,
            "sqlmap": False, "vuln_scan": True,
            "ai_assistant": False,
            "soc_siem": True, "soc_xdr": True, "soc_ti": False,
            "thehive": False, "soar": False,
            "max_users": 5, "max_agents": 5, "max_scans_per_month": 200,
            "retention_days": 30,
        },
    },
    {
        "code": "pro",
        "name": "Pro",
        "price_monthly_cents": 19900,
        "sort_order": 3,
        "features": {
            "nmap": True, "web_crawler": True, "subdomains": True,
            "directories": True, "traffic": True,
            "nikto": True, "nuclei": True, "ffuf": True,
            "sqlmap": True, "vuln_scan": True,
            "ai_assistant": True,
            "soc_siem": True, "soc_xdr": True, "soc_ti": True,
            "thehive": True, "soar": False,
            "max_users": 15, "max_agents": 25, "max_scans_per_month": -1,
            "retention_days": 90,
        },
    },
    {
        "code": "enterprise",
        "name": "Enterprise",
        "price_monthly_cents": 0,  # "contact us"
        "sort_order": 4,
        "features": {
            "nmap": True, "web_crawler": True, "subdomains": True,
            "directories": True, "traffic": True,
            "nikto": True, "nuclei": True, "ffuf": True,
            "sqlmap": True, "vuln_scan": True,
            "ai_assistant": True,
            "soc_siem": True, "soc_xdr": True, "soc_ti": True,
            "thehive": True, "soar": True,
            "max_users": -1, "max_agents": -1, "max_scans_per_month": -1,
            "retention_days": 365,
        },
    },
]


def seed_plans(db: Session) -> None:
    for p in DEFAULT_PLANS:
        existing = db.query(Plan).filter(Plan.code == p["code"]).first()
        if existing:
            # Refresh feature flags so we can iterate on bundles without
            # a fresh DB. Leave price alone in case it was overridden.
            existing.name = p["name"]
            existing.features_json = json.dumps(p["features"])
            existing.sort_order = p["sort_order"]
            continue
        db.add(Plan(
            code=p["code"],
            name=p["name"],
            price_monthly_cents=p["price_monthly_cents"],
            features_json=json.dumps(p["features"]),
            sort_order=p["sort_order"],
            is_public=True,
        ))
    db.commit()
    print(f"[+] Seeded {len(DEFAULT_PLANS)} plans")


# ---------------------------------------------------------------------------
# Per-user org creation + backfill
# ---------------------------------------------------------------------------
def ensure_org_for_user(db: Session, user: User) -> Organization:
    """Return the user's primary org, creating one if they don't have any."""
    m = (
        db.query(OrgMembership)
        .filter(OrgMembership.user_id == user.id)
        .order_by(OrgMembership.joined_at.asc())
        .first()
    )
    if m:
        return db.query(Organization).filter(Organization.id == m.organization_id).first()

    base = f"{user.username}'s workspace"
    org = Organization(
        name=base,
        slug=unique_slug(db, user.username or user.email.split("@")[0]),
        plan="free",
        status="active",
        enrollment_key=new_enrollment_key(),
        provisioned=False,
    )
    db.add(org)
    db.flush()  # populate org.id
    org.wazuh_agent_group = f"arena_org_{org.id}"
    org.thehive_org_name = org.slug
    org.shuffle_tag = f"arena_org_{org.id}"

    db.add(OrgMembership(
        organization_id=org.id,
        user_id=user.id,
        role="owner",
        invited_by=None,
    ))
    db.commit()
    db.refresh(org)
    print(f"[+] Created org #{org.id} '{org.name}' for user '{user.username}'")
    return org


def backfill_user_owned_rows(db: Session, user: User, org: Organization) -> None:
    """Set organization_id on every row that has the user as owner."""
    updates = [
        (Scan, Scan.user_id, "user_id"),
        (Asset, Asset.user_id, "user_id"),
        (AIConversation, AIConversation.user_id, "user_id"),
        (SavedHunt, SavedHunt.user_id, "user_id"),
        (SoarExecution, SoarExecution.user_id, "user_id"),
    ]
    total = 0
    for Model, col, _label in updates:
        n = (
            db.query(Model)
            .filter(col == user.id, Model.organization_id.is_(None))
            .update({Model.organization_id: org.id}, synchronize_session=False)
        )
        total += n
    if total:
        print(f"    └─ backfilled {total} user-owned rows → org #{org.id}")
    db.commit()


def backfill_soc_tables(db: Session, fallback_org_id: int) -> None:
    """Cases / Incidents / IOCs / AlertTriage / AssetInventory / AuditLog
    aren't user-keyed in the same way. Strategy:
      1) For rows with a `created_by`/`user_id`, look up that user's org.
      2) For orphans, assign them to ``fallback_org_id`` so they stay
         visible to *somebody* rather than vanishing into NULL-land.
    """
    user_to_org = {
        m.user_id: m.organization_id
        for m in db.query(OrgMembership).all()
    }

    def by_user(Model, user_col, label):
        rows = db.query(Model).filter(Model.organization_id.is_(None)).all()
        moved = 0
        orphan = 0
        for r in rows:
            uid = getattr(r, user_col, None)
            target = user_to_org.get(uid) if uid else None
            if target is None:
                target = fallback_org_id
                orphan += 1
            r.organization_id = target
            moved += 1
        if moved:
            print(f"    └─ {label}: {moved} rows backfilled ({orphan} orphans → fallback)")
        db.commit()

    by_user(Case,           "created_by",  "cases")
    by_user(Incident,       "created_by",  "incidents")
    by_user(IOC,            "created_by",  "iocs")
    by_user(AlertTriage,    "updated_by",  "alert_triage")
    by_user(AuditLog,       "user_id",     "audit_log")
    by_user(AssetInventory, None,          "asset_inventory")  # no owner col


def main() -> int:
    print("=" * 60)
    print("Cyber Arena — multi-tenant migration")
    print("=" * 60)

    # 1. Create new tables (orgs/memberships/plans + any other Base tables
    #    that don't exist yet). Existing tables are untouched.
    print("[+] create_all (new tables only)")
    Base.metadata.create_all(bind=engine)

    # 2. Add organization_id column to legacy tables.
    add_organization_id_columns()

    # 3. Seed plans.
    db = SessionLocal()
    try:
        seed_plans(db)

        users = db.query(User).order_by(User.created_at.asc()).all()
        if not users:
            print("[!] No existing users — nothing to backfill. Done.")
            return 0

        print(f"[+] Found {len(users)} existing users; provisioning orgs…")
        first_org_id: Optional[int] = None
        for u in users:
            org = ensure_org_for_user(db, u)
            first_org_id = first_org_id or org.id
            backfill_user_owned_rows(db, u, org)

        # 4. Backfill SOC tables that aren't owned by a single user.
        print("[+] Backfilling SOC tables…")
        backfill_soc_tables(db, fallback_org_id=first_org_id)

        print("[✓] Migration complete.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
