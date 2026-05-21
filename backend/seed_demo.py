"""One-shot demo seeder for the graduation defense.

Idempotent: re-running deletes the prior demo state (only) and re-creates
it from scratch, so the demo is always identical and never depends on
external systems (Wazuh, TheHive, SMTP, …) being up.

Creates two tenant orgs, each with an owner + an analyst, a realistic
batch of scan history, and a few audit-log entries. After running:

    Acme Corp     (plan: pro)   alice@acme.com   / Demo!1234   (owner)
                                arthur@acme.com  / Demo!1234   (analyst)
    Globex Inc    (plan: free)  bob@globex.com   / Demo!1234   (owner)
                                betty@globex.com / Demo!1234   (analyst)

Usage:
    cd backend && .venv/bin/python seed_demo.py
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta

from auth import get_password_hash
from database import SessionLocal
from models import AuditLog, OrgMembership, Organization, Scan, User
from tenant import new_enrollment_key, seed_plans, unique_slug


DEMO_PASSWORD = "Demo!1234"
DEMO_USERNAMES = {"alice", "arthur", "bob", "betty"}
DEMO_ORG_SLUGS = {"acme-corp", "globex-inc"}


def _delete_prior_demo(db) -> None:
    """Remove anything we previously seeded so this is repeatable."""
    orgs = db.query(Organization).filter(Organization.slug.in_(DEMO_ORG_SLUGS)).all()
    org_ids = [o.id for o in orgs]
    if org_ids:
        db.query(Scan).filter(Scan.organization_id.in_(org_ids)).delete(synchronize_session=False)
        db.query(AuditLog).filter(AuditLog.organization_id.in_(org_ids)).delete(synchronize_session=False)
        db.query(OrgMembership).filter(OrgMembership.organization_id.in_(org_ids)).delete(synchronize_session=False)
        for o in orgs:
            db.delete(o)
    db.query(User).filter(User.username.in_(DEMO_USERNAMES)).delete(synchronize_session=False)
    db.commit()


def _make_user(db, *, username: str, email: str) -> User:
    u = User(
        username=username,
        email=email,
        hashed_password=get_password_hash(DEMO_PASSWORD),
        is_active=True,
    )
    db.add(u)
    db.flush()
    return u


def _make_org(db, *, name: str, plan: str) -> Organization:
    org = Organization(
        name=name,
        slug=unique_slug(db, name),
        plan=plan,
        status="active",
        enrollment_key=new_enrollment_key(),
        provisioned=False,
    )
    db.add(org)
    db.flush()
    org.wazuh_agent_group = f"arena_org_{org.id}"
    org.thehive_org_name = org.slug
    org.shuffle_tag = f"arena_org_{org.id}"
    return org


def _add_member(db, org: Organization, user: User, role: str) -> None:
    db.add(OrgMembership(organization_id=org.id, user_id=user.id, role=role))


def _seed_scans(db, org: Organization, user: User, *, count: int) -> None:
    """Insert realistic-looking scan history so /history isn't empty."""
    tools = ["nmap", "nikto", "directories", "subdomains", "ffuf", "sqlmap", "nuclei"]
    targets = [
        "10.0.0.5", "192.168.1.10", "testphp.vulnweb.com",
        "demo.testfire.net", "scanme.nmap.org", "juice-shop.local",
    ]
    risk_labels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    now = datetime.utcnow()
    for i in range(count):
        tool = random.choice(tools)
        target = random.choice(targets)
        sev = {"CRITICAL": random.randint(0, 2), "HIGH": random.randint(0, 4),
               "MEDIUM": random.randint(0, 6), "LOW": random.randint(0, 8),
               "INFO": random.randint(0, 12)}
        risk = (
            sev["CRITICAL"] * 25 + sev["HIGH"] * 12
            + sev["MEDIUM"] * 5 + sev["LOW"] * 2
        )
        risk = min(99, risk)
        label = "INFO" if risk < 10 else ("LOW" if risk < 30 else
                ("MEDIUM" if risk < 55 else ("HIGH" if risk < 80 else "CRITICAL")))
        total = sum(sev.values())
        s = Scan(
            user_id=user.id,
            organization_id=org.id,
            tool=tool,
            target=target,
            engine=tool,
            status="success",
            findings_json=json.dumps([]),
            raw_json=json.dumps({"demo": True}),
            risk_score=float(risk),
            severity_counts_json=json.dumps(sev),
            summary=f"{total} findings — risk {risk}/100 ({label.lower()})",
        )
        # Spread the rows across the last 14 days so charts look populated.
        s.created_at = now - timedelta(hours=random.randint(0, 14 * 24))
        db.add(s)


def _seed_audit(db, org: Organization, user: User) -> None:
    """A handful of audit-log entries so the /audit tab has content."""
    entries = [
        ("auth.login",          "success", {}),
        ("org.plan_change",     "success", {"from": "free", "to": org.plan}),
        ("agent.enroll",        "success", {"agent": f"web-{org.id}.example"}),
        ("scan.run",            "success", {"tool": "nmap", "target": "10.0.0.5"}),
        ("scan.run",            "success", {"tool": "nuclei", "target": "testphp.vulnweb.com"}),
        ("incident.create",     "success", {"title": "Brute-force from 203.0.113.7"}),
        ("agent.revoke",        "denied",  {"reason": "not owner"}),
    ]
    now = datetime.utcnow()
    for i, (action, status, meta) in enumerate(entries):
        a = AuditLog(
            organization_id=org.id,
            user_id=user.id,
            actor_email=user.email,
            actor_role="owner",
            action=action,
            resource_type=action.split(".")[0],
            status=status,
            ip="127.0.0.1",
            meta_json=json.dumps(meta),
        )
        a.created_at = now - timedelta(hours=i * 2)
        db.add(a)


def seed() -> None:
    db = SessionLocal()
    try:
        seed_plans(db)
        _delete_prior_demo(db)

        # --- Acme (Pro) ---
        acme = _make_org(db, name="Acme Corp", plan="pro")
        alice = _make_user(db, username="alice",  email="alice@acme.com")
        arthur = _make_user(db, username="arthur", email="arthur@acme.com")
        _add_member(db, acme, alice,  "owner")
        _add_member(db, acme, arthur, "analyst")
        _seed_scans(db, acme, alice, count=18)
        _seed_audit(db, acme, alice)

        # --- Globex (Free) ---
        globex = _make_org(db, name="Globex Inc", plan="free")
        bob = _make_user(db, username="bob",   email="bob@globex.com")
        betty = _make_user(db, username="betty", email="betty@globex.com")
        _add_member(db, globex, bob,   "owner")
        _add_member(db, globex, betty, "analyst")
        _seed_scans(db, globex, bob, count=7)
        _seed_audit(db, globex, bob)

        db.commit()
    finally:
        db.close()

    print("Demo data seeded.")
    print()
    print("  Acme Corp  (pro)   alice@acme.com   / Demo!1234   (owner)")
    print("                      arthur@acme.com  / Demo!1234   (analyst)")
    print("  Globex Inc (free)  bob@globex.com    / Demo!1234   (owner)")
    print("                      betty@globex.com  / Demo!1234   (analyst)")
    print()
    print("Open two browsers, log in as alice and bob, and the multi-tenant")
    print("isolation is immediately visible: each sees a disjoint /history.")


if __name__ == "__main__":
    seed()
