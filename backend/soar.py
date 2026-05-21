"""SOAR Control Center — module 6 of the SOC platform extension.

Centralised orchestration of common analyst response actions:

* Block IP
* Isolate endpoint
* Disable user
* Run named playbook
* Trigger arbitrary Shuffle workflow

Every action is recorded locally in the ``soar_executions`` table so we
have an audit trail and a usable UI regardless of whether Shuffle is
online. If Shuffle is configured (``SHUFFLE_URL`` + ``SHUFFLE_API_KEY``
env vars), real workflow executions are dispatched and their status is
tracked.

The action catalogue is intentionally pluggable — adding a new high-level
action only requires:

    ACTION_CATALOG["new_action"] = {
        "label": "...",
        "permission": "soar.execute.low",        # or .high
        "workflow_env": "SHUFFLE_WORKFLOW_NEW",  # optional
        "params": [ ... ],                        # for the UI form
    }
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import SoarExecution, User
from rbac import require_permission, user_has_permission
from n8n_client import (
    n8n_configured,
    n8n_trigger_webhook,
    n8n_trigger_workflow,
    n8n_list_workflows,
    n8n_test_connection,
)


router = APIRouter(prefix="/api/soc/soar", tags=["SOC / SOAR"])


# ---------------------------------------------------------------------------
# Action catalogue
# ---------------------------------------------------------------------------
ACTION_CATALOG: Dict[str, Dict[str, Any]] = {
    "block_ip": {
        "label": "Block IP",
        "description": "Push an IP block to firewalls / EDR via SOAR platform.",
        "permission": "soar.execute.low",
        "workflow_env": "SHUFFLE_WORKFLOW_BLOCK_IP",
        "webhook_env": "N8N_WEBHOOK_BLOCK_IP",
        "params": [
            {"key": "ip", "label": "IP address", "type": "string", "required": True},
            {"key": "duration", "label": "Duration (minutes)", "type": "number", "required": False},
            {"key": "reason", "label": "Reason / ticket", "type": "string", "required": False},
        ],
    },
    "isolate_endpoint": {
        "label": "Isolate endpoint",
        "description": "Quarantine the host via Wazuh active-response or EDR.",
        "permission": "soar.execute.high",
        "workflow_env": "SHUFFLE_WORKFLOW_ISOLATE",
        "webhook_env": "N8N_WEBHOOK_ISOLATE",
        "params": [
            {"key": "agent_id", "label": "Wazuh agent ID", "type": "string", "required": True},
            {"key": "reason", "label": "Reason / ticket", "type": "string", "required": True},
        ],
    },
    "disable_user": {
        "label": "Disable user",
        "description": "Disable an account in the directory.",
        "permission": "soar.execute.high",
        "workflow_env": "SHUFFLE_WORKFLOW_DISABLE_USER",
        "webhook_env": "N8N_WEBHOOK_DISABLE_USER",
        "params": [
            {"key": "username", "label": "Username / UPN", "type": "string", "required": True},
            {"key": "reason", "label": "Reason / ticket", "type": "string", "required": True},
        ],
    },
    "run_playbook": {
        "label": "Run playbook",
        "description": "Trigger an arbitrary named workflow.",
        "permission": "soar.execute.low",
        "workflow_env": None,
        "webhook_env": None,
        "params": [
            {"key": "workflow_id", "label": "Workflow ID", "type": "string", "required": True},
            {"key": "payload_json", "label": "JSON payload", "type": "json", "required": False},
        ],
    },
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ActionRequest(BaseModel):
    action: str = Field(..., description="One of ACTION_CATALOG keys.")
    params: Dict[str, Any] = Field(default_factory=dict)
    incident_id: Optional[int] = None
    workflow_id: Optional[str] = None  # only for run_playbook


# ---------------------------------------------------------------------------
# Shuffle client (best-effort, no external dependency)
# ---------------------------------------------------------------------------
def _shuffle_cfg() -> Dict[str, Optional[str]]:
    return {
        "url": os.getenv("SHUFFLE_URL", "").rstrip("/") or None,
        "key": os.getenv("SHUFFLE_API_KEY") or None,
        "verify": os.getenv("SHUFFLE_VERIFY_SSL", "true").lower() != "false",
    }


def _shuffle_configured() -> bool:
    cfg = _shuffle_cfg()
    return bool(cfg["url"] and cfg["key"])


def _shuffle_trigger(workflow_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Trigger a Shuffle workflow. Returns the parsed JSON response.

    Shuffle's standard run endpoint is::

        POST {SHUFFLE_URL}/api/v1/workflows/{workflow_id}/execute
        Authorization: Bearer <key>
    """
    cfg = _shuffle_cfg()
    if not cfg["url"] or not cfg["key"]:
        raise RuntimeError("Shuffle not configured")
    r = requests.post(
        f"{cfg['url']}/api/v1/workflows/{workflow_id}/execute",
        headers={"Authorization": f"Bearer {cfg['key']}",
                 "Content-Type": "application/json"},
        json={"execution_argument": json.dumps(payload)},
        verify=cfg["verify"],
        timeout=10,
    )
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return {"raw": r.text}


