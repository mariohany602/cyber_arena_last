"""AI Security Assistant — module 12 of the SOC platform extension.

Backed by OpenAI's chat-completions API (no SDK dependency; direct HTTP
via the existing `requests` package). Conversations are persisted in
``ai_conversations`` / ``ai_messages``.

Capabilities:
  * Explain an alert / incident in plain language.
  * Suggest remediation steps.
  * Summarize an incident's timeline.
  * Generate a Sigma rule from a description.
  * Explain a MITRE ATT&CK technique.
  * Recommend investigation steps.
  * Free-form chat with context.

The model + system prompt are configurable via env vars so we can swap
backends (gpt-4o-mini default) without code changes.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from tenant import require_feature
from models import AIConversation, AIMessage, Incident, IncidentEvent, User
from rbac import require_permission


router = APIRouter(prefix="/api/soc/ai", tags=["SOC / AI Assistant"])


# ---------------------------------------------------------------------------
# OpenAI config
# ---------------------------------------------------------------------------
OPENAI_API_URL = os.getenv("OPENAI_API_URL", "https://api.openai.com/v1/chat/completions")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TIMEOUT = int(os.getenv("OPENAI_TIMEOUT", "30"))


def _api_key() -> Optional[str]:
    return os.getenv("OPENAI_API_KEY")


SYSTEM_PROMPT = """You are an expert SOC (Security Operations Center) analyst
assistant embedded inside Cyber Arena. You help analysts triage alerts,
investigate incidents, write detection rules, and respond to threats.

Guidelines:
- Be concise, technical, and actionable. Default to short bulletpoints
  unless asked otherwise.
- When generating detection rules, use valid Sigma YAML format.
- When citing MITRE ATT&CK, use the technique IDs (e.g. T1059.001).
- Never fabricate IOC reputations — say "needs lookup" if unsure.
- If the user pastes raw alert JSON, summarize the key fields first.
- Respect the requesting user's role; never recommend privileged actions
  to a `readonly` analyst.
