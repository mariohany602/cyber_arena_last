"""Customer agent onboarding + management.

This is the *customer-facing* side of the multi-tenant Wazuh deployment:

* ``GET /install.sh?key=<enrollment_key>`` — **public** endpoint that
  returns a parameterised bash installer the customer pipes into ``sh``.
  The script downloads the Wazuh agent .deb/.rpm appropriate for the
  host, registers it into this tenant's Wazuh agent group (``arena_org_<id>``),
  and starts the service.

* ``GET /api/org/agents`` — list agents currently registered into the
  tenant's group, pulled live from the Wazuh Manager API.

* ``DELETE /api/org/agents/{agent_id}`` — revoke an agent (calls the
  Wazuh Manager API's agent-delete endpoint). We refuse to delete agents
  that aren't in this tenant's group so one org can't nuke another's
  fleet by guessing IDs.

The shared Wazuh Manager API (port 55000) credentials come from the
``WAZUH_MANAGER_*`` env vars; see ``tenant_provisioning.py`` for the
auth helper we reuse here.
"""
from __future__ import annotations

import os
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Organization, OrgMembership, User
from tenant import get_current_org, require_org_role
from tenant_provisioning import _verify_ssl, _wazuh_token


router = APIRouter(tags=["SaaS / Agents"])


# ---------------------------------------------------------------------------
# Wazuh Manager helpers (thin wrappers around the REST API on :55000)
# ---------------------------------------------------------------------------
def _manager_get(path: str, params: dict | None = None) -> dict:
    base, token = _wazuh_token()
    r = requests.get(
        f"{base}{path}",
        params=params or {},
        headers={"Authorization": f"Bearer {token}"},
        verify=_verify_ssl("WAZUH_VERIFY_SSL"),
        timeout=15,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"Wazuh Manager returned {r.status_code}: {r.text[:300]}")
    return r.json()


def _manager_delete(path: str, params: dict | None = None) -> dict:
    base, token = _wazuh_token()
    r = requests.delete(
        f"{base}{path}",
        params=params or {},
        headers={"Authorization": f"Bearer {token}"},
        verify=_verify_ssl("WAZUH_VERIFY_SSL"),
        timeout=15,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"Wazuh Manager returned {r.status_code}: {r.text[:300]}")
    return r.json()


def _agents_in_group(group: str) -> list[dict]:
    """List agents registered into a Wazuh agent group. Returns the
    normalised subset of fields the UI cares about."""
    data = _manager_get(f"/agents/groups/{group}", params={"limit": 500})
    items = ((data or {}).get("data") or {}).get("affected_items") or []
    out: list[dict] = []
    for a in items:
        out.append({
            "id": a.get("id"),
            "name": a.get("name"),
            "ip": a.get("ip"),
            "os": (a.get("os") or {}).get("platform") or a.get("os_platform"),
            "version": a.get("version"),
            "status": a.get("status"),  # active | disconnected | never_connected | pending
            "last_keep_alive": a.get("lastKeepAlive") or a.get("last_keep_alive"),
            "registered": a.get("dateAdd") or a.get("date_add"),
        })
    return out


# ---------------------------------------------------------------------------
# Public installer
# ---------------------------------------------------------------------------
INSTALLER_TEMPLATE = """#!/usr/bin/env bash
# Cyber Arena — Wazuh agent installer (tenant: {org_name})
# Generated dynamically by the cyber-arena backend. Do not edit by hand.
#
# What this does:
#   1. Detects your OS (deb/rpm)
#   2. Installs the Wazuh agent package
#   3. Points it at the shared manager ({manager})
#   4. Registers the agent into the tenant's group ({group})
#   5. Starts the service

set -euo pipefail

WAZUH_MANAGER="{manager}"
WAZUH_REGISTRATION_PASSWORD="{enrollment_key}"
WAZUH_AGENT_GROUP="{group}"
AGENT_NAME="${{AGENT_NAME:-$(hostname)}}"

echo "[*] Cyber Arena agent enrollment"
echo "    org    : {org_name}"
echo "    group  : ${{WAZUH_AGENT_GROUP}}"
echo "    manager: ${{WAZUH_MANAGER}}"
echo "    name   : ${{AGENT_NAME}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run with sudo / as root" >&2
  exit 1
fi

# --- Install package -------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  curl -sO https://packages.wazuh.com/key/GPG-KEY-WAZUH
  apt-key add GPG-KEY-WAZUH >/dev/null 2>&1 || (mv GPG-KEY-WAZUH /usr/share/keyrings/wazuh.gpg)
  echo "deb https://packages.wazuh.com/4.x/apt/ stable main" > /etc/apt/sources.list.d/wazuh.list
  apt-get update -y
  WAZUH_MANAGER="${{WAZUH_MANAGER}}" \\
  WAZUH_REGISTRATION_PASSWORD="${{WAZUH_REGISTRATION_PASSWORD}}" \\
  WAZUH_AGENT_GROUP="${{WAZUH_AGENT_GROUP}}" \\
  WAZUH_AGENT_NAME="${{AGENT_NAME}}" \\
  apt-get install -y wazuh-agent
elif command -v yum >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
  rpm --import https://packages.wazuh.com/key/GPG-KEY-WAZUH || true
  cat > /etc/yum.repos.d/wazuh.repo <<EOF
[wazuh]
gpgcheck=1
gpgkey=https://packages.wazuh.com/key/GPG-KEY-WAZUH
enabled=1
name=EL-\\$releasever - Wazuh
baseurl=https://packages.wazuh.com/4.x/yum/
protect=1
EOF
  WAZUH_MANAGER="${{WAZUH_MANAGER}}" \\
  WAZUH_REGISTRATION_PASSWORD="${{WAZUH_REGISTRATION_PASSWORD}}" \\
  WAZUH_AGENT_GROUP="${{WAZUH_AGENT_GROUP}}" \\
  WAZUH_AGENT_NAME="${{AGENT_NAME}}" \\
  yum install -y wazuh-agent
else
  echo "ERROR: unsupported package manager. Install Wazuh agent manually and join group ${{WAZUH_AGENT_GROUP}}." >&2
  exit 2
fi

# --- Enable + start --------------------------------------------------------
systemctl daemon-reload || true
systemctl enable wazuh-agent
systemctl restart wazuh-agent

echo "[+] Agent enrolled in ${{WAZUH_AGENT_GROUP}} on ${{WAZUH_MANAGER}}"
echo "[+] It should appear in the Cyber Arena dashboard within ~30s."
"""


