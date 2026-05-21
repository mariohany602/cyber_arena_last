"""Executive Dashboard — module 9 of the SOC platform extension.

Aggregates MTTD / MTTR, incident & SOAR trends, top risky assets, and
analyst performance from the local SOC tables (incidents, cases, SOAR
executions, alert triage, asset inventory). All compute is in-process so
the dashboard works even when Wazuh / external SIEMs are unavailable.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func as sf
from sqlalchemy.orm import Session

from database import get_db
from models import (
    AlertTriage, AssetInventory, Case, Incident, SoarExecution, User,
)
from rbac import require_permission


router = APIRouter(prefix="/api/soc/exec", tags=["SOC / Executive"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.utcnow()


def _to_naive(d: Optional[datetime]) -> Optional[datetime]:
    if d is None:
        return None
    return d.replace(tzinfo=None) if d.tzinfo else d


def _seconds_between(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    a, b = _to_naive(a), _to_naive(b)
    if not a or not b:
        return None
    return max(0.0, (b - a).total_seconds())


def _fmt_duration(seconds: Optional[float]) -> str:
    if seconds is None:
        return "—"
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds / 60)}m"
    if seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    return f"{seconds / 86400:.1f}d"


def _bucket_daily(rows: List[datetime], days: int) -> List[Dict[str, Any]]:
    """Return [{date, count}] for the last ``days`` days."""
    if days <= 0:
        return []
    today = _now().date()
    buckets: Dict[str, int] = {}
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        buckets[d.isoformat()] = 0
    for r in rows:
        r = _to_naive(r)
        if not r:
            continue
        key = r.date().isoformat()
        if key in buckets:
            buckets[key] += 1
    return [{"date": k, "count": v} for k, v in buckets.items()]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/summary")
def summary(
    days: int = Query(30, ge=1, le=180),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("exec.read")),
):
    cutoff = _now() - timedelta(days=days)

    incidents = db.query(Incident).filter(Incident.created_at >= cutoff).all()
    closed_or_resolved = [i for i in incidents if i.status in ("resolved", "closed")]

    # MTTD = detected → acknowledged. MTTR = detected → resolved.
    mttd_samples = [
        _seconds_between(i.detected_at or i.created_at, i.acknowledged_at)
        for i in incidents if i.acknowledged_at
    ]
    mttd_samples = [s for s in mttd_samples if s is not None]
    mttr_samples = [
        _seconds_between(i.detected_at or i.created_at, i.resolved_at)
        for i in closed_or_resolved if i.resolved_at
    ]
    mttr_samples = [s for s in mttr_samples if s is not None]

    mttd = (sum(mttd_samples) / len(mttd_samples)) if mttd_samples else None
    mttr = (sum(mttr_samples) / len(mttr_samples)) if mttr_samples else None

    # Severity distribution
    by_severity = dict(
        db.query(Incident.severity, sf.count(Incident.id))
        .filter(Incident.created_at >= cutoff)
        .group_by(Incident.severity).all()
    )
    by_status = dict(
        db.query(Incident.status, sf.count(Incident.id))
        .filter(Incident.created_at >= cutoff)
        .group_by(Incident.status).all()
    )

    open_now = sum(by_status.get(s, 0) for s in ("open", "investigating", "escalated"))

    # Triage classifications
    triage_counts = dict(
        db.query(AlertTriage.classification, sf.count(AlertTriage.id))
        .group_by(AlertTriage.classification).all()
    )
    tp = int(triage_counts.get("true_positive", 0) or 0)
    fp = int(triage_counts.get("false_positive", 0) or 0)
    precision = (tp / (tp + fp)) if (tp + fp) else None

    # SOAR activity
    soar_total = db.query(sf.count(SoarExecution.id)).filter(SoarExecution.created_at >= cutoff).scalar() or 0
    soar_success = db.query(sf.count(SoarExecution.id)).filter(
        SoarExecution.created_at >= cutoff, SoarExecution.status == "success"
    ).scalar() or 0
    soar_failed = db.query(sf.count(SoarExecution.id)).filter(
        SoarExecution.created_at >= cutoff, SoarExecution.status == "failed"
    ).scalar() or 0

    return {
        "range_days": days,
        "incidents": {
            "total": len(incidents),
            "open_now": int(open_now),
            "resolved": len(closed_or_resolved),
            "by_severity": {k: int(v) for k, v in by_severity.items()},
            "by_status": {k: int(v) for k, v in by_status.items()},
        },
        "mttd_seconds": mttd,
        "mttr_seconds": mttr,
        "mttd_h": _fmt_duration(mttd),
        "mttr_h": _fmt_duration(mttr),
        "triage": {
            "true_positive": tp, "false_positive": fp,
            "benign": int(triage_counts.get("benign", 0) or 0),
            "escalated": int(triage_counts.get("escalated", 0) or 0),
            "resolved": int(triage_counts.get("resolved", 0) or 0),
            "precision": precision,
        },
        "soar": {
            "total": int(soar_total),
            "success": int(soar_success),
            "failed": int(soar_failed),
        },
    }


@router.get("/trends")
def trends(
    days: int = Query(30, ge=1, le=180),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("exec.read")),
):
    cutoff = _now() - timedelta(days=days)
    incidents = db.query(Incident).filter(Incident.created_at >= cutoff).all()
    cases = db.query(Case).filter(Case.created_at >= cutoff).all()
    soars = db.query(SoarExecution).filter(SoarExecution.created_at >= cutoff).all()

    # Detections = incidents created. Resolutions = incidents resolved.
    detections_series = _bucket_daily([_to_naive(i.created_at) for i in incidents], days)  # type: ignore[arg-type]
    resolutions_series = _bucket_daily(
        [_to_naive(i.resolved_at) for i in incidents if i.resolved_at], days  # type: ignore[arg-type]
    )
    cases_series = _bucket_daily([_to_naive(c.created_at) for c in cases], days)  # type: ignore[arg-type]
    soar_series = _bucket_daily([_to_naive(s.created_at) for s in soars], days)  # type: ignore[arg-type]

    # Per-day severity breakdown for incidents.
    daily_sev: Dict[str, Dict[str, int]] = defaultdict(lambda: {
        "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0,
    })
    for i in incidents:
        d = _to_naive(i.created_at)
        if not d:
            continue
        key = d.date().isoformat()
        sev = (i.severity or "info").lower()
        if sev in daily_sev[key]:
            daily_sev[key][sev] += 1
    severity_series = [{"date": k, **v} for k, v in sorted(daily_sev.items())]

    return {
        "range_days": days,
        "detections": detections_series,
        "resolutions": resolutions_series,
        "cases": cases_series,
        "soar": soar_series,
        "severity_by_day": severity_series,
    }


@router.get("/top_assets")
def top_assets(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("exec.read")),
):
    rows = (
        db.query(AssetInventory)
        .order_by(AssetInventory.risk_score.desc(), AssetInventory.vuln_count.desc())
        .limit(limit).all()
    )
    return [
        {
            "id": r.id, "hostname": r.hostname, "ip": r.ip,
            "os": r.os, "agent_status": r.agent_status,
            "risk_score": r.risk_score, "vuln_count": r.vuln_count,
            "criticality": r.criticality,
        }
        for r in rows
    ]


@router.get("/analyst_performance")
def analyst_performance(
    days: int = Query(30, ge=1, le=180),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("exec.read")),
):
    cutoff = _now() - timedelta(days=days)
    incidents = db.query(Incident).filter(Incident.created_at >= cutoff).all()
    users = {u.id: u for u in db.query(User).all()}

    per: Dict[int, Dict[str, Any]] = {}
    for inc in incidents:
        # Credit the assignee for resolved/closed; credit creator for openings.
        if inc.assignee_id:
            row = per.setdefault(inc.assignee_id, {
                "user_id": inc.assignee_id,
                "username": (users.get(inc.assignee_id).username if users.get(inc.assignee_id) else f"#{inc.assignee_id}"),
                "assigned": 0, "resolved": 0, "ttr_samples": [],
            })
            row["assigned"] += 1
            if inc.status in ("resolved", "closed") and inc.resolved_at:
                row["resolved"] += 1
                ttr = _seconds_between(inc.detected_at or inc.created_at, inc.resolved_at)
                if ttr is not None:
                    row["ttr_samples"].append(ttr)

    out: List[Dict[str, Any]] = []
    for uid, row in per.items():
        ttr = row.pop("ttr_samples")
        row["avg_ttr_seconds"] = (sum(ttr) / len(ttr)) if ttr else None
        row["avg_ttr_h"] = _fmt_duration(row["avg_ttr_seconds"])
        out.append(row)

    out.sort(key=lambda r: r["resolved"], reverse=True)
    return out


@router.get("/threat_landscape")
def threat_landscape(
    days: int = Query(30, ge=1, le=180),
    limit: int = Query(15, ge=1, le=50),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("exec.read")),
):
    """Top categories + MITRE techniques observed in incidents."""
    cutoff = _now() - timedelta(days=days)
    incidents = db.query(Incident).filter(Incident.created_at >= cutoff).all()

    by_category: Dict[str, int] = {}
    by_mitre: Dict[str, int] = {}
    for inc in incidents:
        if inc.category:
            by_category[inc.category] = by_category.get(inc.category, 0) + 1
        try:
            import json as _json
            for t in _json.loads(inc.mitre_techniques or "[]"):
                by_mitre[t] = by_mitre.get(t, 0) + 1
        except Exception:
            pass

    return {
        "categories": sorted(
            [{"key": k, "count": v} for k, v in by_category.items()],
            key=lambda r: r["count"], reverse=True,
        )[:limit],
        "mitre_techniques": sorted(
            [{"key": k, "count": v} for k, v in by_mitre.items()],
            key=lambda r: r["count"], reverse=True,
        )[:limit],
    }