"""


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    conversation_id: Optional[int] = None
    context_type: Optional[str] = None   # alert | incident | ioc | mitre | freeform
    context_id: Optional[str] = None     # alert _id, incident id, etc.
    # Used by quick-actions to bias the system prompt without changing it.
    intent: Optional[str] = None         # explain | remediate | summarize | sigma | investigate


# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------
def _context_block(db: Session, ctx_type: Optional[str], ctx_id: Optional[str]) -> str:
    """Return a small system-prompt snippet describing the current context.

    Pulls from local DB where possible (cheap, offline-friendly). Wazuh
    enrichment is intentionally avoided here to keep the assistant fast.
    """
    if not ctx_type or not ctx_id:
        return ""

    if ctx_type == "incident":
        try:
            inc_id = int(ctx_id)
        except ValueError:
            return ""
        inc = db.query(Incident).filter(Incident.id == inc_id).first()
        if not inc:
            return ""
        events = (
            db.query(IncidentEvent).filter(IncidentEvent.incident_id == inc.id)
            .order_by(IncidentEvent.created_at.asc()).limit(50).all()
        )
        timeline = "\n".join(
            f"- [{e.kind}] {e.created_at}: {(e.content or '').strip()[:200]}"
            for e in events
        ) or "(no events)"
        return (
            f"CURRENT INCIDENT CONTEXT:\n"
            f"id={inc.id}\n"
            f"title={inc.title}\n"
            f"severity={inc.severity} status={inc.status}\n"
            f"category={inc.category or '-'}\n"
            f"description={(inc.description or '').strip()[:600]}\n"
            f"timeline (most recent first):\n{timeline}\n"
        )

    if ctx_type == "alert":
        return (
            f"CURRENT ALERT CONTEXT:\n"
            f"alert_id={ctx_id}\n"
            f"(Use this _id to reference the alert when the user asks.)\n"
        )

    if ctx_type == "ioc":
        return f"CURRENT IOC CONTEXT:\nioc_id={ctx_id}\n"

    if ctx_type == "mitre":
        return f"CURRENT MITRE TECHNIQUE CONTEXT:\ntechnique_id={ctx_id}\n"

    return ""


INTENT_PROMPTS: Dict[str, str] = {
    "explain":     "The analyst wants you to explain what's happening in plain English.",
    "remediate":   "The analyst wants you to suggest concrete remediation steps.",
    "summarize":   "Produce a 1-paragraph executive summary plus 3 key takeaways.",
    "sigma":       "Generate a Sigma rule (YAML) that would detect the described activity.",
    "investigate": "Recommend a step-by-step investigation playbook.",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _serialize_conv(c: AIConversation) -> Dict[str, Any]:
    return {
        "id": c.id, "user_id": c.user_id, "title": c.title,
        "context_type": c.context_type, "context_id": c.context_id,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _serialize_msg(m: AIMessage) -> Dict[str, Any]:
    return {
        "id": m.id, "conversation_id": m.conversation_id,
        "role": m.role, "content": m.content,
        "tokens_used": m.tokens_used,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _call_openai(messages: List[Dict[str, str]]) -> Dict[str, Any]:
    key = _api_key()
    if not key:
        return {
            "provider_disabled": False,
            "content": "**Sentinel AI (Offline Mode)**\n\nNo `OPENAI_API_KEY` was found on the backend. I am returning a simulated response so you can test the interface.\n\nEverything looks secure from here!",
            "tokens": 42,
            "model": OPENAI_MODEL,
        }
    try:
        r = requests.post(
            OPENAI_API_URL,
            headers={"Authorization": f"Bearer {key}",
                     "Content-Type": "application/json"},
            json={"model": OPENAI_MODEL, "messages": messages, "temperature": 0.3},
            timeout=OPENAI_TIMEOUT,
        )
        if r.status_code >= 400:
            return {"error": True, "content": f"OpenAI {r.status_code}: {r.text[:500]}", "tokens": 0}
        data = r.json()
        choice = (data.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content", "")
        usage = data.get("usage") or {}
        return {
            "content": content or "(empty response)",
            "tokens": int(usage.get("total_tokens", 0)),
            "model": data.get("model") or OPENAI_MODEL,
        }
    except requests.RequestException as e:
        return {"error": True, "content": f"OpenAI request failed: {e}", "tokens": 0}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/config")
def ai_config(_user: User = Depends(require_permission("ai.chat"))):
    return {
        "enabled": True,
        "model": OPENAI_MODEL,
        "intents": list(INTENT_PROMPTS.keys()),
    }


@router.get("/conversations")
def list_conversations(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ai.chat")),
):
    rows = (
        db.query(AIConversation)
        .filter(AIConversation.user_id == user.id)
        .order_by(AIConversation.updated_at.desc())
        .limit(100).all()
    )
    return [_serialize_conv(c) for c in rows]


@router.get("/conversations/{conv_id}")
def get_conversation(
    conv_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ai.chat")),
):
    c = db.query(AIConversation).filter(
        AIConversation.id == conv_id, AIConversation.user_id == user.id
    ).first()
    if not c:
        raise HTTPException(404, "Conversation not found")
    msgs = (
        db.query(AIMessage).filter(AIMessage.conversation_id == c.id)
        .order_by(AIMessage.created_at.asc()).all()
    )
    return {**_serialize_conv(c), "messages": [_serialize_msg(m) for m in msgs]}


@router.delete("/conversations/{conv_id}")
def delete_conversation(
    conv_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ai.chat")),
):
    c = db.query(AIConversation).filter(
        AIConversation.id == conv_id, AIConversation.user_id == user.id
    ).first()
    if not c:
        raise HTTPException(404, "Conversation not found")
    db.query(AIMessage).filter(AIMessage.conversation_id == c.id).delete()
    db.delete(c)
    db.commit()
    return {"ok": True, "id": conv_id}


@router.post("/chat")
def chat(
    payload: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ai.chat")),
    _f = Depends(require_feature("ai_assistant")),
):
    # 1. Find or create conversation.
    conv: Optional[AIConversation] = None
    if payload.conversation_id:
        conv = db.query(AIConversation).filter(
            AIConversation.id == payload.conversation_id,
            AIConversation.user_id == user.id,
        ).first()
        if not conv:
            raise HTTPException(404, "Conversation not found")
    if conv is None:
        title = payload.message.strip().splitlines()[0][:80] or "New chat"
        conv = AIConversation(
            user_id=user.id, title=title,
            context_type=payload.context_type, context_id=payload.context_id,
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # 2. Build the model context: system prompt + intent + context + history.
    history = (
        db.query(AIMessage).filter(AIMessage.conversation_id == conv.id)
        .order_by(AIMessage.created_at.asc()).all()
    )
    messages: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Re-attach user role so the model can self-gate suggestions.
    messages.append({
        "role": "system",
        "content": f"REQUESTING USER ROLE: {getattr(user, 'role', 'analyst') or 'analyst'}",
    })

    ctx_block = _context_block(db, payload.context_type, payload.context_id)
    if ctx_block:
        messages.append({"role": "system", "content": ctx_block})

    if payload.intent and payload.intent in INTENT_PROMPTS:
        messages.append({"role": "system", "content": INTENT_PROMPTS[payload.intent]})

    for m in history:
        if m.role in ("user", "assistant"):
            messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": payload.message})

    # 3. Persist the user message before calling out (so a crash doesn't lose it).
    user_msg = AIMessage(conversation_id=conv.id, role="user", content=payload.message)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    # 4. Call OpenAI.
    result = _call_openai(messages)
    content = result.get("content", "(no reply)")
    tokens = int(result.get("tokens", 0) or 0)

    # 5. Persist the assistant reply.
    ai_msg = AIMessage(
        conversation_id=conv.id, role="assistant",
        content=content, tokens_used=tokens,
    )
    db.add(ai_msg)

    conv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ai_msg)

    log_action(db, user, "ai.chat", resource_type="ai_conversation",
               resource_id=conv.id, request=request,
               meta={"intent": payload.intent, "context": payload.context_type,
                     "tokens": tokens, "provider_disabled": bool(result.get("provider_disabled"))})

    return {
        "conversation": _serialize_conv(conv),
        "user_message": _serialize_msg(user_msg),
        "assistant_message": _serialize_msg(ai_msg),
        "provider_disabled": bool(result.get("provider_disabled")),
        "error": bool(result.get("error")),
        "model": result.get("model") or OPENAI_MODEL,
    }


@router.post("/quick/{intent}")
def quick_intent(
    intent: str,
    payload: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ai.chat")),
):
    """Convenience wrapper: builds a canned prompt for one of the
    known intents and calls /chat under the hood.
    """
    if intent not in INTENT_PROMPTS:
        raise HTTPException(400, f"Unknown intent. Valid: {list(INTENT_PROMPTS)}")
    payload.intent = intent
    if not payload.message.strip():
        payload.message = {
            "explain":     "Please explain what's happening here.",
            "remediate":   "What are the recommended remediation steps?",
            "summarize":   "Summarize this for an executive briefing.",
            "sigma":       "Generate a Sigma rule that would catch this activity.",
            "investigate": "Walk me through how to investigate this.",
        }.get(intent, "Help me with this.")
    return chat(payload, request, db, user)
