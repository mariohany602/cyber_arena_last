from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, Text, ForeignKey
from sqlalchemy.sql import func
from database import Base

# ============================================================================
# SaaS multi-tenancy: every tenant-owned row carries `organization_id`.
# A user belongs to one or more Organizations via OrgMembership. The active
# org is resolved per-request by `tenant.get_current_org`.
# ============================================================================

class Organization(Base):
    """SaaS tenant. One customer/company = one Organization."""
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    slug = Column(String(64), unique=True, index=True, nullable=False)
    logo_url = Column(String(512), nullable=True)

    # Subscription
    plan = Column(String(32), default="free", nullable=False, index=True)
        # free | starter | pro | enterprise (matches Plan.code)
    status = Column(String(16), default="active", nullable=False, index=True)
        # active | trial | suspended | cancelled
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)

    # Tenant identifiers on the shared SOC stack. These are what isolates
    # this org's data inside Wazuh / TheHive / Shuffle.
    wazuh_agent_group = Column(String(64), nullable=True, index=True)
        # e.g. "arena_org_42" — every agent registered by this org joins it,
        # and every Wazuh query from this tenant is filtered by it.
    thehive_org_name = Column(String(128), nullable=True)
        # TheHive 4+ Organisation name; sent as `X-Organisation` header.
    shuffle_tag = Column(String(64), nullable=True)
        # Tag/parameter passed to Shuffle workflows for per-org filtering.

    # One-shot enrollment key the customer's installer uses to register
    # Wazuh agents into this org's group. Rotate via /api/org/enrollment/rotate.
    enrollment_key = Column(String(64), nullable=True, index=True)

    # Tracks whether provision_tenant() succeeded against the live
    # Wazuh/TheHive/Shuffle APIs. Set to True only after a successful
    # provisioning call; surfaces a "Provision now" button when False.
    provisioned = Column(Boolean, default=False, nullable=False)
    provision_error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OrgMembership(Base):
    """User <-> Organization link with an org-level role."""
    __tablename__ = "org_memberships"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    # owner | admin | analyst | viewer  (org-scoped role; orthogonal to
    # the platform-wide User.role used by RBAC for super-admin features.)
    role = Column(String(32), default="analyst", nullable=False)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())


class Plan(Base):
    """Source of truth for what each plan includes (features + limits).
    Seeded by init_db with free/starter/pro/enterprise rows; mutable so an
    admin can flip features without a deploy."""
    __tablename__ = "plans"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(32), unique=True, index=True, nullable=False)
    name = Column(String(64), nullable=False)
    price_monthly_cents = Column(Integer, default=0)
    # JSON of {feature_key: bool|int}, e.g.
    # {"sqlmap": true, "nuclei": true, "ai_assistant": true,
    #  "max_users": 10, "max_engagements": -1}
    features_json = Column(Text, default="{}", nullable=False)
    is_public = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Profile Fields
    job_title = Column(String(100), nullable=True)
    bio = Column(String(500), nullable=True)
    location = Column(String(100), nullable=True)
    profile_pic = Column(String(255), nullable=True) # URL or path

    # Security Fields
    is_2fa_enabled = Column(Boolean, default=False)
    totp_secret = Column(String(255), nullable=True) # Kept for legacy compatibility if needed, but we use email OTP now
    email_otp = Column(String(10), nullable=True)
    email_otp_expiry = Column(DateTime(timezone=True), nullable=True)

    # Subscription tier — "free" or "pro"
    tier = Column(String(20), default="free", nullable=False)

    # SOC role for RBAC (added by Phase 1 SOC extension).
    # One of: admin, incident_responder, tier2, tier1, analyst, readonly.
    # Defaults to "analyst" so existing users keep general access without
    # privileged operations. See backend/rbac.py for the full matrix.
    role = Column(String(32), default="analyst", nullable=False)


class Asset(Base):
    """Domain owned by a user, with a verification challenge (DNS TXT or .well-known file)."""
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    domain = Column(String(255), index=True, nullable=False)
    verification_token = Column(String(64), nullable=False)       # the unique value to put in TXT/file
    verification_method = Column(String(20), nullable=True)       # "dns" or "http", set on success
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, index=True)
    recipient_id = Column(Integer, index=True)
    content = Column(String(2000))
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    is_encrypted = Column(Boolean, default=True)