@router.get("/install.sh", response_class=PlainTextResponse)
def install_script(
    key: str = Query(..., min_length=8, description="Per-org enrollment key"),
    db: Session = Depends(get_db),
):
    """Public — returns a bash installer parameterised for the tenant the
    enrollment key belongs to. Pipe it: ``curl -s <host>/install.sh?key=… | sudo bash``.
    """
    org = db.query(Organization).filter(Organization.enrollment_key == key).first()
    if not org:
        raise HTTPException(404, "Unknown enrollment key")

    manager_host = os.getenv("WAZUH_AGENT_MANAGER_HOST") or os.getenv("WAZUH_HOST") or "wazuh.example.com"
    script = INSTALLER_TEMPLATE.format(
        org_name=org.name,
        manager=manager_host,
        enrollment_key=org.enrollment_key,
        group=org.wazuh_agent_group or f"arena_org_{org.id}",
    )
    return PlainTextResponse(script, headers={"Content-Disposition": "inline; filename=install.sh"})


# ---------------------------------------------------------------------------
# Authenticated tenant-scoped agent management
# ---------------------------------------------------------------------------
@router.get("/api/org/agents")
def list_agents(
    _user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_org),
):
    """List Wazuh agents registered into this org's agent group. Pulled
    live from the Wazuh Manager API — no DB caching, so revoking an
    agent reflects immediately on the next refresh.

    Degrades gracefully when the Wazuh Manager API isn't reachable
    (env vars not set, network down, etc.): instead of 5xx-ing the
    page, we return an empty agent list with ``manager_configured:false``
    so the frontend can still show the one-liner installer + a friendly
    notice rather than a red error blob. The customer onboarding UX
    survives even when the SOC stack is offline.
    """
    group = org.wazuh_agent_group or f"arena_org_{org.id}"
    manager_host = os.getenv("WAZUH_AGENT_MANAGER_HOST") or os.getenv("WAZUH_HOST") or "wazuh.example.com"
    configured = bool(os.getenv("WAZUH_MANAGER_API_URL") and os.getenv("WAZUH_MANAGER_PASSWORD"))

    agents: list[dict] = []
    warning: str | None = None
    if configured:
        try:
            agents = _agents_in_group(group)
        except Exception as exc:
            warning = f"Wazuh agent lookup failed: {exc}"
    else:
        warning = ("Wazuh Manager API not configured on the backend. "
                   "Set WAZUH_MANAGER_API_URL, WAZUH_MANAGER_USER, WAZUH_MANAGER_PASSWORD "
                   "to see live agents here.")

    return {
        "group": group,
        "manager_host": manager_host,
        "enrollment_key": org.enrollment_key,
        "manager_configured": configured,
        "warning": warning,
        "agents": agents,
    }


@router.delete("/api/org/agents/{agent_id}")
def revoke_agent(
    agent_id: str,
    _user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_org),
    _m: OrgMembership = Depends(require_org_role("owner", "admin")),
):
    """Revoke an agent. We refuse if it's not in this tenant's group so
    one org can't delete another's by guessing agent IDs."""
    group = org.wazuh_agent_group or f"arena_org_{org.id}"
    members = {a["id"] for a in _agents_in_group(group)}
    if agent_id not in members:
        raise HTTPException(404, "Agent not found in this organization's group")
    _manager_delete(
        "/agents",
        params={"agents_list": agent_id, "purge": "true", "older_than": "0s"},
    )
    return {"ok": True, "agent_id": agent_id}
