"""Live provisioning of a tenant against the shared Wazuh/TheHive/Shuffle.

Each new Cyber Arena Organization needs a corresponding home on the SOC
stack so its data stays isolated:

* **Wazuh** — an *agent group* named ``arena_org_<id>``. Every Wazuh
  query the platform makes for this tenant is filtered by that group,
  and the agent installer registers the customer's agent into it
  automatically.
* **TheHive 4+** — an *Organisation* with the org's slug. The platform
  forwards tenant requests with the ``X-Organisation`` header so TheHive
  enforces isolation server-side.
* **Shuffle** — Shuffle's tenancy is weaker; we just record the tag
  (``arena_org_<id>``) that our SOAR layer passes to workflows as a
  parameter.

This module is **opt-in**: it only runs when ``PROVISIONING_ENABLED=true``
on the backend. With the flag off (the default), signup still works
fully — the DB row is created with stable identifiers, but no external
HTTP calls fire. That lets us ship the platform and demo it before the
remote SOC machines are reachable.

Once the machines are up:

    PROVISIONING_ENABLED=true \\
    WAZUH_MANAGER_API_URL=https://<tailscale>:55000 \\
    WAZUH_MANAGER_USER=wazuh \\
    WAZUH_MANAGER_PASSWORD=*** \\
    THEHIVE_URL=http://<tailscale>:9000 \\
    THEHIVE_ADMIN_API_KEY=*** \\
    .venv/bin/uvicorn main:app --reload

…and every new signup hits the real APIs. Existing orgs that signed up
before the flag was on get a **Provision now** button in /settings/organization
that calls ``provision_tenant(...)`` after the fact.
"""
from __future__ import annotations

import os
from typing import Any

import requests
from sqlalchemy.orm import Session

from models import Organization


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------
def _env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name, default)
    return v if v not in ("", None) else default


def _verify_ssl(name: str) -> bool:
    return (_env(name, "false") or "false").lower() == "true"


# ---------------------------------------------------------------------------
# Wazuh
# ---------------------------------------------------------------------------
def _wazuh_token() -> tuple[str, str]:
    """Authenticate to the Wazuh Management API and return (base_url, jwt)."""
    base = _env("WAZUH_MANAGER_API_URL")  # e.g. https://<tailscale>:55000
    user = _env("WAZUH_MANAGER_USER", "wazuh")
    pw = _env("WAZUH_MANAGER_PASSWORD")
    if not base or not pw:
        raise RuntimeError(
            "WAZUH_MANAGER_API_URL / WAZUH_MANAGER_PASSWORD must be set "
            "to provision a tenant against Wazuh"
        )
    r = requests.post(
        f"{base}/security/user/authenticate",
        auth=(user, pw),
        verify=_verify_ssl("WAZUH_VERIFY_SSL"),
        timeout=10,
    )
    r.raise_for_status()
    token = r.json().get("data", {}).get("token")
    if not token:
        raise RuntimeError(f"Wazuh auth returned no token: {r.text[:200]}")
    return base, token


def provision_wazuh_group(org: Organization) -> dict[str, Any]:
    """Create the Wazuh agent group for this tenant. Idempotent — Wazuh
    returns a friendly error if the group already exists, which we treat
    as success."""
    base, token = _wazuh_token()
    headers = {"Authorization": f"Bearer {token}"}
    group = org.wazuh_agent_group or f"arena_org_{org.id}"

    r = requests.post(
        f"{base}/groups",
        json={"group_id": group},
        headers=headers,
        verify=_verify_ssl("WAZUH_VERIFY_SSL"),
        timeout=10,
    )
    if r.status_code in (200, 201):
        return {"created": True, "group": group}
    # Wazuh returns 400 with code 1711 if the group already exists.
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text[:200]}
    if r.status_code == 400 and body.get("error", 0) in (1711,):
        return {"created": False, "group": group, "note": "already exists"}
    r.raise_for_status()
    return {"created": False, "group": group, "raw": body}


# ---------------------------------------------------------------------------
# TheHive 4+
# ---------------------------------------------------------------------------
def provision_thehive_org(org: Organization) -> dict[str, Any]:
    """Create a TheHive Organisation for this tenant. Requires a master
    admin API key (THEHIVE_ADMIN_API_KEY)."""
    base = _env("THEHIVE_URL")
    key = _env("THEHIVE_ADMIN_API_KEY") or _env("THEHIVE_API_KEY")
    if not base or not key:
        raise RuntimeError(
            "THEHIVE_URL / THEHIVE_ADMIN_API_KEY must be set to provision "
            "a tenant against TheHive"
        )
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    org_name = org.thehive_org_name or org.slug
    r = requests.post(
        f"{base}/api/v1/organisation",
        json={"name": org_name, "description": f"Cyber Arena tenant: {org.name}"},
        headers=headers,
        verify=_verify_ssl("THEHIVE_VERIFY_SSL"),
        timeout=15,
    )
    if r.status_code in (200, 201):
        return {"created": True, "org": org_name}
    # TheHive returns 400 / 409 on duplicate; treat that as already-provisioned.
    if r.status_code in (400, 409) and "already" in (r.text or "").lower():
        return {"created": False, "org": org_name, "note": "already exists"}
    r.raise_for_status()
    return {"created": False, "org": org_name, "raw": r.text[:200]}


# ---------------------------------------------------------------------------
# Shuffle (placeholder — no API call; we just persist the tag)
# ---------------------------------------------------------------------------
def provision_shuffle(org: Organization) -> dict[str, Any]:
    return {"tag": org.shuffle_tag or f"arena_org_{org.id}", "note": "tag-only"}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def provision_tenant(db: Session, org: Organization) -> dict[str, Any]:
    """Run all three provisioning steps for an organization. Partial
    success is OK: each result is recorded individually and the org is
    marked ``provisioned=True`` only if Wazuh + TheHive both succeed.
    Shuffle is best-effort and never blocks."""
    out: dict[str, Any] = {}
    errors: list[str] = []

    try:
        out["wazuh"] = provision_wazuh_group(org)
    except Exception as exc:
        errors.append(f"wazuh: {exc}")
        out["wazuh"] = {"error": str(exc)}

    try:
        out["thehive"] = provision_thehive_org(org)
    except Exception as exc:
        errors.append(f"thehive: {exc}")
        out["thehive"] = {"error": str(exc)}

    try:
        out["shuffle"] = provision_shuffle(org)
    except Exception as exc:
        out["shuffle"] = {"error": str(exc)}

    if errors:
        org.provision_error = "; ".join(errors)[:1000]
        org.provisioned = False
    else:
        org.provision_error = None
        org.provisioned = True
    db.commit()
    return out