class AlertVerdict(Base):
    """Analyst verdict on a Wazuh alert (TP / FP / TN / FN).

    Stored per-platform-user so different operators can disagree. The latest
    verdict per (user_id, alert_id) is what counts."""
    __tablename__ = "alert_verdicts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    alert_id = Column(String(64), index=True, nullable=False)        # Wazuh _id
    verdict = Column(String(4), nullable=False)                      # tp / fp / tn / fn
    rule_id = Column(String(32), nullable=True, index=True)
    rule_level = Column(Integer, nullable=True)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Scan(Base):
    """Persisted record of a single tool execution + its findings + assessment."""
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    tool = Column(String(50), index=True, nullable=False)        # e.g. "nmap", "nikto"
    target = Column(String(500), nullable=False)
    engine = Column(String(50), nullable=True)                   # which engine produced the data
    status = Column(String(20), default="success")               # success / failed
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Raw data and normalized assessment
    findings_json = Column(Text, nullable=False, default="[]")   # JSON array of normalized findings
    raw_json = Column(Text, nullable=True)                       # JSON of full original tool response
    risk_score = Column(Float, default=0.0)                      # 0-100
    severity_counts_json = Column(Text, default="{}")            # {critical:.., high:.., ...}
    summary = Column(String(500), nullable=True)                 # one-line summary


# ============================================================================
# Phase 1 — SOC Platform Extension (Incidents, Cases, Triage, IOCs, Hunts,
# Asset Inventory, Audit Log). All new tables; existing models above are
# UNCHANGED except for the `role` column added to User for RBAC.
# ============================================================================

class Incident(Base):
    """SOC incident — a confirmed/suspected security event under investigation.

    Statuses: open, investigating, escalated, resolved, closed.
    Severities: critical, high, medium, low, info.
    """
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), default="open", nullable=False, index=True)
    severity = Column(String(20), default="medium", nullable=False, index=True)
    category = Column(String(64), nullable=True, index=True)     # e.g. malware, phishing
    source = Column(String(64), nullable=True)                   # e.g. wazuh, manual, soar

    # Ownership
    created_by = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)

    # Links
    case_id = Column(Integer, ForeignKey("cases.id"), index=True, nullable=True)
    related_alert_ids = Column(Text, default="[]")               # JSON list of alert _ids
    related_incident_ids = Column(Text, default="[]")            # JSON list of incident ids
    mitre_techniques = Column(Text, default="[]")                # JSON list (e.g. ["T1059"])
    tags = Column(Text, default="[]")                            # JSON list

    # SLAs & lifecycle
    detected_at = Column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    resolution = Column(Text, nullable=True)                     # final write-up


class IncidentEvent(Base):
    """Append-only timeline event for an incident — note, status change,
    assignment, evidence link, action taken, etc."""
    __tablename__ = "incident_events"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    kind = Column(String(32), nullable=False, index=True)        # note, status, assignment, attach, soar
    content = Column(Text, nullable=True)
    meta_json = Column(Text, default="{}")                       # structured payload
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class Case(Base):
    """SOC case — investigation grouping multiple incidents/alerts/evidence
    items. Mirrors TheHive's case concept locally so we can show data even
    when TheHive is offline."""
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    status = Column(String(20), default="open", nullable=False, index=True)   # open, in_progress, closed
    tlp = Column(String(8), default="amber")                                  # white/green/amber/red
    severity = Column(String(20), default="medium", index=True)

    created_by = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)

    thehive_case_id = Column(String(64), nullable=True, index=True)           # external linkage
    tags = Column(Text, default="[]")
    resolution = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)


