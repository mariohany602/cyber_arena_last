"""Realtime monitoring — module 10 of the SOC platform extension.

In-memory pub/sub backed by FastAPI WebSockets. The broker is wired to
SQLAlchemy `after_insert` events on the SOC tables, so any new
incident / triage event / SOAR execution / case event / IOC is
broadcast to every connected client **without modifying the existing
route code**.

Frontend usage::

    const ws = new WebSocket(`/api/soc/realtime/ws?token=${token}`)
    ws.onmessage = (m) => { ... }

The protocol is a stream of JSON objects::

    {"kind": "incident.created", "at": "2026-…Z", "data": {…}}

The first message after connect is always ``{"kind": "hello", …}`` so
the client can confirm authentication succeeded.
"""
from __future__ import annotations

import asyncio
import json
import threading
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, Optional, Set

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import event
from sqlalchemy.orm import Session

from auth import get_user_from_token
from database import get_db
from models import (
    AlertTriageEvent, Case, CaseEvent, IOC, Incident, IncidentEvent,
    SoarExecution, User,
)
from rbac import require_permission


router = APIRouter(prefix="/api/soc/realtime", tags=["SOC / Realtime"])


# ---------------------------------------------------------------------------
# Broker
# ---------------------------------------------------------------------------
class RealtimeBroker:
    """Pub/sub that bridges sync SQLAlchemy events to async WebSockets.

    Each subscriber gets its own asyncio.Queue. The event loop reference
    is captured at startup so synchronous publishers (DB listeners) can
    schedule `Queue.put_nowait` on it via ``call_soon_threadsafe``.
    """

    MAX_HISTORY = 200

    def __init__(self) -> None:
        self._subs: Set[asyncio.Queue] = set()
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._history: Deque[Dict[str, Any]] = deque(maxlen=self.MAX_HISTORY)

    # -- lifecycle --
    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # -- subscription --
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs.discard(q)

    # -- publish --
    def publish(self, kind: str, data: Dict[str, Any]) -> None:
        """Thread-safe publish from sync code (DB event listeners)."""
        event = {
            "kind": kind,
            "at": datetime.utcnow().isoformat() + "Z",
            "data": data,
        }
        self._history.append(event)
        if not self._loop:
            return
        with self._lock:
            queues = list(self._subs)
        for q in queues:
            try:
                self._loop.call_soon_threadsafe(_safe_put, q, event)
            except RuntimeError:
                # Loop is closed/shutting down — drop event silently.
                pass

    def history(self, limit: int = 50) -> list[Dict[str, Any]]:
        return list(self._history)[-limit:]


def _safe_put(q: asyncio.Queue, event: Dict[str, Any]) -> None:
    """Non-blocking put with overflow handling — drop oldest if full."""
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        try:
            q.get_nowait()
            q.put_nowait(event)
        except Exception:
            pass


broker = RealtimeBroker()


# ---------------------------------------------------------------------------
# SQLAlchemy listeners — fired automatically on insert / update.
# This is the magic that keeps existing routes untouched.
# ---------------------------------------------------------------------------
def _register_listeners() -> None:
    @event.listens_for(Incident, "after_insert")
    def _incident_created(_mapper, _conn, target: Incident) -> None:  # noqa: ANN001
        broker.publish("incident.created", {
            "id": target.id, "title": target.title,
            "severity": target.severity, "status": target.status,
            "category": target.category,
        })

    @event.listens_for(Incident, "after_update")
    def _incident_updated(_mapper, _conn, target: Incident) -> None:  # noqa: ANN001
        broker.publish("incident.updated", {
            "id": target.id, "title": target.title,
            "severity": target.severity, "status": target.status,
        })

    @event.listens_for(IncidentEvent, "after_insert")
    def _inc_event(_mapper, _conn, target: IncidentEvent) -> None:  # noqa: ANN001
        broker.publish("incident.event", {
            "incident_id": target.incident_id,
            "kind": target.kind,
            "content": (target.content or "")[:280],
            "user_id": target.user_id,
        })

    @event.listens_for(SoarExecution, "after_insert")
    def _soar_created(_mapper, _conn, target: SoarExecution) -> None:  # noqa: ANN001
        broker.publish("soar.dispatched", {
            "id": target.id, "action": target.action,
            "target": target.target, "status": target.status,
            "workflow_id": target.workflow_id,
        })

    @event.listens_for(SoarExecution, "after_update")
    def _soar_updated(_mapper, _conn, target: SoarExecution) -> None:  # noqa: ANN001
        broker.publish("soar.updated", {
            "id": target.id, "status": target.status,
            "execution_id": target.execution_id,
        })

    @event.listens_for(AlertTriageEvent, "after_insert")
    def _triage(_mapper, _conn, target: AlertTriageEvent) -> None:  # noqa: ANN001
        broker.publish("alert.triage", {
            "alert_id": target.alert_id,
            "kind": target.kind,
            "user_id": target.user_id,
        })

    @event.listens_for(Case, "after_insert")
    def _case_created(_mapper, _conn, target: Case) -> None:  # noqa: ANN001
        broker.publish("case.created", {
            "id": target.id, "title": target.title,
            "severity": target.severity, "status": target.status,
        })

    @event.listens_for(CaseEvent, "after_insert")
    def _case_event(_mapper, _conn, target: CaseEvent) -> None:  # noqa: ANN001
        broker.publish("case.event", {
            "case_id": target.case_id, "kind": target.kind,
            "content": (target.content or "")[:280],
        })

    @event.listens_for(IOC, "after_insert")
    def _ioc_created(_mapper, _conn, target: IOC) -> None:  # noqa: ANN001
        broker.publish("ioc.created", {
            "id": target.id, "type": target.type, "value": target.value,
            "threat_score": target.threat_score,
        })


_register_listeners()


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------
@router.get("/recent")
def recent_events(
    limit: int = Query(50, ge=1, le=200),
    _user: User = Depends(require_permission("incident.read")),
):
    """Polling fallback: return the last N broadcast events.

    Useful when WebSockets aren't available (corporate proxies, etc.).
    """
    return {"items": broker.history(limit)}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------
@router.websocket("/ws")
async def realtime_ws(
    websocket: WebSocket,
    token: str = Query("", description="JWT bearer token"),
    db: Session = Depends(get_db),
) -> None:
    """Authenticated WebSocket feed of SOC events.

    Auth: token passed as a query parameter because the browser
    WebSocket API can't send custom headers. Same JWT as REST.
    """
    user = get_user_from_token(token, db)
    if not user:
        await websocket.close(code=4401)        # 4401 = custom unauth
        return

    await websocket.accept()
    q = broker.subscribe()

    try:
        # Greeting so the client knows it's connected & authed.
        await websocket.send_text(json.dumps({
            "kind": "hello",
            "user": {"id": user.id, "email": user.email,
                     "role": getattr(user, "role", "analyst")},
            "history_count": len(broker.history(broker.MAX_HISTORY)),
        }))
        while True:
            event_obj = await q.get()
            await websocket.send_text(json.dumps(event_obj, default=str))
    except WebSocketDisconnect:
        pass
    except Exception:
        # Best-effort cleanup; don't let the connection error crash the loop.
        try:
            await websocket.close()
        except Exception:
            pass
    finally:
        broker.unsubscribe(q)
