"""n8n SOAR Integration Client

Provides functions to trigger n8n workflows and manage n8n-based SOAR operations.
Supports both webhook-based and API-based workflow triggering.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import requests


def _n8n_cfg() -> Dict[str, Optional[str]]:
    """Get n8n configuration from environment variables."""
    return {
        "url": os.getenv("N8N_URL", "").rstrip("/") or None,
        "api_key": os.getenv("N8N_API_KEY") or None,
        "verify": os.getenv("N8N_VERIFY_SSL", "true").lower() != "false",
    }


def n8n_configured() -> bool:
    """Check if n8n is properly configured."""
    cfg = _n8n_cfg()
    return bool(cfg["url"])


def n8n_trigger_webhook(webhook_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Trigger an n8n workflow via webhook URL.

    Args:
        webhook_url: Full webhook URL from n8n (e.g., http://n8n:5678/webhook/soar-block-ip)
        payload: JSON payload to send to the workflow

    Returns:
        Response from n8n workflow
    """
    cfg = _n8n_cfg()

    try:
        r = requests.post(
            webhook_url,
            headers={"Content-Type": "application/json"},
            json=payload,
            verify=cfg["verify"],
            timeout=30,
        )
        r.raise_for_status()

        try:
            return r.json()
        except Exception:
            return {"success": True, "raw": r.text, "status_code": r.status_code}

    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Failed to trigger n8n webhook: {e}"
        }


def n8n_trigger_workflow(workflow_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Trigger an n8n workflow by ID using the API.

    Args:
        workflow_id: The n8n workflow ID
        payload: JSON payload to send to the workflow

    Returns:
        Execution result from n8n
    """
    cfg = _n8n_cfg()

    if not cfg["url"]:
        raise RuntimeError("n8n URL not configured (set N8N_URL)")

    if not cfg["api_key"]:
        raise RuntimeError("n8n API key not configured (set N8N_API_KEY)")

    try:
        # n8n API endpoint for triggering workflows
        r = requests.post(
            f"{cfg['url']}/api/v1/workflows/{workflow_id}/execute",
            headers={
                "X-N8N-API-KEY": cfg["api_key"],
                "Content-Type": "application/json"
            },
            json=payload,
            verify=cfg["verify"],
            timeout=30,
        )
        r.raise_for_status()

        return r.json()

    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Failed to trigger n8n workflow: {e}"
        }


def n8n_list_workflows() -> List[Dict[str, Any]]:
    """List all workflows from n8n instance.

    Returns:
        List of workflow dictionaries with id, name, active status
    """
    cfg = _n8n_cfg()

    if not cfg["url"] or not cfg["api_key"]:
        return []

    try:
        r = requests.get(
            f"{cfg['url']}/api/v1/workflows",
            headers={"X-N8N-API-KEY": cfg["api_key"]},
            verify=cfg["verify"],
            timeout=10,
        )
        r.raise_for_status()

        workflows = r.json().get("data", [])

        return [
            {
                "id": w.get("id", ""),
                "name": w.get("name", "—"),
                "active": w.get("active", False),
                "description": w.get("tags", []),  # n8n uses tags, not description
            }
            for w in workflows if isinstance(w, dict)
        ]

    except requests.RequestException:
        return []


def n8n_get_execution_status(execution_id: str) -> Dict[str, Any]:
    """Get the status of a workflow execution.

    Args:
        execution_id: The n8n execution ID

    Returns:
        Execution status information
    """
    cfg = _n8n_cfg()

    if not cfg["url"] or not cfg["api_key"]:
        return {"error": "n8n not configured"}

    try:
        r = requests.get(
            f"{cfg['url']}/api/v1/executions/{execution_id}",
            headers={"X-N8N-API-KEY": cfg["api_key"]},
            verify=cfg["verify"],
            timeout=10,
        )
        r.raise_for_status()

        data = r.json()

        # Map n8n status to our format
        status_map = {
            "success": "success",
            "error": "failed",
            "running": "running",
            "waiting": "pending",
        }

        return {
            "execution_id": execution_id,
            "status": status_map.get(data.get("finished", False) and "success" or "running", "unknown"),
            "finished": data.get("finished", False),
            "data": data.get("data", {}),
            "mode": data.get("mode", ""),
        }

    except requests.RequestException as e:
        return {"error": str(e)}


def n8n_test_connection() -> Dict[str, Any]:
    """Test connection to n8n instance.

    Returns:
        Connection test result
    """
    cfg = _n8n_cfg()

    if not cfg["url"]:
        return {"success": False, "error": "N8N_URL not configured"}

    if not cfg["api_key"]:
        return {"success": False, "error": "N8N_API_KEY not configured"}

    try:
        # Try to list workflows as a connection test
        r = requests.get(
            f"{cfg['url']}/api/v1/workflows",
            headers={"X-N8N-API-KEY": cfg["api_key"]},
            verify=cfg["verify"],
            timeout=5,
        )

        if r.status_code == 200:
            workflow_count = len(r.json().get("data", []))
            return {
                "success": True,
                "message": f"Connected to n8n successfully. Found {workflow_count} workflows.",
                "url": cfg["url"],
                "workflow_count": workflow_count
            }
        else:
            return {
                "success": False,
                "error": f"n8n returned status {r.status_code}",
                "message": r.text[:200]
            }

    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Failed to connect to n8n at {cfg['url']}"
        }