class CaseEvidence(Base):
    """Evidence attached to a case with chain-of-custody log."""
    __tablename__ = "case_evidence"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id"), index=True, nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    kind = Column(String(32), nullable=False)                    # file, ioc, screenshot, log, note
    mime_type = Column(String(128), nullable=True)
    size_bytes = Column(Integer, default=0)
    sha256 = Column(String(64), nullable=True, index=True)
    storage_path = Column(String(512), nullable=True)            # local FS path
    description = Column(Text, nullable=True)
    custody_log = Column(Text, default="[]")                     # JSON list of custody events
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CaseEvent(Base):
    """Append-only timeline event for a case."""
    __tablename__ = "case_events"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    kind = Column(String(32), nullable=False)
    content = Column(Text, nullable=True)
    meta_json = Column(Text, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AlertTriage(Base):
    """Analyst triage state for a Wazuh/SIEM alert. Co-exists with the
    legacy `AlertVerdict` table (which stores TP/FP/TN/FN votes) — this one
    adds the richer per-alert SOC state: classification, severity override,
    analyst assignment, link to incident/case."""
    __tablename__ = "alert_triage"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    alert_id = Column(String(128), index=True, nullable=False, unique=True)
    classification = Column(String(24), nullable=True, index=True)   # true_positive, false_positive, benign, escalated, resolved
    severity_override = Column(String(20), nullable=True)
    assignee_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    tags = Column(Text, default="[]")
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AlertTriageEvent(Base):
    """History entry for alert triage changes — for the alert timeline."""
    __tablename__ = "alert_triage_events"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(String(128), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    kind = Column(String(32), nullable=False)        # classify, severity, assign, note, link
    content = Column(Text, nullable=True)
    meta_json = Column(Text, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class IOC(Base):
    """Indicator of Compromise tracked in the local intel store."""
    __tablename__ = "iocs"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    type = Column(String(16), index=True, nullable=False)        # ip, domain, url, hash, email
    value = Column(String(512), index=True, nullable=False)
    threat_score = Column(Integer, default=0)                    # 0-100 aggregate
    confidence = Column(String(16), default="medium")
    source = Column(String(64), nullable=True)                   # virustotal, abuseipdb, manual, misp
    tlp = Column(String(8), default="amber")
    description = Column(Text, nullable=True)
    tags = Column(Text, default="[]")
    enrichment_json = Column(Text, default="{}")                 # cached lookup data
    last_seen = Column(DateTime(timezone=True), server_default=func.now())
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SavedHunt(Base):
    """Saved threat hunting query — Wazuh/Elastic DSL or structured filters."""
    __tablename__ = "saved_hunts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    filters_json = Column(Text, default="{}")                    # structured filter (ip, user, host, ...)
    query_dsl = Column(Text, nullable=True)                      # raw ES DSL (optional)
    is_shared = Column(Boolean, default=False)
    tags = Column(Text, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class HuntExecution(Base):
    """History of executed hunts for replay/audit."""
    __tablename__ = "hunt_executions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    saved_hunt_id = Column(Integer, ForeignKey("saved_hunts.id"), nullable=True)
    filters_json = Column(Text, default="{}")
    result_count = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AssetInventory(Base):
    """Host/endpoint inventory record. Sourced primarily from Wazuh agents,
    enriched with scan data. The legacy `Asset` table (user-owned domains)
    is untouched."""
    __tablename__ = "asset_inventory"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    hostname = Column(String(255), index=True, nullable=False)
    ip = Column(String(64), index=True, nullable=True)
    mac = Column(String(64), nullable=True)
    os = Column(String(128), nullable=True)
    os_version = Column(String(64), nullable=True)
    agent_id = Column(String(32), index=True, nullable=True)     # Wazuh agent id
    agent_status = Column(String(16), nullable=True)             # active, disconnected, never_connected
    criticality = Column(Integer, default=50)                    # 0-100
    risk_score = Column(Integer, default=0)                      # 0-100, computed
    vuln_count = Column(Integer, default=0)
    open_ports = Column(Text, default="[]")                      # JSON list
    services = Column(Text, default="[]")                        # JSON list of {port, name}
    software = Column(Text, default="[]")                        # JSON list of {name, version}
    tags = Column(Text, default="[]")
    owner = Column(String(128), nullable=True)
    last_seen = Column(DateTime(timezone=True), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AuditLog(Base):
    """Append-only audit log of privileged actions across the SOC platform."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    actor_email = Column(String(128), nullable=True)
    actor_role = Column(String(32), nullable=True)
    action = Column(String(64), nullable=False, index=True)      # e.g. incident.create, soar.block_ip
    resource_type = Column(String(32), nullable=True, index=True)
    resource_id = Column(String(64), nullable=True)
    status = Column(String(16), default="success")               # success / denied / error
    ip = Column(String(64), nullable=True)
    meta_json = Column(Text, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class SoarExecution(Base):
    """Local record of a SOAR action (block IP, isolate host, run playbook).
    Mirrors what's pushed to Shuffle so we have local history regardless of
    Shuffle availability."""
    __tablename__ = "soar_executions"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String(48), nullable=False, index=True)      # block_ip, isolate_host, disable_user, run_playbook
    target = Column(String(255), nullable=True)
    playbook = Column(String(128), nullable=True)
    workflow_id = Column(String(64), nullable=True)              # Shuffle workflow id
    execution_id = Column(String(64), nullable=True)             # Shuffle execution id
    status = Column(String(16), default="pending", index=True)   # pending, running, success, failed
    params_json = Column(Text, default="{}")
    result_json = Column(Text, default="{}")
    incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class AIConversation(Base):
    """Chat session for the AI security assistant."""
    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    title = Column(String(255), nullable=True)
    context_type = Column(String(32), nullable=True)        # alert, incident, ioc, freeform
    context_id = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("ai_conversations.id"), index=True, nullable=False)
    role = Column(String(16), nullable=False)               # user / assistant / system
    content = Column(Text, nullable=False)
    tokens_used = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
