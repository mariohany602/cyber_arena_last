import os
import json
import requests
from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any

router = APIRouter()


def _unflatten(flat):
    """Decode n8n's 'flatted' reference-encoded execution payload.

    n8n stores execution data as a JSON string holding a flat array; any
    value that is a string of digits is a reference to the element at that
    index in the same array. Cycles are possible, so we memoize.
    """
    if not isinstance(flat, list) or not flat:
        return flat
    cache: Dict[int, Any] = {}

    def resolve(idx: int):
        if idx in cache:
            return cache[idx]
        node = flat[idx]
        if isinstance(node, dict):
            out: Dict[str, Any] = {}
            cache[idx] = out
            for k, v in node.items():
                out[k] = walk(v)
            return out
        if isinstance(node, list):
            out_l: list = []
            cache[idx] = out_l
            for v in node:
                out_l.append(walk(v))
            return out_l
        cache[idx] = node
        return node

    def walk(v):
        if isinstance(v, str) and v.isdigit():
            i = int(v)
            if 0 <= i < len(flat):
                return resolve(i)
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return resolve(0)

N8N_URL = os.getenv("N8N_URL", "http://100.90.206.1:5678")
N8N_EMAIL = os.getenv("N8N_EMAIL", "fadymimifady@gami.com")
N8N_PASSWORD = os.getenv("N8N_PASSWORD", "Cyber@123")

def _get_n8n_cookie() -> str:
    # Use the rest login API to get the session cookie
    try:
        r = requests.post(
            f"{N8N_URL.rstrip('/')}/rest/login",
            json={
                "emailOrLdapLoginId": N8N_EMAIL,
                "password": N8N_PASSWORD
            },
            timeout=10
        )
        if r.status_code >= 400:
            raise Exception(f"Failed to login to N8N: {r.status_code}")
        
        cookie = r.cookies.get_dict().get("n8n-auth")
        if not cookie:
            raise Exception("No n8n-auth cookie returned")
        return cookie
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/executions/{id}")
def get_n8n_execution(id: str) -> Dict[str, Any]:
    cookie = _get_n8n_cookie()
    try:
        r = requests.get(
            f"{N8N_URL.rstrip('/')}/rest/executions/{id}",
            cookies={"n8n-auth": cookie},
            timeout=15
        )
        if r.status_code == 404:
            raise HTTPException(status_code=404, detail="Execution not found in N8N")
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=f"N8N error: {r.text}")

        payload = r.json()
        # n8n wraps everything in {"data": {...}}; the inner "data" field is a
        # JSON-stringified flatted array that holds runData/resultData. Decode
        # it and hoist resultData/startData/executionData to the top level so
        # the frontend can read execution.resultData.runData directly.
        inner = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(inner, dict) and isinstance(inner.get("data"), str):
            try:
                flat = json.loads(inner["data"])
                decoded = _unflatten(flat)
                if isinstance(decoded, dict):
                    for k in ("resultData", "startData", "executionData", "resumeToken"):
                        if k in decoded:
                            inner[k] = decoded[k]
                inner["data"] = decoded
            except (ValueError, TypeError, IndexError) as exc:
                inner["_decode_error"] = str(exc)
        return payload
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Error connecting to N8N: {str(e)}")
