import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Create axios instance
const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add token + active-org header to every request. The active org id is
// persisted in localStorage by the sidebar's org switcher; the backend's
// `get_current_org` dep reads `X-Org-Id` to scope every query.
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        const activeOrg = localStorage.getItem('active_org_id');
        if (activeOrg) {
            config.headers['X-Org-Id'] = activeOrg;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// SaaS plan gating — when the backend returns 403 with
// `detail.error === 'feature_locked'`, broadcast a CustomEvent that the
// AppShell listens for and shows an Upgrade modal. We still reject so
// the caller can render an inline fallback if they want, but the global
// upsell flow is automatic from any page.
export interface FeatureLockedDetail {
    error: 'feature_locked';
    feature: string;
    current_plan: string;
    upgrade_to: string | null;
    message: string;
}

api.interceptors.response.use(
    (resp) => resp,
    (error) => {
        const detail = error?.response?.data?.detail;
        if (error?.response?.status === 403 && detail && detail.error === 'feature_locked') {
            window.dispatchEvent(new CustomEvent<FeatureLockedDetail>('feature-locked', { detail }));
        }
        return Promise.reject(error);
    }
);

// Auth API calls
export const authAPI = {
    signup: async (
        username: string,
        email: string,
        password: string,
        companyName?: string,
    ) => {
        const response = await api.post('/api/auth/signup', {
            username,
            email,
            password,
            // SaaS multi-tenancy: signup creates the user's first Organization
            // server-side. If the customer didn't supply a company name we
            // pass null and the backend falls back to "<username>'s workspace".
            company_name: companyName || null,
        });
        return response.data;
    },

    login: async (email: string, password: string) => {
        const response = await api.post('/api/auth/login', {
            email,
            password,
        });
        return response.data;
    },

    login2FA: async (userId: number, token: string) => {
        const response = await api.post('/api/auth/2fa/login', {
            user_id: userId,
            token,
        });
        return response.data;
    },

    getCurrentUser: async () => {
        const response = await api.get('/api/auth/me');
        return response.data;
    },

    updatePassword: async (data: any) => {
        const response = await api.put('/api/v1/profile/password', data);
        return response.data;
    },

    setup2FA: async () => {
        const response = await api.post('/api/v1/auth/2fa/setup');
        return response.data;
    },

    verify2FA: async (token: string) => {
        const response = await api.post('/api/v1/auth/2fa/verify', { token });
        return response.data;
    },

    disable2FA: async () => {
        const response = await api.post('/api/v1/auth/2fa/disable');
        return response.data;
    },
};

// ---------------------------------------------------------------------------
// SaaS multi-tenancy — current org + plan info for the sidebar badge.
// ---------------------------------------------------------------------------
export interface CurrentOrg {
    id: number;
    name: string;
    slug: string;
    plan: 'free' | 'starter' | 'pro' | 'enterprise' | string;
    status: string;
    provisioned: boolean;
    my_role: 'owner' | 'admin' | 'analyst' | 'viewer' | string;
    features: Record<string, any>;
    enrollment_key?: string | null;
    wazuh_agent_group?: string | null;
    thehive_org_name?: string | null;
}

export interface ProvisionResult {
    ok: boolean;
    result: {
        wazuh?: { created?: boolean; group?: string; note?: string; error?: string };
        thehive?: { created?: boolean; org?: string; note?: string; error?: string };
        shuffle?: { tag?: string; note?: string; error?: string };
    };
}

export interface RegisteredAgent {
    id: string;
    name: string;
    ip: string | null;
    os: string | null;
    version: string | null;
    status: 'active' | 'disconnected' | 'never_connected' | 'pending' | string;
    last_keep_alive: string | null;
    registered: string | null;
}

export interface AgentsResponse {
    group: string;
    manager_host: string;
    enrollment_key: string | null;
    manager_configured?: boolean;
    warning?: string | null;
    agents: RegisteredAgent[];
}

export interface OrgUsage {
    plan: string;
    limits: { max_users: number | null; max_engagements: number | null };
    current: { users: number; scans_30d: number };
}

export const orgAPI = {
    current: async (): Promise<CurrentOrg> =>
        (await api.get('/api/org/current')).data,
    mine: async (): Promise<CurrentOrg[]> =>
        (await api.get('/api/org/mine')).data,
    usage: async (): Promise<OrgUsage> =>
        (await api.get('/api/org/usage')).data,
    provision: async (): Promise<ProvisionResult> =>
        (await api.post('/api/org/provision')).data,
    rotateEnrollmentKey: async (): Promise<{ enrollment_key: string }> =>
        (await api.post('/api/org/enrollment/rotate')).data,
    changePlan: async (plan: string): Promise<CurrentOrg> =>
        (await api.post('/api/org/plan', { plan })).data,
    listAgents: async (): Promise<AgentsResponse> =>
        (await api.get('/api/org/agents')).data,
    revokeAgent: async (agentId: string): Promise<{ ok: boolean }> =>
        (await api.delete(`/api/org/agents/${agentId}`)).data,
};

export interface PlanInfo {
    code: 'free' | 'starter' | 'pro' | 'enterprise' | string;
    name: string;
    price_monthly_cents: number;
    features: Record<string, boolean | number>;
    sort_order: number;
}

export const plansAPI = {
    list: async (): Promise<PlanInfo[]> => (await api.get('/api/org/plans')).data,
};

// Scan history & report API
export interface SeverityCounts {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    INFO: number;
}

export interface ScanSummary {
    id: number;
    tool: string;
    tool_label: string;
    target: string;
    engine: string | null;
    status: string;
    created_at: string | null;
    risk_score: number;
    risk_label: string;
    severity_counts: SeverityCounts;
    summary: string | null;
}

export interface Finding {
    severity: string;
    title: string;
    description: string;
    location: string;
    evidence: string;
    references: string[];
}

export interface ScanDetail extends ScanSummary {
    findings: Finding[];
    raw: any;
}

export const scansAPI = {
    list: async (tool?: string, limit = 50): Promise<ScanSummary[]> => {
        const res = await api.get('/api/v1/scans', { params: { tool, limit } });
        return res.data;
    },
    get: async (id: number): Promise<ScanDetail> => {
        const res = await api.get(`/api/v1/scans/${id}`);
        return res.data;
    },
    delete: async (id: number) => {
        const res = await api.delete(`/api/v1/scans/${id}`);
        return res.data;
    },
    /** Download a PDF report for a scan and trigger a browser download. */
    downloadReport: async (id: number, filename?: string) => {
        const res = await api.get(`/api/v1/scans/${id}/report.pdf`, { responseType: 'blob' });
        const blob = new Blob([res.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `cyber_arena_scan_${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    },
};

// --- Tool availability ----------------------------------------------------
export interface ToolHealthEntry {
    available: boolean;
    binaries: string[];
    missing: string[];
}
export interface ToolHealthResponse {
    tools: Record<string, ToolHealthEntry>;
    timestamp: string;
}
export const toolsAPI = {
    health: async (): Promise<ToolHealthResponse> => {
        const res = await api.get('/api/v1/tools/health');
        return res.data;
    },
};

// SOC / SIEM API
export interface SiemConfig {
    configured: boolean;
    url: string;
    auth: 'basic' | 'none';
    verify_ssl: boolean;
    index_pattern: string;
    alerts_index: string;
    timestamp_field: string;
    client_field: string;
    client_index_regex: string;
    client_scoping_enabled: boolean;
}

export interface SiemClient {
    name: string;
    doc_count: number;
    indices: string[];
    sources: ('field' | 'index')[];
}

export interface SiemHealth {
    cluster_name: string | null;
    status: 'green' | 'yellow' | 'red' | null;
    number_of_nodes: number | null;
    active_shards: number | null;
    unassigned_shards: number | null;
    indices: number | null;
    docs: number | null;
    store_bytes: number | null;
}

export interface SiemIndex {
    index: string;
    docs: number;
    size: string | null;
    health: string | null;
}

export interface SiemHit {
    _id: string;
    _index: string;
    _source: Record<string, any>;
}

export interface SiemSearchResult {
    total: number;
    took_ms: number;
    hits: SiemHit[];
}

export interface SiemAlert {
    _id: string;
    _index: string;
    timestamp: string | null;
    rule: string | null;
    severity: string | null;
    risk_score: number | null;
    status: string | null;
    host: string | null;
    user: string | null;
    message: string | null;
    _source: Record<string, any>;
}

export interface SiemBucket { time?: string; key?: string; count: number; }

export const socAPI = {
    config: async (): Promise<SiemConfig> => (await api.get('/api/soc/siem/config')).data,
    health: async (): Promise<SiemHealth> => (await api.get('/api/soc/siem/health')).data,
    indices: async (pattern?: string): Promise<SiemIndex[]> =>
        (await api.get('/api/soc/siem/indices', { params: pattern ? { pattern } : {} })).data,
    clients: async (params: { start?: string; size?: number } = {}):
        Promise<{ field: string; index_regex: string; clients: SiemClient[] }> =>
        (await api.get('/api/soc/siem/clients', { params })).data,
    search: async (params: {
        index?: string; q?: string; start?: string; end?: string;
        size?: number; from?: number; sort_desc?: boolean; client?: string;
    }): Promise<SiemSearchResult> =>
        (await api.post('/api/soc/siem/search', params)).data,
    alerts: async (params: {
        size?: number; start?: string; end?: string; severity?: string; status?: string; client?: string;
    } = {}): Promise<{ total: number; alerts: SiemAlert[] }> =>
        (await api.get('/api/soc/siem/alerts', { params })).data,
    eventsOverTime: async (params: {
        index?: string; q?: string; start?: string; end?: string; interval?: string; client?: string;
    } = {}): Promise<SiemBucket[]> =>
        (await api.post('/api/soc/siem/aggs/over_time', params)).data,
    topTerms: async (params: {
        field: string; index?: string; q?: string; start?: string; end?: string; size?: number; client?: string;
    }): Promise<SiemBucket[]> =>
        (await api.post('/api/soc/siem/aggs/top', params)).data,
};

// ============================================================================
//  Wazuh (SIEM / XDR / Threat Intel) — backed by /api/soc/wazuh/*
// ============================================================================

export type WazuhSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface WazuhConfig {
    configured: boolean;
    url: string;
    verify_ssl: boolean;
    alerts_index: string;
    vuln_index: string;
    monitoring_index: string;
    timestamp_field: string;
}

export interface WazuhHealth {
    cluster_name: string | null;
    status: 'green' | 'yellow' | 'red' | null;
    nodes: number | null;
    active_shards: number | null;
    unassigned_shards: number | null;
    indices: number | null;
    docs: number | null;
    alerts_total: number | null;
}

export interface WazuhSiemSummary {
    total: number;
    by_severity: Record<WazuhSeverity, number>;
    by_level: { level: number; count: number }[];
    unique_agents: number;
    unique_rules: number;
    mitre_techniques: number;
}

export interface WazuhAlert {
    id: string;
    index: string;
    timestamp: string | null;
    rule_id: string | null;
    rule_level: number | null;
    severity: WazuhSeverity;
    description: string | null;
    groups: string[];
    mitre_ids: string[];
    mitre_tactics: string[];
    mitre_techniques: string[];
    agent_id: string | null;
    agent_name: string | null;
    agent_ip: string | null;
    location: string | null;
    manager: string | null;
    full_log: string | null;
    data: Record<string, any>;
    pci_dss: string[];
    nist_800_53: string[];
    hipaa: string[];
    gdpr: string[];
    tsc: string[];
}

export interface WazuhOverTimePoint {
    time: string | number;
    count: number;
    by_severity?: Record<WazuhSeverity, number>;
}

export interface WazuhTopItem { key: string | number; count: number; }

export type WazuhVerdict = 'tp' | 'fp' | 'tn' | 'fn';

export interface WazuhClassifications {
    tp: number; fp: number; tn: number; fn: number;
    labeled: number; unreviewed: number; total_alerts: number;
    precision: number; recall: number; fp_rate: number; fn_rate: number;
    note: string;
}

export interface WazuhGeo {
    country_field_used: string | null;
    countries: WazuhTopItem[];
    source_ips: WazuhTopItem[];
    note: string | null;
}

export interface WazuhRulePerf {
    rule_id: string;
    description: string | null;
    level: number;
    fires: number;
    unique_agents: number;
    last_seen: string | null;
    fp_count: number;
    fp_rate: number;
}

export interface WazuhAgentRollup {
    agent_id: string;
    name: string;
    ip: string;
    alerts: number;
    max_level: number;
    top_severity: WazuhSeverity;
    last_seen: string | null;
    severity_breakdown: Record<WazuhSeverity, number>;
}

export interface WazuhVulnerability {
    id: string;
    cve: string | null;
    severity: string | null;
    cvss3: number | null;
    title: string | null;
    package: string | null;
    version: string | null;
    agent_id: string | null;
    agent_name: string | null;
    published: string | null;
    detection_time: string | null;
    reference: string | null;
}

export interface WazuhFimEvent {
    id: string;
    timestamp: string | null;
    event: string | null;
    path: string | null;
    mode: string | null;
    size_after:  string | null;
    size_before: string | null;
    md5_after:    string | null;
    sha1_after:   string | null;
    sha256_after: string | null;
    uname_after:  string | null;
    uname_before: string | null;
    uid_after:    string | null;
    gid_after:    string | null;
    perm_after:   string | null;
    perm_before:  string | null;
    changed_attributes: string[];
    agent_id: string | null;
    agent_name: string | null;
    rule_id: string | null;
    rule_level: number | null;
    rule_description: string | null;
    mitre_ids: string[];
    mitre_tactics: string[];
}

export interface WazuhScaFinding {
    id: string;
    timestamp: string | null;
    policy: string | null;
    check_id: string | null;
    title: string | null;
    result: string | null;
    rationale: string | null;
    compliance: Record<string, string[]>;
    agent_id: string | null;
    agent_name: string | null;
}

export interface WazuhTiSummary {
    range: { start: string; end: string };
    counts: Record<string, number>;
}

export interface WazuhVirusTotalHit {
    id: string;
    timestamp: string | null;
    malicious: number | null;
    positives: number | null;
    total: number | null;
    permalink: string | null;
    sha1: string | null;
    md5: string | null;
    scan_id: string | null;
    source_file: string | null;
    source_alert: string | null;
    description: string | null;
    agent_id: string | null;
    agent_name: string | null;
}

export interface WazuhMispHit {
    id: string; timestamp: string | null;
    event_id: string | null; category: string | null;
    description: string | null; value: string | null; type: string | null;
    agent_id: string | null; agent_name: string | null;
}

export interface WazuhAbuseIpDbHit {
    id: string; timestamp: string | null;
    score: number | null; country: string | null; ip: string | null;
    isp: string | null; usage_type: string | null; total_reports: number | null;
    agent_id: string | null; agent_name: string | null;
}

export interface WazuhMitreTechnique {
    id: string; name: string; count: number; tactics: string[];
}

export interface WazuhFimDashboard {
    total: number;
    actions: { added: number; modified: number; deleted: number };
    affected_agents: number;
    critical: number;
    top_agents: { agent_id: string | null; agent_name: string | null; count: number }[];
    top_rules:  { description: string | null; rule_id: string | null; level: number; count: number }[];
    top_users:  { user: string | null; agent_id: string | null; agent_name: string | null; count: number }[];
    over_time:  { time: string | number; count: number;
                  by_action: { added: number; modified: number; deleted: number } }[];
}

export interface WazuhMitreMatrix {
    techniques: WazuhMitreTechnique[];
    tactics: { key: string; count: number }[];
}

export const wazuhAPI = {
    config:  async (): Promise<WazuhConfig> => (await api.get('/api/soc/wazuh/config')).data,
    health:  async (): Promise<WazuhHealth> => (await api.get('/api/soc/wazuh/health')).data,

    // SIEM
    siemSummary: async (start = 'now-24h', end = 'now', agent?: string): Promise<WazuhSiemSummary> =>
        (await api.get('/api/soc/wazuh/siem/summary', { params: { start, end, agent: agent || undefined } })).data,

    siemAlerts: async (body: {
        start?: string; end?: string; min_level?: number; severity?: WazuhSeverity;
        agent?: string; rule_id?: string; q?: string; size?: number; from?: number;
    } = {}): Promise<{ total: number; alerts: WazuhAlert[] }> =>
        (await api.post('/api/soc/wazuh/siem/alerts', body)).data,

    siemOverTime: async (body: {
        start?: string; end?: string; interval?: string; by_severity?: boolean; q?: string;
        agent?: string;
    } = {}): Promise<WazuhOverTimePoint[]> =>
        (await api.post('/api/soc/wazuh/siem/events_over_time', body)).data,

    siemTop: async (body: {
        field: string; start?: string; end?: string; size?: number; q?: string;
        agent?: string;
    }): Promise<WazuhTopItem[]> =>
        (await api.post('/api/soc/wazuh/siem/top', body)).data,

    siemClassifications: async (start = 'now-24h', end = 'now', agent?: string)
        : Promise<WazuhClassifications> =>
        (await api.get('/api/soc/wazuh/siem/classifications', { params: { start, end, agent: agent || undefined } })).data,

    siemSetVerdict: async (body: {
        alert_id: string; verdict: WazuhVerdict | ''; rule_id?: string | null;
        rule_level?: number | null; note?: string;
    }): Promise<{ alert_id: string; verdict: WazuhVerdict | null }> =>
        (await api.post('/api/soc/wazuh/siem/verdict', body)).data,

    siemGetVerdicts: async (alertIds: string[])
        : Promise<{ verdicts: Record<string, WazuhVerdict> }> =>
        (await api.post('/api/soc/wazuh/siem/verdicts/bulk', { alert_ids: alertIds })).data,

    siemGeo: async (start = 'now-24h', end = 'now', size = 20, agent?: string)
        : Promise<WazuhGeo> =>
        (await api.get('/api/soc/wazuh/siem/geo', { params: { start, end, size, agent: agent || undefined } })).data,

    siemRulePerformance: async (start = 'now-24h', end = 'now', size = 15, agent?: string)
        : Promise<{ rules: WazuhRulePerf[] }> =>
        (await api.get('/api/soc/wazuh/siem/rule_performance', { params: { start, end, size, agent: agent || undefined } })).data,

    // XDR
    xdrAgents: async (start = 'now-24h', end = 'now', size = 50)
        : Promise<{ agents: WazuhAgentRollup[] }> =>
        (await api.get('/api/soc/wazuh/xdr/agents', { params: { start, end, size } })).data,

    xdrVulnerabilities: async (params: { severity?: string; agent?: string; size?: number } = {})
        : Promise<{ total: number; vulnerabilities: WazuhVulnerability[]; enabled: boolean; note?: string }> =>
        (await api.get('/api/soc/wazuh/xdr/vulnerabilities', { params })).data,

    xdrFimDashboard: async (params: {
        start?: string; end?: string; interval?: string; agent?: string; top_size?: number;
    } = {}): Promise<WazuhFimDashboard> =>
        (await api.get('/api/soc/wazuh/xdr/fim/dashboard', { params })).data,

    xdrFim: async (params: {
        start?: string; end?: string; size?: number; from?: number;
        event?: string; agent?: string; q?: string;
    } = {}): Promise<{ total: number; events: WazuhFimEvent[] }> =>
        (await api.get('/api/soc/wazuh/xdr/fim', { params })).data,

    xdrSca: async (params: { size?: number; status?: string } = {})
        : Promise<{ findings: WazuhScaFinding[] }> =>
        (await api.get('/api/soc/wazuh/xdr/sca', { params })).data,

    // Threat Intel
    tiSummary: async (start = 'now-7d', end = 'now'): Promise<WazuhTiSummary> =>
        (await api.get('/api/soc/wazuh/ti/summary', { params: { start, end } })).data,

    tiVirustotal: async (params: { start?: string; end?: string; malicious_only?: boolean; size?: number } = {})
        : Promise<{ total: number; hits: WazuhVirusTotalHit[] }> =>
        (await api.get('/api/soc/wazuh/ti/virustotal', { params })).data,

    tiMisp: async (params: { start?: string; end?: string; size?: number } = {})
        : Promise<{ hits: WazuhMispHit[] }> =>
        (await api.get('/api/soc/wazuh/ti/misp', { params })).data,

    tiAbuseIpDb: async (params: { start?: string; end?: string; size?: number } = {})
        : Promise<{ hits: WazuhAbuseIpDbHit[] }> =>
        (await api.get('/api/soc/wazuh/ti/abuseipdb', { params })).data,

    // MITRE
    mitreMatrix: async (start = 'now-7d', end = 'now', size = 200): Promise<WazuhMitreMatrix> =>
        (await api.get('/api/soc/wazuh/mitre/matrix', { params: { start, end, size } })).data,
};

// ============================================================================
// Phase 1 SOC platform extension API — Incidents, Cases, Alert Triage,
// IOC Intel, Threat Hunting, Asset Inventory, RBAC, Audit Log.
// Backed by /api/soc/* routers added in Phase 1.
// ============================================================================

export type IncidentStatus = 'open' | 'investigating' | 'escalated' | 'resolved' | 'closed';
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertClassification =
    'true_positive' | 'false_positive' | 'benign' | 'escalated' | 'resolved';
export type CaseStatus = 'open' | 'in_progress' | 'closed';
export type Tlp = 'white' | 'green' | 'amber' | 'red';

export interface Incident {
    id: number;
    title: string;
    description: string | null;
    status: IncidentStatus;
    severity: IncidentSeverity;
    category: string | null;
    source: string | null;
    created_by: number;
    assignee_id: number | null;
    case_id: number | null;
    related_alert_ids: string[];
    related_incident_ids: number[];
    mitre_techniques: string[];
    tags: string[];
    detected_at: string | null;
    acknowledged_at: string | null;
    resolved_at: string | null;
    closed_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    resolution: string | null;
}

export interface IncidentEvent {
    id: number;
    incident_id: number;
    user_id: number | null;
    kind: string;
    content: string | null;
    meta: Record<string, any>;
    created_at: string | null;
}

export interface IncidentDetail extends Incident {
    events: IncidentEvent[];
}

export interface IncidentStats {
    total: number;
    open: number;
    by_status: Record<string, number>;
    by_severity: Record<string, number>;
}

export const incidentsAPI = {
    list: async (params: {
        status?: IncidentStatus; severity?: IncidentSeverity;
        assignee_id?: number; q?: string; tag?: string;
        limit?: number; offset?: number;
    } = {}): Promise<{ total: number; items: Incident[] }> =>
        (await api.get('/api/soc/incidents', { params })).data,

    get: async (id: number): Promise<IncidentDetail> =>
        (await api.get(`/api/soc/incidents/${id}`)).data,

    create: async (body: Partial<Incident> & { title: string }): Promise<Incident> =>
        (await api.post('/api/soc/incidents', body)).data,

    patch: async (id: number, body: Partial<Incident>): Promise<Incident> =>
        (await api.patch(`/api/soc/incidents/${id}`, body)).data,

    addEvent: async (id: number, body: { kind?: string; content?: string; meta?: any }) =>
        (await api.post(`/api/soc/incidents/${id}/events`, body)).data,

    assign: async (id: number, assignee_id: number | null) =>
        (await api.post(`/api/soc/incidents/${id}/assign`, { assignee_id })).data,

    changeStatus: async (id: number, status: IncidentStatus, reason?: string) =>
        (await api.post(`/api/soc/incidents/${id}/status`, { status, reason })).data,

    linkRelated: async (id: number, alert_ids: string[] = [], incident_ids: number[] = []) =>
        (await api.post(`/api/soc/incidents/${id}/related`, { alert_ids, incident_ids })).data,

    delete: async (id: number) => (await api.delete(`/api/soc/incidents/${id}`)).data,

    summary: async (): Promise<IncidentStats> =>
        (await api.get('/api/soc/incidents/stats/summary')).data,
};

export interface CaseRow {
    id: number;
    title: string;
    summary: string | null;
    status: CaseStatus;
    severity: IncidentSeverity;
    tlp: Tlp;
    created_by: number;
    assignee_id: number | null;
    thehive_case_id: string | null;
    tags: string[];
    resolution: string | null;
    created_at: string | null;
    updated_at: string | null;
    closed_at: string | null;
}
export interface CaseEvent {
    id: number; case_id: number; user_id: number | null;
    kind: string; content: string | null; meta: Record<string, any>;
    created_at: string | null;
}
export interface CaseEvidence {
    id: number; case_id: number; uploaded_by: number;
    name: string; kind: string; mime_type: string | null;
    size_bytes: number; sha256: string | null;
    description: string | null;
    custody_log: Array<{ at: string; by_user_id: number | null; by_email: string | null; action: string; note: string }>;
    created_at: string | null;
}
export interface CaseDetail extends CaseRow {
    events: CaseEvent[];
    evidence: CaseEvidence[];
}

export const casesAPI = {
    list: async (params: {
        status?: CaseStatus; severity?: IncidentSeverity;
        assignee_id?: number; q?: string;
        limit?: number; offset?: number;
    } = {}): Promise<{ total: number; items: CaseRow[] }> =>
        (await api.get('/api/soc/cases', { params })).data,

    get: async (id: number): Promise<CaseDetail> =>
        (await api.get(`/api/soc/cases/${id}`)).data,

    create: async (body: Partial<CaseRow> & { title: string }): Promise<CaseRow> =>
        (await api.post('/api/soc/cases', body)).data,

    patch: async (id: number, body: Partial<CaseRow>): Promise<CaseRow> =>
        (await api.patch(`/api/soc/cases/${id}`, body)).data,

    delete: async (id: number) => (await api.delete(`/api/soc/cases/${id}`)).data,

    addEvent: async (id: number, body: { kind?: string; content?: string; meta?: any }) =>
        (await api.post(`/api/soc/cases/${id}/events`, body)).data,

    uploadEvidence: async (id: number, file: File, description?: string, kind = 'file'): Promise<CaseEvidence> => {
        const fd = new FormData();
        fd.append('file', file);
        if (description) fd.append('description', description);
        fd.append('kind', kind);
        const res = await api.post(`/api/soc/cases/${id}/evidence`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res.data;
    },

    downloadEvidence: async (caseId: number, evidenceId: number, filename: string) => {
        const res = await api.get(`/api/soc/cases/${caseId}/evidence/${evidenceId}/download`,
            { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
    },

    deleteEvidence: async (caseId: number, evidenceId: number) =>
        (await api.delete(`/api/soc/cases/${caseId}/evidence/${evidenceId}`)).data,
};

export interface AlertTriageState {
    id: number;
    alert_id: string;
    classification: AlertClassification | null;
    severity_override: IncidentSeverity | null;
    assignee_id: number | null;
    incident_id: number | null;
    case_id: number | null;
    notes: string | null;
    tags: string[];
    updated_by: number | null;
    created_at: string | null;
    updated_at: string | null;
}
export interface AlertTriageEventRow {
    id: number; alert_id: string; user_id: number | null;
    kind: string; content: string | null; meta: Record<string, any>;
    created_at: string | null;
}
export interface AlertTriageDetail {
    triage: AlertTriageState | null;
    events: AlertTriageEventRow[];
}

export const triageAPI = {
    get: async (alertId: string): Promise<AlertTriageDetail> =>
        (await api.get(`/api/soc/triage/${encodeURIComponent(alertId)}`)).data,

    update: async (alertId: string, body: Partial<AlertTriageState>): Promise<AlertTriageState> =>
        (await api.patch(`/api/soc/triage/${encodeURIComponent(alertId)}`, body)).data,

    addNote: async (alertId: string, content: string) =>
        (await api.post(`/api/soc/triage/${encodeURIComponent(alertId)}/notes`, { content })).data,

    link: async (alertId: string, body: { incident_id?: number | null; case_id?: number | null }) =>
        (await api.post(`/api/soc/triage/${encodeURIComponent(alertId)}/link`, body)).data,

    bulkClassify: async (alert_ids: string[], classification: AlertClassification) =>
        (await api.post('/api/soc/triage/bulk-classify', { alert_ids, classification })).data,

    list: async (params: {
        classification?: AlertClassification; assignee_id?: number;
        limit?: number; offset?: number;
    } = {}): Promise<{ total: number; items: AlertTriageState[] }> =>
        (await api.get('/api/soc/triage', { params })).data,
};

export interface IOCRow {
    id: number;
    type: 'ip' | 'domain' | 'url' | 'hash' | 'email';
    value: string;
    threat_score: number;
    confidence: string;
    source: string | null;
    tlp: Tlp;
    description: string | null;
    tags: string[];
    enrichment: Record<string, any>;
    first_seen: string | null;
    last_seen: string | null;
    created_at: string | null;
    updated_at: string | null;
}
export const iocsAPI = {
    list: async (params: { type?: string; q?: string; min_score?: number; limit?: number; offset?: number } = {})
        : Promise<{ total: number; items: IOCRow[] }> =>
        (await api.get('/api/soc/iocs', { params })).data,
    get: async (id: number): Promise<IOCRow> => (await api.get(`/api/soc/iocs/${id}`)).data,
    create: async (body: Partial<IOCRow> & { type: string; value: string }) =>
        (await api.post('/api/soc/iocs', body)).data,
    patch: async (id: number, body: Partial<IOCRow>) =>
        (await api.patch(`/api/soc/iocs/${id}`, body)).data,
    delete: async (id: number) => (await api.delete(`/api/soc/iocs/${id}`)).data,
    enrich: async (type: string, value: string, persist = true)
        : Promise<{ enrichment: Record<string, any>; ioc?: IOCRow }> =>
        (await api.post('/api/soc/iocs/enrich', null, { params: { type, value, persist } })).data,
};

export interface SavedHuntRow {
    id: number; user_id: number; name: string; description: string | null;
    filters: Record<string, any>; query_dsl: string | null;
    is_shared: boolean; tags: string[];
    created_at: string | null; updated_at: string | null;
}
export interface HuntFilters {
    ip?: string; username?: string; hostname?: string; process?: string;
    hash?: string; command_line?: string; mitre?: string;
    time_from?: string; time_to?: string; free_text?: string; size?: number;
}
export interface HuntResult {
    total: number; count: number; duration_ms: number;
    hits: Array<Record<string, any>>; query: any; error: string | null;
}
export const huntsAPI = {
    listSaved: async (): Promise<SavedHuntRow[]> =>
        (await api.get('/api/soc/hunts/saved')).data,
    saveNew: async (body: { name: string; description?: string; filters: HuntFilters; is_shared?: boolean; tags?: string[] }) =>
        (await api.post('/api/soc/hunts/saved', body)).data,
    patchSaved: async (id: number, body: any) =>
        (await api.patch(`/api/soc/hunts/saved/${id}`, body)).data,
    deleteSaved: async (id: number) => (await api.delete(`/api/soc/hunts/saved/${id}`)).data,
    execute: async (filters: HuntFilters, saved_hunt_id?: number): Promise<HuntResult> =>
        (await api.post('/api/soc/hunts/execute', filters, { params: saved_hunt_id ? { saved_hunt_id } : {} })).data,
    history: async (limit = 50) =>
        (await api.get('/api/soc/hunts/history', { params: { limit } })).data,
};

export interface AssetRow {
    id: number; hostname: string; ip: string | null; mac: string | null;
    os: string | null; os_version: string | null;
    agent_id: string | null; agent_status: string | null;
    criticality: number; risk_score: number; vuln_count: number;
    open_ports: number[]; services: any[]; software: any[];
    tags: string[]; owner: string | null; notes: string | null;
    last_seen: string | null; created_at: string | null; updated_at: string | null;
}
export interface AssetStats {
    total: number;
    by_agent_status: Record<string, number>;
    risk_buckets: Record<'critical' | 'high' | 'medium' | 'low', number>;
    total_vulnerabilities: number;
}
export const assetsAPI = {
    list: async (params: { q?: string; min_risk?: number; agent_status?: string; limit?: number; offset?: number } = {})
        : Promise<{ total: number; items: AssetRow[] }> =>
        (await api.get('/api/soc/assets', { params })).data,
    stats: async (): Promise<AssetStats> => (await api.get('/api/soc/assets/stats/summary')).data,
    get: async (id: number): Promise<AssetRow> => (await api.get(`/api/soc/assets/${id}`)).data,
    create: async (body: Partial<AssetRow> & { hostname: string }) =>
        (await api.post('/api/soc/assets', body)).data,
    patch: async (id: number, body: Partial<AssetRow>) =>
        (await api.patch(`/api/soc/assets/${id}`, body)).data,
    delete: async (id: number) => (await api.delete(`/api/soc/assets/${id}`)).data,
    syncWazuh: async () => (await api.post('/api/soc/assets/sync/wazuh')).data,
};

export interface RbacMe {
    id: number; email: string; username: string;
    role: string; permissions: string[];
}
export interface RbacRolesResp {
    roles: string[]; permissions: string[]; matrix: Record<string, string[]>;
}
export const rbacAPI = {
    me: async (): Promise<RbacMe> => (await api.get('/api/soc/rbac/me')).data,
    roles: async (): Promise<RbacRolesResp> => (await api.get('/api/soc/rbac/roles')).data,
    users: async (): Promise<Array<{ id: number; email: string; username: string; role: string; is_active: boolean }>> =>
        (await api.get('/api/soc/rbac/users')).data,
    setRole: async (userId: number, role: string) =>
        (await api.post(`/api/soc/rbac/users/${userId}/role`, { role })).data,
};

export const auditAPI = {
    list: async (params: { action?: string; resource_type?: string; user_id?: number; limit?: number; offset?: number } = {}) =>
        (await api.get('/api/soc/audit', { params })).data,
};

// ============================================================================
// Phase 4 — SOAR Control Center + Executive Dashboard.
// ============================================================================

export interface SoarActionParam {
    key: string;
    label: string;
    type: 'string' | 'number' | 'json';
    required: boolean;
}
export interface SoarActionSpec {
    key: string;
    label: string;
    description: string;
    permission: string;
    params: SoarActionParam[];
    workflow_id: string | null;
    webhook_url?: string | null;
}
export interface SoarConfig {
    platform: 'n8n' | 'shuffle' | 'none';
    shuffle_configured: boolean;
    shuffle_url: string | null;
    n8n_configured: boolean;
    n8n_url: string;
    actions: SoarActionSpec[];
}
export interface SoarExecutionRow {
    id: number;
    user_id: number;
    action: string;
    target: string | null;
    playbook: string | null;
    workflow_id: string | null;
    execution_id: string | null;
    status: 'pending' | 'running' | 'success' | 'failed' | 'local_only' | string;
    params: Record<string, any>;
    result: Record<string, any>;
    incident_id: number | null;
    created_at: string | null;
    finished_at: string | null;
}
export interface SoarStats {
    total: number; last_24h: number;
    by_action: Record<string, number>;
    by_status: Record<string, number>;
    shuffle_configured: boolean;
    n8n_configured: boolean;
}

export const soarAPI = {
    config: async (): Promise<SoarConfig> =>
        (await api.get('/api/soc/soar/config')).data,

    workflows: async (): Promise<{ workflows: Array<{ id: string; name: string; description: string; is_valid?: boolean }>; configured: boolean; platform?: string }> =>
        (await api.get('/api/soc/soar/workflows')).data,

    testConnection: async (): Promise<{ success: boolean; platform: string; message?: string; error?: string; workflow_count?: number }> =>
        (await api.get('/api/soc/soar/test-connection')).data,

    execute: async (body: {
        action: string; params: Record<string, any>;
        incident_id?: number | null; workflow_id?: string | null;
    }): Promise<SoarExecutionRow> =>
        (await api.post('/api/soc/soar/execute', body)).data,

    executions: async (params: {
        action?: string; status?: string; incident_id?: number;
        limit?: number; offset?: number;
    } = {}): Promise<{ total: number; items: SoarExecutionRow[] }> =>
        (await api.get('/api/soc/soar/executions', { params })).data,

    refresh: async (id: number): Promise<SoarExecutionRow> =>
        (await api.post(`/api/soc/soar/executions/${id}/refresh`)).data,

    stats: async (): Promise<SoarStats> =>
        (await api.get('/api/soc/soar/stats/summary')).data,
};

export interface ExecSummary {
    range_days: number;
    incidents: {
        total: number; open_now: number; resolved: number;
        by_severity: Record<string, number>;
        by_status: Record<string, number>;
    };
    mttd_seconds: number | null; mttr_seconds: number | null;
    mttd_h: string; mttr_h: string;
    triage: {
        true_positive: number; false_positive: number;
        benign: number; escalated: number; resolved: number;
        precision: number | null;
    };
    soar: { total: number; success: number; failed: number };
}
export interface ExecTrends {
    range_days: number;
    detections: Array<{ date: string; count: number }>;
    resolutions: Array<{ date: string; count: number }>;
    cases: Array<{ date: string; count: number }>;
    soar: Array<{ date: string; count: number }>;
    severity_by_day: Array<{ date: string; critical: number; high: number; medium: number; low: number; info: number }>;
}
export interface ExecTopAsset {
    id: number; hostname: string; ip: string | null;
    os: string | null; agent_status: string | null;
    risk_score: number; vuln_count: number; criticality: number;
}
export interface ExecAnalystRow {
    user_id: number; username: string;
    assigned: number; resolved: number;
    avg_ttr_seconds: number | null; avg_ttr_h: string;
}
export interface ExecThreatLandscape {
    categories: Array<{ key: string; count: number }>;
    mitre_techniques: Array<{ key: string; count: number }>;
}

// ============================================================================
// Phase 5 — Realtime monitoring + AI Security Assistant.
// ============================================================================

export interface RealtimeEvent {
    kind: string;
    at: string;
    data: Record<string, any>;
}

export const realtimeAPI = {
    /** REST polling fallback if WebSockets aren't available. */
    recent: async (limit = 50): Promise<{ items: RealtimeEvent[] }> =>
        (await api.get('/api/soc/realtime/recent', { params: { limit } })).data,

    /** Build a WS URL that points at the backend, with the token attached. */
    wsUrl: (): string => {
        const token = localStorage.getItem('token') || '';
        // Prefer same-origin so vite proxies it correctly in dev; otherwise use
        // the absolute backend URL.
        const base = API_BASE_URL || window.location.origin;
        const u = new URL('/api/soc/realtime/ws', base);
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        if (token) u.searchParams.set('token', token);
        return u.toString();
    },
};

export interface AIMessageRow {
    id: number;
    conversation_id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    tokens_used: number;
    created_at: string | null;
}
export interface AIConversationRow {
    id: number;
    user_id: number;
    title: string | null;
    context_type: string | null;
    context_id: string | null;
    created_at: string | null;
    updated_at: string | null;
}
export interface AIConversationDetail extends AIConversationRow {
    messages: AIMessageRow[];
}
export interface AIChatResponse {
    conversation: AIConversationRow;
    user_message: AIMessageRow;
    assistant_message: AIMessageRow;
    provider_disabled: boolean;
    error: boolean;
    model: string;
}
export type AIIntent = 'explain' | 'remediate' | 'summarize' | 'sigma' | 'investigate';

export const aiAPI = {
    config: async (): Promise<{ enabled: boolean; model: string; intents: AIIntent[] }> =>
        (await api.get('/api/soc/ai/config')).data,

    listConversations: async (): Promise<AIConversationRow[]> =>
        (await api.get('/api/soc/ai/conversations')).data,

    getConversation: async (id: number): Promise<AIConversationDetail> =>
        (await api.get(`/api/soc/ai/conversations/${id}`)).data,

    deleteConversation: async (id: number) =>
        (await api.delete(`/api/soc/ai/conversations/${id}`)).data,

    chat: async (body: {
        message: string;
        conversation_id?: number | null;
        context_type?: string | null;
        context_id?: string | null;
        intent?: AIIntent | null;
    }): Promise<AIChatResponse> =>
        (await api.post('/api/soc/ai/chat', body)).data,

    quick: async (intent: AIIntent, body: {
        message?: string;
        conversation_id?: number | null;
        context_type?: string | null;
        context_id?: string | null;
    }): Promise<AIChatResponse> =>
        (await api.post(`/api/soc/ai/quick/${intent}`, { message: '', ...body })).data,
};

export const execDashboardAPI = {
    summary: async (days = 30): Promise<ExecSummary> =>
        (await api.get('/api/soc/exec/summary', { params: { days } })).data,
    trends: async (days = 30): Promise<ExecTrends> =>
        (await api.get('/api/soc/exec/trends', { params: { days } })).data,
    topAssets: async (limit = 10): Promise<ExecTopAsset[]> =>
        (await api.get('/api/soc/exec/top_assets', { params: { limit } })).data,
    analystPerformance: async (days = 30): Promise<ExecAnalystRow[]> =>
        (await api.get('/api/soc/exec/analyst_performance', { params: { days } })).data,
    threatLandscape: async (days = 30): Promise<ExecThreatLandscape> =>
        (await api.get('/api/soc/exec/threat_landscape', { params: { days } })).data,
};

// ---------------------------------------------------------------------------
// TheHive (read-only mirror of an external TheHive 4.x instance)
// ---------------------------------------------------------------------------
export interface TheHiveConfig {
    configured: boolean;
    url: string;
    org: string | null;
    verify_ssl: boolean;
}

export interface TheHiveHealth {
    ok: boolean;
    status_code?: number;
    data?: any;
    error?: string;
}

export type TheHiveSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type TheHiveTlp = 'white' | 'green' | 'amber' | 'red';

export interface TheHiveCase {
    id: string;
    case_id: number | null;
    title: string;
    description?: string | null;
    status: string;
    severity: TheHiveSeverity;
    severity_raw?: number;
    tlp: TheHiveTlp;
    tlp_raw?: number;
    tags: string[];
    owner?: string | null;
    created_at?: number | null;
    updated_at?: number | null;
    end_date?: number | null;
    flag?: boolean;
    resolution_status?: string | null;
    impact_status?: string | null;
    summary?: string | null;
}

export interface TheHiveAlert {
    id: string;
    type?: string;
    source?: string;
    source_ref?: string;
    title: string;
    description?: string;
    status: string;
    severity: TheHiveSeverity;
    tlp: TheHiveTlp;
    tags: string[];
    case_id?: string | null;
    created_at?: number | null;
    updated_at?: number | null;
    follow?: boolean;
    artifact_count?: number;
}

export interface TheHiveTask {
    id: string;
    title: string;
    group?: string;
    description?: string;
    status: string;
    flag?: boolean;
    owner?: string | null;
    start_date?: number | null;
    due_date?: number | null;
    end_date?: number | null;
    created_at?: number | null;
}

export interface TheHiveObservable {
    id: string;
    data_type?: string;
    data?: string;
    message?: string;
    tags: string[];
    ioc?: boolean;
    sighted?: boolean;
    tlp: TheHiveTlp;
    created_at?: number | null;
}

export interface TheHiveSummary {
    cases: { total: number; by_status: Record<string, number>; by_severity: Record<TheHiveSeverity, number> };
    alerts: { total: number; by_status: Record<string, number>; by_type: Record<string, number> };
}

export const theHiveAPI = {
    config: async (): Promise<TheHiveConfig> =>
        (await api.get('/api/soc/thehive/config')).data,
    health: async (): Promise<TheHiveHealth> =>
        (await api.get('/api/soc/thehive/health')).data,
    summary: async (): Promise<TheHiveSummary> =>
        (await api.get('/api/soc/thehive/summary')).data,

    listCases: async (params: {
        range?: string; sort?: string; status?: string; severity?: number; q?: string;
    } = {}): Promise<{ total: number; items: TheHiveCase[] }> =>
        (await api.get('/api/soc/thehive/cases', { params })).data,
    getCase: async (id: string): Promise<TheHiveCase> =>
        (await api.get(`/api/soc/thehive/cases/${encodeURIComponent(id)}`)).data,
    listCaseTasks: async (id: string): Promise<TheHiveTask[]> =>
        (await api.get(`/api/soc/thehive/cases/${encodeURIComponent(id)}/tasks`)).data,
    listCaseObservables: async (id: string): Promise<TheHiveObservable[]> =>
        (await api.get(`/api/soc/thehive/cases/${encodeURIComponent(id)}/observables`)).data,

    listAlerts: async (params: {
        range?: string; sort?: string; status?: string; severity?: number; q?: string;
    } = {}): Promise<{ total: number; items: TheHiveAlert[] }> =>
        (await api.get('/api/soc/thehive/alerts', { params })).data,
    getAlert: async (id: string): Promise<TheHiveAlert & { observables: TheHiveObservable[] }> =>
        (await api.get(`/api/soc/thehive/alerts/${encodeURIComponent(id)}`)).data,
};

export default api;