def _shuffle_list_workflows() -> List[Dict[str, Any]]:
    cfg = _shuffle_cfg()
    if not cfg["url"] or not cfg["key"]:
        return []
    try:
        r = requests.get(
            f"{cfg['url']}/api/v1/workflows",
            headers={"Authorization": f"Bearer {cfg['key']}"},
            verify=cfg["verify"], timeout=10,
        )
        r.raise_for_status()
        wfs = r.json() or []
        return [
            {
                "id": (w.get("id") or w.get("workflow_id") or ""),
                "name": w.get("name") or w.get("workflow_name") or "—",
                "description": w.get("description") or "",
                "is_valid": w.get("is_valid"),
            }
            for w in wfs if isinstance(w, dict)
        ]
    except requests.RequestException:
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _loads(v, d):
    if not v:
        return d
    try:
        return json.loads(v)
    except Exception:
        return d


def _dumps(v) -> str:
    try:
        return json.dumps(v, default=str)
    except Exception:
        return "{}"


def _serialize(ex: SoarExecution) -> Dict[str, Any]:
    return {
        "id": ex.id,
        "user_id": ex.user_id,
        "action": ex.action,
        "target": ex.target,
        "playbook": ex.playbook,
        "workflow_id": ex.workflow_id,
        "execution_id": ex.execution_id,
        "status": ex.status,
        "params": _loads(ex.params_json, {}),
        "result": _loads(ex.result_json, {}),
        "incident_id": ex.incident_id,
        "created_at": ex.created_at.isoformat() if ex.created_at else None,
        "finished_at": ex.finished_at.isoformat() if ex.finished_at else None,
    }


def _validate_params(spec: Dict[str, Any], values: Dict[str, Any]) -> None:
    for p in spec.get("params", []):
        if p.get("required") and not str(values.get(p["key"], "")).strip():
            raise HTTPException(400, f"Missing required parameter: {p['key']}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/config")
def soar_config(_user: User = Depends(require_permission("soar.read"))):
    """Return a non-secret summary of SOAR config for the UI."""
    cfg = _shuffle_cfg()

    # Determine which SOAR platform is configured
    platform = "none"
    if n8n_configured():
        platform = "n8n"
    elif _shuffle_configured():
        platform = "shuffle"

    return {
        "platform": platform,
        "shuffle_configured": _shuffle_configured(),
        "shuffle_url": cfg["url"],
        "n8n_configured": n8n_configured(),
        "n8n_url": os.getenv("N8N_URL", ""),
        "actions": [
            {"key": k, **{kk: vv for kk, vv in v.items() if kk != "workflow_env"},
             "workflow_id": os.getenv(v["workflow_env"], "") if v.get("workflow_env") else None,
             "webhook_url": os.getenv(v.get("webhook_env", ""), "") if v.get("webhook_env") else None}
            for k, v in ACTION_CATALOG.items()
        ],
    }


