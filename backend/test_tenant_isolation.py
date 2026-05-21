"""End-to-end isolation test for the SaaS multi-tenant spine.

What this test proves:
  1. Two orgs created via /api/auth/signup get disjoint
     ``wazuh_agent_group`` and ``thehive_org_name`` identifiers.
  2. Every Wazuh ``_search`` query issued on behalf of a user from org A
     carries ``{term: {agent.group: arena_org_<A.id>}}``  — and never
     the group for org B.
  3. ``record_scan(...)`` tags rows with the right ``organization_id``,
     and ``GET /api/v1/scans`` filters by it so org A literally cannot
     see org B's scan history.

We monkey-patch the Wazuh transport (``wazuh._es``) so the test runs
anywhere, no live Wazuh deployment required — instead we capture the
exact body the backend *would* have sent and assert on the filter.

Run:    cd backend && .venv/bin/pytest -xvs test_tenant_isolation.py
"""
from __future__ import annotations

import os
import tempfile
import uuid

# Use a throwaway SQLite DB so we don't touch the real sql_app.db.
_tmp_db_path = os.path.join(tempfile.gettempdir(), f"tenant_iso_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db_path}"

import pytest
from fastapi.testclient import TestClient

import main  # noqa: E402 — triggers Base.metadata.create_all + plan seeding
import wazuh  # noqa: E402 — we monkeypatch its `_es` transport
from database import SessionLocal  # noqa: E402
from models import Scan  # noqa: E402


@pytest.fixture(scope="module")
def client():
    return TestClient(main.app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _signup_and_login(client: TestClient, *, username: str, company: str) -> tuple[str, dict]:
    """Sign up a fresh user+org and return (bearer_token, org_dict)."""
    email = f"{username}@example.com"
    r = client.post("/api/auth/signup", json={
        "username": username,
        "email": email,
        "password": "Sup3r-Secret!",
        "company_name": company,
    })
    assert r.status_code == 200, r.text

    r = client.post(
        "/api/auth/login",
        json={"email": email, "password": "Sup3r-Secret!"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]

    r = client.get("/api/org/current", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return token, r.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_signup_creates_isolated_org_identifiers(client):
    """Two signups → two distinct Wazuh groups + TheHive org names."""
    suffix = uuid.uuid4().hex[:8]
    _, org_a = _signup_and_login(client, username=f"alice_{suffix}", company="Acme Corp")
    _, org_b = _signup_and_login(client, username=f"bob_{suffix}",   company="Globex Inc")

    assert org_a["id"] != org_b["id"]
    assert org_a["wazuh_agent_group"] == f"arena_org_{org_a['id']}"
    assert org_b["wazuh_agent_group"] == f"arena_org_{org_b['id']}"
    assert org_a["wazuh_agent_group"] != org_b["wazuh_agent_group"]
    assert org_a["thehive_org_name"] != org_b["thehive_org_name"]
    assert org_a["my_role"] == "owner"
    assert org_b["my_role"] == "owner"


def test_wazuh_queries_inject_per_org_agent_group_filter(client, monkeypatch):
    """Every Wazuh _search body must carry the caller's agent.group filter."""
    suffix = uuid.uuid4().hex[:8]
    token_a, org_a = _signup_and_login(client, username=f"carol_{suffix}", company="A Co")
    token_b, org_b = _signup_and_login(client, username=f"dave_{suffix}",  company="B Co")

    # Make `_check_configured()` happy without a real Wazuh deployment.
    monkeypatch.setenv("WAZUH_URL", "http://wazuh.example")
    monkeypatch.setenv("WAZUH_USER", "test")
    monkeypatch.setenv("WAZUH_PASSWORD", "test")

    captured: list[dict] = []

    def fake_es(method: str, path: str, body: dict | None = None):
        # `wazuh._es` applies the org filter *before* calling the transport,
        # so the body we see here is the post-injection body.
        captured.append({"method": method, "path": path, "body": body})
        # Return a minimal Elasticsearch-shaped response so the endpoint
        # can finish rendering without crashing.
        return {
            "hits": {"total": {"value": 0}, "hits": []},
            "aggregations": {},
        }

    monkeypatch.setattr(wazuh, "_es", fake_es)

    # Hit the SIEM summary endpoint as user A → expect agent.group = org_a's.
    r = client.get("/api/soc/wazuh/siem/summary",
                   headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 200, r.text

    # Same endpoint as user B → must inject org_b's group, not org_a's.
    r = client.get("/api/soc/wazuh/siem/summary",
                   headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 200, r.text

    assert len(captured) >= 2, "Wazuh transport was never called"

    def _has_term(body: dict, field: str, value: str) -> bool:
        """Recursively look for {term: {<field>: <value>}} anywhere in body."""
        if not isinstance(body, dict):
            return False
        if "term" in body and isinstance(body["term"], dict):
            if body["term"].get(field) == value:
                return True
        for v in body.values():
            if isinstance(v, dict) and _has_term(v, field, value):
                return True
            if isinstance(v, list):
                for item in v:
                    if _has_term(item, field, value):
                        return True
        return False

    a_body = captured[0]["body"]
    b_body = captured[1]["body"]
    a_group = org_a["wazuh_agent_group"]
    b_group = org_b["wazuh_agent_group"]

    # A's query has A's group and NOT B's group.
    assert _has_term(a_body, "agent.group", a_group), \
        f"org A query missing its own group filter: {a_body}"
    assert not _has_term(a_body, "agent.group", b_group), \
        f"org A query leaked org B's group filter: {a_body}"

    # B's query has B's group and NOT A's group.
    assert _has_term(b_body, "agent.group", b_group), \
        f"org B query missing its own group filter: {b_body}"
    assert not _has_term(b_body, "agent.group", a_group), \
        f"org B query leaked org A's group filter: {b_body}"


def test_scan_history_is_strictly_per_org(client):
    """A scan recorded under org A is invisible to a user in org B."""
    suffix = uuid.uuid4().hex[:8]
    token_a, org_a = _signup_and_login(client, username=f"eve_{suffix}",   company="A Co")
    token_b, org_b = _signup_and_login(client, username=f"frank_{suffix}", company="B Co")

    # Insert a fake scan row for org A directly via record_scan so we don't
    # need a real Nmap binary in the test environment.
    from models import User
    db = SessionLocal()
    user_a = db.query(User).filter(User.username == f"eve_{suffix}").first()
    db.close()

    main.record_scan(
        tool="nmap",
        target="10.0.0.1",
        response={"engine": "nmap", "raw_text": "tenant-isolation-test-marker"},
        user=user_a,
        organization_id=org_a["id"],
    )

    # Org A sees it.
    r = client.get("/api/v1/scans", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 200, r.text
    rows_a = r.json()
    assert any(r["target"] == "10.0.0.1" for r in rows_a), \
        "org A should see its own scan"

    # Org B does NOT.
    r = client.get("/api/v1/scans", headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 200, r.text
    rows_b = r.json()
    assert not any(r["target"] == "10.0.0.1" for r in rows_b), \
        f"org B leaked a scan from org A: {rows_b}"

    # And every row org B does see is genuinely tagged to org B.
    db = SessionLocal()
    for row in rows_b:
        s = db.query(Scan).get(row["id"])
        assert s is None or s.organization_id == org_b["id"]
    db.close()
