"""IOC Intelligence Center — module 4 of the SOC platform extension.

Local IOC store + enrichment proxies (VirusTotal, AbuseIPDB). Cortex /
MISP / Wazuh data is exposed for cross-reference via dedicated endpoints.
External API keys are read from env so the platform works offline (returns
``provider_disabled=true`` rather than 500).
"""
from __future__ import annotations

import json
import os
import socket
from datetime import datetime
from typing import Any, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit_log import log_action
from database import get_db
from models import IOC, Organization, User
from rbac import require_permission
from tenant import get_current_org


router = APIRouter(prefix="/api/soc/iocs", tags=["SOC / IOC Intel"])

VALID_TYPES = {"ip", "domain", "url", "hash", "email"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class IOCCreate(BaseModel):
    type: str
    value: str = Field(..., min_length=1, max_length=512)
    threat_score: int = 0
    confidence: str = "medium"
    source: Optional[str] = "manual"
    tlp: str = "amber"
    description: Optional[str] = None
    tags: List[str] = []


class IOCPatch(BaseModel):
    threat_score: Optional[int] = None
    confidence: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    tlp: Optional[str] = None


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


def _serialize(i: IOC) -> dict[str, Any]:
    return {
        "id": i.id,
        "type": i.type,
        "value": i.value,
        "threat_score": i.threat_score,
        "confidence": i.confidence,
        "source": i.source,
        "tlp": i.tlp,
        "description": i.description,
        "tags": _loads(i.tags, []),
        "enrichment": _loads(i.enrichment_json, {}),
        "first_seen": i.first_seen.isoformat() if i.first_seen else None,
        "last_seen": i.last_seen.isoformat() if i.last_seen else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("")
def list_iocs(
    type_: Optional[str] = Query(None, alias="type"),
    q: Optional[str] = Query(None),
    min_score: int = Query(0, ge=0, le=100),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("ioc.read")),
    current_org: Organization = Depends(get_current_org),
):
    qry = db.query(IOC).filter(IOC.organization_id == current_org.id)
    if type_:
        qry = qry.filter(IOC.type == type_)
    if q:
        qry = qry.filter(IOC.value.ilike(f"%{q}%"))
    if min_score:
        qry = qry.filter(IOC.threat_score >= min_score)
    total = qry.count()
    rows = qry.order_by(IOC.threat_score.desc(), IOC.updated_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_ioc(
    payload: IOCCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ioc.create")),
    current_org: Organization = Depends(get_current_org),
):
    if payload.type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid type. Valid: {sorted(VALID_TYPES)}")
    existing = (
        db.query(IOC)
        .filter(IOC.type == payload.type,
                IOC.value == payload.value,
                IOC.organization_id == current_org.id)
        .first()
    )
    if existing:
        existing.last_seen = datetime.utcnow()
        if payload.threat_score:
            existing.threat_score = max(existing.threat_score, payload.threat_score)
        db.commit()
        db.refresh(existing)
        return _serialize(existing)

    i = IOC(
        organization_id=current_org.id,
        type=payload.type,
        value=payload.value,
        threat_score=max(0, min(100, payload.threat_score)),
        confidence=payload.confidence,
        source=payload.source or "manual",
        tlp=payload.tlp,
        description=payload.description,
        tags=_dumps(payload.tags),
        enrichment_json="{}",
        created_by=user.id,
    )
    db.add(i)
    db.commit()
    db.refresh(i)
    log_action(db, user, "ioc.create", resource_type="ioc", resource_id=i.id,
               request=request, meta={"type": i.type, "value": i.value})
    return _serialize(i)


@router.get("/{ioc_id}")
def get_ioc(ioc_id: int, db: Session = Depends(get_db),
            _user: User = Depends(require_permission("ioc.read")),
            current_org: Organization = Depends(get_current_org)):
    i = (
        db.query(IOC)
        .filter(IOC.id == ioc_id, IOC.organization_id == current_org.id)
        .first()
    )
    if not i:
        raise HTTPException(404, "IOC not found")
    return _serialize(i)


@router.patch("/{ioc_id}")
def patch_ioc(
    ioc_id: int,
    payload: IOCPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ioc.update")),
    current_org: Organization = Depends(get_current_org),
):
    i = (
        db.query(IOC)
        .filter(IOC.id == ioc_id, IOC.organization_id == current_org.id)
        .first()
    )
    if not i:
        raise HTTPException(404, "IOC not found")
    for field in ("threat_score", "confidence", "description", "tlp"):
        new = getattr(payload, field)
        if new is not None:
            setattr(i, field, new)
    if payload.tags is not None:
        i.tags = _dumps(payload.tags)
    db.commit()
    db.refresh(i)
    log_action(db, user, "ioc.update", resource_type="ioc", resource_id=i.id, request=request)
    return _serialize(i)


@router.delete("/{ioc_id}")
def delete_ioc(
    ioc_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ioc.delete")),
    current_org: Organization = Depends(get_current_org),
):
    i = (
        db.query(IOC)
        .filter(IOC.id == ioc_id, IOC.organization_id == current_org.id)
        .first()
    )
    if not i:
        raise HTTPException(404, "IOC not found")
    db.delete(i)
    db.commit()
    log_action(db, user, "ioc.delete", resource_type="ioc", resource_id=ioc_id, request=request)
    return {"ok": True, "id": ioc_id}


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------
def _vt_key() -> Optional[str]:
    return os.getenv("VIRUSTOTAL_API_KEY") or os.getenv("VT_API_KEY")


def _abuse_key() -> Optional[str]:
    return os.getenv("ABUSEIPDB_API_KEY")


def _vt_lookup(kind: str, value: str) -> dict[str, Any]:
    key = _vt_key()
    if not key:
        return {"provider_disabled": True, "provider": "virustotal"}
    endpoint = {
        "ip": f"https://www.virustotal.com/api/v3/ip_addresses/{value}",
        "domain": f"https://www.virustotal.com/api/v3/domains/{value}",
        "hash": f"https://www.virustotal.com/api/v3/files/{value}",
        "url": f"https://www.virustotal.com/api/v3/urls/{value}",
    }.get(kind)
    if not endpoint:
        return {"unsupported": True}
    try:
        r = requests.get(endpoint, headers={"x-apikey": key}, timeout=10)
        if r.status_code == 404:
            return {"found": False}
        r.raise_for_status()
        data = r.json().get("data", {}).get("attributes", {})
        stats = data.get("last_analysis_stats") or {}
        malicious = int(stats.get("malicious", 0))
        suspicious = int(stats.get("suspicious", 0))
        total = sum(int(v or 0) for v in stats.values()) or 1
        score = min(100, int(((malicious * 2 + suspicious) / (total * 2)) * 100))
        return {
            "provider": "virustotal",
            "found": True,
            "score": score,
            "malicious": malicious,
            "suspicious": suspicious,
            "stats": stats,
            "reputation": data.get("reputation"),
            "tags": data.get("tags", []),
            "last_analysis_date": data.get("last_analysis_date"),
        }
    except requests.RequestException as e:
        return {"error": str(e), "provider": "virustotal"}


def _abuseipdb_lookup(ip: str) -> dict[str, Any]:
    key = _abuse_key()
    if not key:
        return {"provider_disabled": True, "provider": "abuseipdb"}
    try:
        r = requests.get(
            "https://api.abuseipdb.com/api/v2/check",
            headers={"Key": key, "Accept": "application/json"},
            params={"ipAddress": ip, "maxAgeInDays": 90},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        return {
            "provider": "abuseipdb",
            "score": int(data.get("abuseConfidenceScore", 0)),
            "country": data.get("countryCode"),
            "isp": data.get("isp"),
            "domain": data.get("domain"),
            "usage_type": data.get("usageType"),
            "total_reports": data.get("totalReports"),
            "last_reported_at": data.get("lastReportedAt"),
        }
    except requests.RequestException as e:
        return {"error": str(e), "provider": "abuseipdb"}


def _geoip(ip: str) -> dict[str, Any]:
    """Free, no-key GeoIP via ip-api.com. Falls back gracefully."""
    try:
        r = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,countryCode,region,city,isp,org,as,query"},
            timeout=5,
        )
        if r.ok:
            j = r.json()
            if j.get("status") == "success":
                return {
                    "country": j.get("country"),
                    "country_code": j.get("countryCode"),
                    "region": j.get("region"),
                    "city": j.get("city"),
                    "isp": j.get("isp"),
                    "org": j.get("org"),
                    "asn": j.get("as"),
                }
    except requests.RequestException:
        pass
    return {}


def _resolve(value: str, kind: str) -> dict[str, Any]:
    if kind == "domain":
        try:
            return {"resolved_ip": socket.gethostbyname(value)}
        except Exception:
            return {}
    return {}


@router.post("/enrich")
def enrich(
    type: str,
    value: str,
    request: Request,
    persist: bool = Query(True, description="Save/update IOC with enrichment"),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ioc.enrich")),
    current_org: Organization = Depends(get_current_org),
):
    """One-shot lookup across VirusTotal, AbuseIPDB, GeoIP (and DNS for domains).
    Updates / creates the matching IOC record when ``persist=true``.
    """
    if type not in VALID_TYPES:
        raise HTTPException(400, "Invalid type")

    enrichment: dict[str, Any] = {"type": type, "value": value}
    enrichment["virustotal"] = _vt_lookup(type, value)
    if type == "ip":
        enrichment["abuseipdb"] = _abuseipdb_lookup(value)
        enrichment["geoip"] = _geoip(value)
    elif type == "domain":
        enrichment["dns"] = _resolve(value, "domain")
        if enrichment["dns"].get("resolved_ip"):
            enrichment["geoip"] = _geoip(enrichment["dns"]["resolved_ip"])

    # Aggregate threat score
    vt_score = (enrichment["virustotal"] or {}).get("score") or 0
    abuse_score = (enrichment.get("abuseipdb") or {}).get("score") or 0
    threat_score = max(int(vt_score), int(abuse_score))
    enrichment["threat_score"] = threat_score

    if persist:
        i = (
            db.query(IOC)
            .filter(IOC.type == type, IOC.value == value,
                    IOC.organization_id == current_org.id)
            .first()
        )
        if not i:
            i = IOC(
                organization_id=current_org.id,
                type=type, value=value, source="enrich", created_by=user.id,
                tags="[]", enrichment_json="{}",
            )
            db.add(i)
            db.flush()
        i.enrichment_json = _dumps(enrichment)
        i.threat_score = max(i.threat_score or 0, threat_score)
        i.last_seen = datetime.utcnow()
        db.commit()
        db.refresh(i)
        log_action(db, user, "ioc.enrich", resource_type="ioc", resource_id=i.id,
                   request=request, meta={"type": type, "score": threat_score})
        return {"enrichment": enrichment, "ioc": _serialize(i)}

    return {"enrichment": enrichment}