@router.get("/workflows")
def list_workflows(_user: User = Depends(require_permission("soar.read"))):
    """List workflows from configured SOAR platform (Shuffle or n8n)."""
    workflows = []
    platform = "none"

    if n8n_configured():
        workflows = n8n_list_workflows()
        platform = "n8n"
    elif _shuffle_configured():
        workflows = _shuffle_list_workflows()
        platform = "shuffle"

    return {
        "workflows": workflows,
        "configured": len(workflows) > 0,
        "platform": platform
    }


@router.post("/execute")
def execute_action(
    body: ActionRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("soar.read")),  # base; we re-check below
):
    spec = ACTION_CATALOG.get(body.action)
    if not spec:
        raise HTTPException(400, f"Unknown action. Valid: {sorted(ACTION_CATALOG)}")

    # Permission check based on action sensitivity.
    needed = spec["permission"]
    if not user_has_permission(user, needed):
        log_action(db, user, "soar.denied", resource_type="soar", resource_id=body.action,
                   status="denied", request=request, meta={"need": needed})
        raise HTTPException(403, f"Missing permission: {needed}")

    _validate_params(spec, body.params)

    # Resolve target Shuffle workflow id (catalog default vs override).
    workflow_id = body.workflow_id or os.getenv(spec["workflow_env"], "") if spec.get("workflow_env") else body.workflow_id

    # Stable, short target string for the audit row.
    target = (
        body.params.get("ip")
        or body.params.get("agent_id")
        or body.params.get("username")
        or workflow_id
        or ""
    )

    ex = SoarExecution(
        user_id=user.id,
        action=body.action,
        target=str(target)[:255] or None,
        playbook=spec.get("label"),
        workflow_id=workflow_id or None,
        status="pending",
        params_json=_dumps(body.params),
        incident_id=body.incident_id,
    )
    db.add(ex)
    db.commit()
    db.refresh(ex)

    log_action(db, user, f"soar.{body.action}", resource_type="soar", resource_id=ex.id,
               request=request, meta={"target": target, "workflow_id": workflow_id})

    # Dispatch to n8n, Shuffle, or mark as local-only
    executed = False

    # Try n8n first (webhook or API)
    if n8n_configured():
        # Check if there's a webhook URL configured for this action
        webhook_env = spec.get("webhook_env")
        webhook_url = os.getenv(webhook_env, "") if webhook_env else None

        try:
            if webhook_url:
                # Use webhook trigger
                resp = n8n_trigger_webhook(webhook_url, body.params)
                ex.status = "success" if resp.get("success", True) else "failed"
                ex.execution_id = str(resp.get("executionId") or resp.get("execution_id") or "") or None
                ex.result_json = _dumps(resp)
                ex.finished_at = datetime.utcnow()
                executed = True
            elif workflow_id:
                # Use API trigger
                resp = n8n_trigger_workflow(workflow_id, body.params)
                if resp.get("success", True):
                    ex.status = "running"
                    ex.execution_id = str(resp.get("executionId") or resp.get("id") or "") or None
                else:
                    ex.status = "failed"
                ex.result_json = _dumps(resp)
                executed = True
        except Exception as e:  # noqa: BLE001
            ex.status = "failed"
            ex.result_json = _dumps({"error": str(e), "platform": "n8n"})
            ex.finished_at = datetime.utcnow()
            executed = True

    # Fall back to Shuffle if n8n not configured
    if not executed and _shuffle_configured() and workflow_id:
        try:
            resp = _shuffle_trigger(workflow_id, body.params)
            ex.status = "running"
            ex.execution_id = str(resp.get("execution_id") or resp.get("id") or "") or None
            ex.result_json = _dumps(resp)
            executed = True
        except Exception as e:  # noqa: BLE001
            ex.status = "failed"
            ex.result_json = _dumps({"error": str(e), "platform": "shuffle"})
            ex.finished_at = datetime.utcnow()
            executed = True

    # If no SOAR platform is configured, log locally only
    if not executed:
        ex.status = "local_only"
        ex.result_json = _dumps({
            "note": "No SOAR platform configured or no workflow/webhook mapped — action logged locally only.",
        })
        ex.finished_at = datetime.utcnow()

    db.commit()
    db.refresh(ex)
    return _serialize(ex)


@router.get("/executions")
def list_executions(
    action: Optional[str] = Query(None),
    status_: Optional[str] = Query(None, alias="status"),
    incident_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("soar.read")),
):
    q = db.query(SoarExecution)
    if action:
        q = q.filter(SoarExecution.action == action)
    if status_:
        q = q.filter(SoarExecution.status == status_)
    if incident_id is not None:
        q = q.filter(SoarExecution.incident_id == incident_id)
    total = q.count()
    rows = q.order_by(SoarExecution.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(r) for r in rows]}


@router.get("/executions/{ex_id}")
def get_execution(
    ex_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("soar.read")),
):
    ex = db.query(SoarExecution).filter(SoarExecution.id == ex_id).first()
    if not ex:
        raise HTTPException(404, "Execution not found")
    return _serialize(ex)


@router.get("/test-connection")
def test_soar_connection(_user: User = Depends(require_permission("soar.read"))):
    """Test connection to configured SOAR platform."""
    if n8n_configured():
        result = n8n_test_connection()
        result["platform"] = "n8n"
        return result
    elif _shuffle_configured():
        # Test Shuffle connection by listing workflows
        try:
            workflows = _shuffle_list_workflows()
            return {
                "success": True,
                "platform": "shuffle",
                "message": f"Connected to Shuffle. Found {len(workflows)} workflows.",
                "workflow_count": len(workflows)
            }
        except Exception as e:
            return {
                "success": False,
                "platform": "shuffle",
                "error": str(e)
            }
    else:
        return {
            "success": False,
            "platform": "none",
            "error": "No SOAR platform configured. Set N8N_URL/N8N_API_KEY or SHUFFLE_URL/SHUFFLE_API_KEY"
        }


@router.post("/executions/{ex_id}/refresh")
def refresh_execution(
    ex_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("soar.read")),
):
    """Poll Shuffle for the latest status of a remote execution."""
    ex = db.query(SoarExecution).filter(SoarExecution.id == ex_id).first()
    if not ex:
        raise HTTPException(404, "Execution not found")
    if not (_shuffle_configured() and ex.execution_id and ex.workflow_id):
        return _serialize(ex)
    cfg = _shuffle_cfg()
    try:
        r = requests.get(
            f"{cfg['url']}/api/v1/workflows/{ex.workflow_id}/executions/{ex.execution_id}",
            headers={"Authorization": f"Bearer {cfg['key']}"},
            verify=cfg["verify"], timeout=10,
        )
        if r.ok:
            j = r.json() or {}
            new_status = (j.get("status") or "").lower() or ex.status
            mapped = {
                "executing": "running", "running": "running",
                "finished": "success", "success": "success",
                "failure": "failed", "failed": "failed", "aborted": "failed",
            }.get(new_status, new_status)
            ex.status = mapped or ex.status
            ex.result_json = _dumps(j)
            if mapped in ("success", "failed") and not ex.finished_at:
                ex.finished_at = datetime.utcnow()
            db.commit()
            db.refresh(ex)
    except requests.RequestException:
        pass
    return _serialize(ex)


@router.get("/stats/summary")
def stats(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("soar.read")),
):
    rows = db.query(SoarExecution).all()
    by_action: Dict[str, int] = {}
    by_status: Dict[str, int] = {}
    for r in rows:
        by_action[r.action] = by_action.get(r.action, 0) + 1
        by_status[r.status] = by_status.get(r.status, 0) + 1
    last24 = sum(1 for r in rows if r.created_at and
                 (datetime.utcnow() - r.created_at.replace(tzinfo=None)).total_seconds() < 86400)
    return {
        "total": len(rows),
        "last_24h": last24,
        "by_action": by_action,
        "by_status": by_status,
        "shuffle_configured": _shuffle_configured(),
        "n8n_configured": n8n_configured(),
    }
