import React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Activity, ShieldAlert, Radar, RefreshCw, Search, Server,
    Bug, FileSearch, Globe, ChevronRight, ExternalLink,
    ArrowUpRight, ArrowDownRight, AlertTriangle, FilePlus2, FileEdit, FileX2, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../components/layout/Sidebar';
import { useAuth } from '../context/AuthContext';
import { wazuhAPI } from '../utils/api';
import type {
    WazuhConfig, WazuhHealth, WazuhSiemSummary, WazuhAlert,
    WazuhOverTimePoint, WazuhTopItem,
    WazuhFimEvent,
    WazuhTiSummary,
    WazuhVirusTotalHit, WazuhAbuseIpDbHit,
    WazuhSeverity, WazuhFimDashboard,
    WazuhClassifications, WazuhGeo, WazuhRulePerf, WazuhVerdict,
} from '../utils/api';

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

type TabId =
    | 'overview' | 'events'                          // SIEM mode
    | 'xdr-dashboard' | 'xdr-events'                 // XDR mode
    | 'ti-dashboard' | 'ti-intelligence' | 'ti-framework' | 'ti-events'; // Threat Intel mode

type SocMode = 'siem' | 'xdr' | 'ti';

const SIEM_TABS: { id: TabId; label: string; icon: any; desc: string }[] = [
    { id: 'overview', label: 'SIEM Overview',    icon: Activity,    desc: 'KPIs, events & severity' },
    { id: 'events',   label: 'Security Events',  icon: ShieldAlert, desc: 'Alerts, top rules & agents' },
];

const XDR_TABS: { id: TabId; label: string; icon: any; desc: string }[] = [
    { id: 'xdr-dashboard', label: 'Dashboard', icon: FileSearch,  desc: 'File integrity monitoring' },
    { id: 'xdr-events',    label: 'Events',    icon: ShieldAlert, desc: 'Raw FIM events table' },
];

const TI_TABS: { id: TabId; label: string; icon: any; desc: string }[] = [
    { id: 'ti-dashboard',    label: 'Dashboard',    icon: Activity,    desc: 'MITRE overview & heatmap' },
    { id: 'ti-intelligence', label: 'Intelligence', icon: Globe,       desc: 'Threat groups & mappings' },
    { id: 'ti-framework',    label: 'Framework',    icon: Radar,       desc: 'MITRE inventory & coverage' },
    { id: 'ti-events',       label: 'Events',       icon: ShieldAlert, desc: 'MITRE events table' },
];

const RANGE_OPTS: { label: string; start: string; interval: string }[] = [
    { label: 'Last 15m', start: 'now-15m', interval: '30s' },
    { label: 'Last 1h',  start: 'now-1h',  interval: '1m' },
    { label: 'Last 24h', start: 'now-24h', interval: '30m' },
    { label: 'Last 7d',  start: 'now-7d',  interval: '3h' },
    { label: 'Last 30d', start: 'now-30d', interval: '12h' },
    { label: 'Last 1y',  start: 'now-1y',  interval: '7d' },
];

const SEV_COLOR: Record<WazuhSeverity, string> = {
    critical: '#FF3B6B',
    high:     '#FF8A3D',
    medium:   '#F5C84B',
    low:      '#5BC0EB',
    info:     '#8A93A6',
};

const SEV_CHIP: Record<WazuhSeverity, string> = {
    critical: 'bg-neon-red/10 text-neon-red border-neon-red/30',
    high:     'bg-neon-magenta/10 text-neon-magenta border-neon-magenta/30',
    medium:   'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
    low:      'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
    info:     'bg-white/5 text-ui-muted border-ui-border/40',
};

// ---------------------------------------------------------------------------
//  Small formatters
// ---------------------------------------------------------------------------

function fmtNum(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

function fmtBytes(n?: number | null): string {
    if (!n) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function timeAgo(iso: string | null): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.max(1, Math.floor(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function clusterTone(s: string | null): string {
    if (s === 'green')  return 'text-neon-green';
    if (s === 'yellow') return 'text-neon-yellow';
    if (s === 'red')    return 'text-neon-red';
    return 'text-ui-muted';
}

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function SOC({ mode = 'siem' }: { mode?: SocMode } = {}) {
    const { user } = useAuth();
    const TABS = mode === 'xdr' ? XDR_TABS : mode === 'ti' ? TI_TABS : SIEM_TABS;
    const [tab, setTab] = useState<TabId>(TABS[0].id);
    const [rangeIdx, setRangeIdx] = useState(2);             // default: last 24h
    const range = RANGE_OPTS[rangeIdx];
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [nonce, setNonce] = useState(0);                    // manual refresh trigger

    // Global config / health — cheap calls, used by the header chip
    const [cfg, setCfg] = useState<WazuhConfig | null>(null);
    const [health, setHealth] = useState<WazuhHealth | null>(null);
    const [bootErr, setBootErr] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [c, h] = await Promise.all([wazuhAPI.config(), wazuhAPI.health()]);
                if (!cancelled) { setCfg(c); setHealth(h); }
            } catch (e: any) {
                if (!cancelled) setBootErr(e?.response?.data?.detail || e?.message || 'Wazuh not reachable');
            }
        })();
        return () => { cancelled = true; };
    }, [nonce]);

    useEffect(() => {
        if (!autoRefresh) return;
        const id = setInterval(() => setNonce(n => n + 1), 20_000);
        return () => clearInterval(id);
    }, [autoRefresh]);

    const refresh = () => { setNonce(n => n + 1); };
    const connected = cfg?.configured && health?.status;

    return (
        <div className="flex h-screen bg-ui-bg text-slate-200 font-sans overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col relative overflow-hidden bg-ui-bg">
                {/* Ambient bg — matches Dashboard */}
                <div className="absolute inset-0 bg-grid-white bg-[length:32px_32px] opacity-[0.025] pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-[480px] bg-gradient-glow pointer-events-none" />

                <main className="flex-1 overflow-y-auto p-8 relative z-10 custom-scrollbar">
                    <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="max-w-7xl mx-auto space-y-6"
                    >
                        {/* ----- Header ----- */}
                        <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
                            <div>
                                <div className="section-eyebrow mb-2">
                                    <span className="w-6 h-px bg-brand-primary/60" />
                                    Security operations
                                </div>
                                <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none">
                                    <span className="text-white">Wazuh </span>
                                    <span className="text-gradient-brand">
                                        {mode === 'xdr' ? 'XDR' : mode === 'ti' ? 'Threat Intel' : 'SIEM'}
                                    </span>
                                </h1>
                                <p className="text-ui-muted text-sm mt-3">
                                    {user ? <>Operator <span className="text-white font-semibold">{user.username}</span> · </> : null}
                                    {health ? <>cluster <span className="font-mono text-white">{health.cluster_name || '—'}</span> · </> : null}
                                    {health ? <>{fmtNum(health.alerts_total)} alerts indexed</> : bootErr ? <span className="text-neon-red">{bootErr}</span> : 'connecting…'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`chip ${connected ? 'chip-green' : 'chip-red'}`}>
                                    {connected
                                        ? <span className={`w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse`} />
                                        : <span className="w-1.5 h-1.5 rounded-full bg-neon-red" />}
                                    {connected ? `Wazuh · ${health?.status}` : 'Disconnected'}
                                </span>
                                <RangePicker idx={rangeIdx} onChange={setRangeIdx} />
                                <button
                                    onClick={() => setAutoRefresh(a => !a)}
                                    className={`cyber-button !py-2 !px-3 !text-xs ${autoRefresh ? 'cyber-button-primary' : 'cyber-button-outline'}`}
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${autoRefresh ? 'bg-ui-bg' : 'bg-ui-muted'}`} />
                                    Auto
                                </button>
                                <button onClick={refresh} className="cyber-button cyber-button-outline !py-2 !px-3 !text-xs" title="Refresh">
                                    <RefreshCw size={13} />
                                </button>
                            </div>
                        </div>

                        {/* ----- Tabs ----- */}
                        <div className="flex gap-1 border-b border-ui-border/40">
                            {TABS.map(t => {
                                const active = tab === t.id;
                                const Icon = t.icon;
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => setTab(t.id)}
                                        className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition ${
                                            active
                                                ? 'text-white border-brand-primary'
                                                : 'text-ui-muted border-transparent hover:text-white'
                                        }`}
                                    >
                                        <Icon size={15} />
                                        {t.label}
                                        <span className="text-[10px] font-mono text-ui-subtle normal-case">
                                            · {t.desc}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {bootErr && !connected && (
                            <div className="glass-panel p-5 border-neon-red/30 bg-neon-red/[0.04]">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="text-neon-red mt-0.5" size={18} />
                                    <div>
                                        <p className="text-white font-bold">Wazuh not reachable</p>
                                        <p className="text-ui-muted text-sm mt-1">{bootErr}</p>
                                        <p className="text-ui-muted text-xs mt-3 font-mono">
                                            Ensure <span className="text-white">WAZUH_URL</span>,{' '}
                                            <span className="text-white">WAZUH_USER</span>,{' '}
                                            <span className="text-white">WAZUH_PASSWORD</span> are set on the backend and the Wazuh host is reachable over your network/VPN.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ----- Tab content ----- */}
                        {tab === 'overview'      && <OverviewTab     key={`overview-${nonce}-${rangeIdx}`}     range={range} />}
                        {tab === 'events'        && <EventsTab       key={`events-${nonce}-${rangeIdx}`}       range={range} />}
                        {tab === 'xdr-dashboard' && <FimDashboardTab key={`xdr-dash-${nonce}-${rangeIdx}`}     range={range} />}
                        {tab === 'xdr-events'    && <FimEventsTab    key={`xdr-events-${nonce}-${rangeIdx}`}  range={range} />}
                        {tab === 'ti-dashboard'    && <TiDashboardTab    key={`ti-dash-${nonce}-${rangeIdx}`}   range={range} />}
                        {tab === 'ti-intelligence' && <TiIntelligenceTab key={`ti-intel-${nonce}-${rangeIdx}`}  range={range} />}
                        {tab === 'ti-framework'    && <TiFrameworkTab    key={`ti-frame-${nonce}-${rangeIdx}`}  range={range} />}
                        {tab === 'ti-events'       && <TiEventsTab       key={`ti-events-${nonce}-${rangeIdx}`} range={range} />}
                    </motion.div>
                </main>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
//  Range picker
// ---------------------------------------------------------------------------

function RangePicker({ idx, onChange }: { idx: number; onChange: (i: number) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                className="cyber-button cyber-button-outline !py-2 !px-3 !text-xs"
            >
                {RANGE_OPTS[idx].label}
                <ChevronRight size={12} className="rotate-90 opacity-60" />
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 glass-panel py-1.5 min-w-[140px] z-30">
                    {RANGE_OPTS.map((r, i) => (
                        <button
                            key={r.label}
                            onClick={() => { onChange(i); setOpen(false); }}
                            className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${i === idx ? 'text-brand-primary-bright' : 'text-ui-muted'}`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ===========================================================================
//  TAB: SIEM Overview
// ===========================================================================

function OverviewTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [summary, setSummary] = useState<WazuhSiemSummary | null>(null);
    const [overTime, setOverTime] = useState<WazuhOverTimePoint[]>([]);
    const [topRules, setTopRules] = useState<WazuhTopItem[]>([]);
    const [topAgents, setTopAgents] = useState<WazuhTopItem[]>([]);
    const [classif, setClassif] = useState<WazuhClassifications | null>(null);
    const [geo, setGeo] = useState<WazuhGeo | null>(null);
    const [rulePerf, setRulePerf] = useState<WazuhRulePerf[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Agent filter — empty string means "whole fleet" (matches the Wazuh
    // dashboard's behavior when agentId is unset). Apply on Enter / blur.
    const [agentInput, setAgentInput] = useState<string>('');
    const [agent, setAgent] = useState<string>('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const a = agent || undefined;
                const [s, ot, tr, ta, cls, g, rp] = await Promise.all([
                    wazuhAPI.siemSummary(range.start, 'now', a),
                    wazuhAPI.siemOverTime({ start: range.start, end: 'now', interval: range.interval, by_severity: true, agent: a }),
                    wazuhAPI.siemTop({ field: 'rule.description', start: range.start, end: 'now', size: 10, agent: a }),
                    wazuhAPI.siemTop({ field: 'agent.name',       start: range.start, end: 'now', size: 10, agent: a }),
                    wazuhAPI.siemClassifications(range.start, 'now', a),
                    wazuhAPI.siemGeo(range.start, 'now', 12, a),
                    wazuhAPI.siemRulePerformance(range.start, 'now', 10, a),
                ]);
                if (cancelled) return;
                setSummary(s); setOverTime(ot); setTopRules(tr); setTopAgents(ta);
                setClassif(cls); setGeo(g); setRulePerf(rp.rules);
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load SIEM overview.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start, range.interval, agent]);

    if (error) return <ErrorBlock msg={error} />;

    return (
        <div className="space-y-6">
            <div className="glass-panel p-3 flex flex-wrap items-center gap-3">
                <Server size={14} className="text-ui-muted" />
                <span className="text-xs text-ui-muted">Agent:</span>
                <input
                    type="text"
                    value={agentInput}
                    onChange={e => setAgentInput(e.target.value)}
                    onBlur={() => setAgent(agentInput.trim())}
                    onKeyDown={e => { if (e.key === 'Enter') setAgent(agentInput.trim()); }}
                    placeholder="agent.id or agent.name (blank = all)"
                    className="cyber-input !py-1.5 !px-2 !text-xs w-64 font-mono"
                />
                {agent && (
                    <button
                        onClick={() => { setAgentInput(''); setAgent(''); }}
                        className="chip chip-muted cursor-pointer"
                        title="Clear agent filter"
                    >
                        scoped to <span className="font-mono text-white ml-1">{agent}</span> · clear
                    </button>
                )}
                <span className="text-xs text-ui-muted ml-auto">
                    {agent ? `filtering on agent "${agent}"` : 'whole fleet'}
                </span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiTile label="Alerts" value={summary ? fmtNum(summary.total) : '—'}
                         hint={`in ${range.label.toLowerCase()}`}
                         spark={overTime.map(p => p.count)} color="#00E5A8" loading={loading} />
                <KpiTile label="Critical + high"
                         value={summary ? summary.by_severity.critical + summary.by_severity.high : '—'}
                         hint={summary ? `${summary.by_severity.critical} crit · ${summary.by_severity.high} high` : '—'}
                         color="#FF3B6B" loading={loading}
                         deltaTone={(summary?.by_severity.critical ?? 0) > 0 ? 'down' : 'up'} />
                <KpiTile label="Unique agents" value={summary ? summary.unique_agents : '—'}
                         hint="endpoints with events" color="#7C8CFF" loading={loading} />
                <KpiTile label="MITRE techniques" value={summary ? summary.mitre_techniques : '—'}
                         hint={summary ? `${summary.unique_rules} unique rules` : '—'} color="#A78BFA" loading={loading} />
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
                <div className="glass-panel p-5 lg:col-span-2">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h3 className="font-bold text-white">Events over time</h3>
                            <p className="text-ui-muted text-xs mt-0.5">Stacked by severity · {range.label}</p>
                        </div>
                        <div className="flex gap-1.5">
                            {(['critical','high','medium','low','info'] as WazuhSeverity[]).map(s => (
                                <span key={s} className={`chip ${SEV_CHIP[s]}`}>
                                    <span className="w-2 h-2 rounded-sm" style={{ background: SEV_COLOR[s] }} />
                                    {s}
                                </span>
                            ))}
                        </div>
                    </div>
                    <StackedBars data={overTime} />
                </div>
                <div className="glass-panel p-5">
                    <h3 className="font-bold text-white">Severity</h3>
                    <p className="text-ui-muted text-xs mb-4">{summary ? fmtNum(summary.total) : '—'} alerts</p>
                    <SeverityDonut totals={summary?.by_severity || { critical: 0, high: 0, medium: 0, low: 0, info: 0 }} />
                </div>
            </div>

            {/* ----- Classifications: TP / FP / TN / FN ----- */}
            <ClassificationCard data={classif} loading={loading} />

            {/* ----- Geo origins + Rule performance ----- */}
            <div className="grid lg:grid-cols-2 gap-4">
                <GeoOriginsCard data={geo} loading={loading} />
                <RulePerformanceCard rules={rulePerf} loading={loading} />
            </div>

            <div className="glass-panel p-5 grid lg:grid-cols-2 gap-6">
                <TopList title="Top rules" items={topRules} icon={AlertTriangle} />
                <TopList title="Top agents" items={topAgents} icon={Server} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
//  Overview · supporting cards
// ---------------------------------------------------------------------------

function ClassificationCard({ data, loading }: { data: WazuhClassifications | null; loading: boolean }) {
    const tp = data?.tp ?? 0, fp = data?.fp ?? 0, tn = data?.tn ?? 0, fn = data?.fn ?? 0;
    const labeled = data?.labeled ?? (tp + fp + tn + fn);
    const unreviewed = data?.unreviewed ?? 0;
    const denom = Math.max(1, labeled + unreviewed);
    const cells = [
        { key: 'tp', label: 'True Positives',  value: tp, color: '#00E5A8',
          hint: 'Real threats / activity' },
        { key: 'fp', label: 'False Positives', value: fp, color: '#FF3B6B',
          hint: 'Noise / wrongly fired' },
        { key: 'tn', label: 'True Negatives',  value: tn, color: '#7C8CFF',
          hint: 'Benign, correctly low' },
        { key: 'fn', label: 'False Negatives', value: fn, color: '#FF8A3D',
          hint: 'Should have fired but didn\u2019t' },
        { key: 'un', label: 'Unreviewed',      value: unreviewed, color: '#8A93A6',
          hint: 'No verdict yet' },
    ];
    return (
        <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="font-bold text-white">Detection accuracy</h3>
                    <p className="text-ui-muted text-xs mt-0.5">
                        {data
                            ? <>{labeled} labeled / {data.total_alerts} alerts
                                {' · '}Precision <span className="text-white font-mono">{(data.precision * 100).toFixed(1)}%</span>
                                {' · '}Recall <span className="text-white font-mono">{(data.recall * 100).toFixed(1)}%</span>
                                {' · '}FP rate <span className="text-white font-mono">{(data.fp_rate * 100).toFixed(1)}%</span></>
                            : '—'}
                    </p>
                </div>
                <span className="chip chip-muted" title={data?.note || ''}>analyst-decided</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {cells.map(c => (
                    <div key={c.key} className="rounded-xl bg-ui-surface-2/40 border border-ui-border/30 p-4 relative overflow-hidden">
                        <span className="absolute top-0 right-0 w-12 h-12 rounded-full blur-2xl"
                              style={{ background: c.color, opacity: 0.18 }} />
                        <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-[0.22em]">{c.label}</p>
                        <div className="text-2xl font-black tabular-nums text-white mt-1.5">
                            {loading ? <span className="inline-block w-12 h-5 rounded bg-ui-surface-2 animate-pulse" /> : fmtNum(c.value)}
                        </div>
                        <p className="text-[10px] text-ui-muted mt-1">{c.hint}</p>
                        <div className="h-1 mt-2.5 rounded-full bg-white/[0.04] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(c.value / denom) * 100}%`, background: c.color }} />
                        </div>
                    </div>
                ))}
            </div>
            <p className="text-[10px] text-ui-subtle font-mono mt-3">
                Click TP / FP / TN / FN on alerts in the <span className="text-white">Security Events</span> tab to label them. Counts are per-operator.
            </p>
        </div>
    );
}

function GeoOriginsCard({ data, loading }: { data: WazuhGeo | null; loading: boolean }) {
    const countries = data?.countries || [];
    const ips = data?.source_ips || [];
    const max = Math.max(1, ...countries.map(c => c.count), ...ips.map(i => i.count));

    return (
        <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="font-bold text-white">Attack geo origins</h3>
                    <p className="text-ui-muted text-xs mt-0.5">
                        {data?.country_field_used
                            ? <>Field <span className="font-mono text-white">{data.country_field_used}</span></>
                            : 'No GeoIP enrichment detected'}
                    </p>
                </div>
                <Globe size={14} className="text-ui-muted" />
            </div>

            {loading ? (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-3 rounded bg-ui-surface-2 animate-pulse" />
                    ))}
                </div>
            ) : countries.length === 0 && ips.length === 0 ? (
                <div className="text-center py-6">
                    <p className="text-white text-sm font-bold">No geo data</p>
                    <p className="text-ui-muted text-xs mt-1.5">{data?.note || 'No source IPs or countries to show.'}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {countries.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-widest mb-1">By country</p>
                            {countries.slice(0, 8).map(c => (
                                <BarRow key={String(c.key)} label={String(c.key || '—')} value={c.count} max={max} color="#FF3B6B" />
                            ))}
                        </div>
                    )}
                    {ips.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-widest mb-1">By source IP</p>
                            {ips.slice(0, 8).map(i => (
                                <BarRow key={String(i.key)} label={String(i.key)} value={i.count} max={max} color="#7C8CFF" mono />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function BarRow({ label, value, max, color, mono }: { label: string; value: number; max: number; color: string; mono?: boolean }) {
    return (
        <div>
            <div className="flex items-center justify-between text-xs mb-0.5">
                <span className={`text-ui-muted truncate max-w-[70%] ${mono ? 'font-mono' : ''}`}>{label}</span>
                <span className="font-mono text-white tabular-nums">{value}</span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
            </div>
        </div>
    );
}

function RulePerformanceCard({ rules, loading }: { rules: WazuhRulePerf[]; loading: boolean }) {
    return (
        <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="font-bold text-white">Rule performance</h3>
                    <p className="text-ui-muted text-xs mt-0.5">Top {rules.length || 10} by fire count · with FP rate</p>
                </div>
                <AlertTriangle size={14} className="text-ui-muted" />
            </div>
            {loading ? (
                <div className="space-y-2">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-9 rounded bg-ui-surface-2/30 animate-pulse" />
                    ))}
                </div>
            ) : rules.length === 0 ? (
                <EmptyMsg title="No rules" body="No rule activity in this window." />
            ) : (
                <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                        <thead className="text-left text-[9px] uppercase tracking-widest text-ui-muted">
                            <tr>
                                <th className="py-1.5 px-1">Rule</th>
                                <th className="px-1">Lvl</th>
                                <th className="px-1 text-right">Fires</th>
                                <th className="px-1 text-right">Agents</th>
                                <th className="px-1 text-right">FP%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map(r => {
                                const sev = r.level >= 12 ? 'critical'
                                          : r.level >= 9 ? 'high'
                                          : r.level >= 7 ? 'medium'
                                          : r.level >= 4 ? 'low' : 'info';
                                const fpPct = (r.fp_rate * 100);
                                const fpChip = fpPct >= 30 ? 'text-neon-red'
                                            : fpPct >= 10 ? 'text-neon-yellow'
                                            : 'text-ui-muted';
                                return (
                                    <tr key={r.rule_id} className="border-t border-ui-border/30 hover:bg-white/[0.02]">
                                        <td className="py-1.5 px-1">
                                            <div className="text-white font-medium truncate max-w-[280px]">{r.description || '—'}</div>
                                            <div className="text-[9px] font-mono text-ui-muted">id {r.rule_id}</div>
                                        </td>
                                        <td className="px-1">
                                            <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded border ${SEV_CHIP[sev as WazuhSeverity]}`}>
                                                L{r.level}
                                            </span>
                                        </td>
                                        <td className="px-1 text-right tabular-nums text-white">{r.fires}</td>
                                        <td className="px-1 text-right tabular-nums text-ui-muted">{r.unique_agents}</td>
                                        <td className={`px-1 text-right font-mono tabular-nums ${fpChip}`}>{fpPct.toFixed(0)}%</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ===========================================================================
//  TAB: Security Events
// ===========================================================================

function EventsTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [alerts, setAlerts] = useState<WazuhAlert[]>([]);
    const [total, setTotal] = useState(0);
    const [sev, setSev] = useState<WazuhSeverity | ''>('');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [verdicts, setVerdicts] = useState<Record<string, WazuhVerdict>>({});
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const r = await wazuhAPI.siemAlerts({
                start: range.start, end: 'now', size: 100,
                severity: sev || undefined, q: q || undefined,
            });
            setAlerts(r.alerts); setTotal(r.total);
            // Bulk-fetch verdicts for the visible alert ids
            if (r.alerts.length) {
                try {
                    const v = await wazuhAPI.siemGetVerdicts(r.alerts.map(a => a.id));
                    setVerdicts(v.verdicts);
                } catch { /* non-fatal */ }
            } else {
                setVerdicts({});
            }
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load events.');
        } finally {
            setLoading(false);
        }
    }, [range.start, sev, q]);

    useEffect(() => { load(); }, [load]);

    const setVerdict = async (a: WazuhAlert, next: WazuhVerdict) => {
        const current = verdicts[a.id];
        const value = current === next ? '' : next;        // toggle off if same
        // optimistic
        setVerdicts(prev => {
            const copy = { ...prev };
            if (value === '') delete copy[a.id]; else copy[a.id] = value as WazuhVerdict;
            return copy;
        });
        try {
            await wazuhAPI.siemSetVerdict({
                alert_id: a.id, verdict: value as WazuhVerdict | '',
                rule_id: a.rule_id, rule_level: a.rule_level ?? null,
            });
        } catch {
            // rollback on failure
            setVerdicts(prev => ({ ...prev, [a.id]: current as WazuhVerdict }));
        }
    };

    if (error) return <ErrorBlock msg={error} />;

    return (
        <div className="space-y-6">
            <div className="glass-panel p-4 flex flex-wrap items-center gap-3">
                <Search size={14} className="text-ui-muted" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
                    placeholder="Lucene query (e.g. agent.name:web01 AND rule.level:>=10)"
                    className="bg-transparent border-b border-ui-border/40 focus:border-brand-primary outline-none text-sm flex-1 min-w-[240px] text-white"
                />
                <div className="flex gap-1">
                    {(['', 'critical', 'high', 'medium', 'low', 'info'] as const).map(s => (
                        <button key={s || 'all'}
                                onClick={() => setSev(s)}
                                className={`chip cursor-pointer ${sev === s
                                    ? 'bg-brand-primary/15 text-brand-primary-bright border-brand-primary/40'
                                    : 'chip-muted'}`}>
                            {s || 'all'}
                        </button>
                    ))}
                </div>
                <span className="text-xs text-ui-muted ml-auto">
                    {loading ? 'loading…' : `${fmtNum(total)} matching · showing ${alerts.length}`}
                </span>
            </div>

            <div className="glass-panel p-5 overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="font-bold text-white">Alerts</h3>
                        <p className="text-ui-muted text-xs mt-0.5">
                            Live from <span className="font-mono">wazuh-alerts-*</span> · {range.label}
                        </p>
                    </div>
                </div>
                {alerts.length === 0 ? (
                    <EmptyMsg title="No alerts" body="Nothing matches the current filters." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-[10px] uppercase tracking-widest text-ui-muted">
                                <tr>
                                    <th className="py-2 pr-2">Sev</th>
                                    <th className="pr-2">Rule</th>
                                    <th className="pr-2">Agent</th>
                                    <th className="pr-2">MITRE</th>
                                    <th className="pr-2">Verdict</th>
                                    <th className="text-right">Age</th>
                                </tr>
                            </thead>
                            <tbody>
                                {alerts.map(a => {
                                    const expanded = open === a.id;
                                    return (
                                        <React.Fragment key={a.id}>
                                            <tr onClick={() => setOpen(expanded ? null : a.id)} className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer">
                                                <td className="py-2.5 pr-2">
                                                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${SEV_CHIP[a.severity]}`}>
                                                        {a.severity} · L{a.rule_level ?? '?'}
                                                    </span>
                                                </td>
                                                <td className="pr-2">
                                                    <div className="text-white font-medium truncate max-w-[420px]">{a.description || a.rule_id}</div>
                                                    <div className="text-[10px] text-ui-muted font-mono truncate max-w-[420px]">
                                                        {a.groups.slice(0, 3).join(' · ')} {a.rule_id ? `· ${a.rule_id}` : ''}
                                                    </div>
                                                </td>
                                                <td className="pr-2 font-mono text-xs text-ui-muted truncate max-w-[160px]">
                                                    {a.agent_name || a.agent_id || '—'}
                                                </td>
                                                <td className="pr-2">
                                                    {(a.mitre_ids || []).slice(0, 2).map(id => (
                                                        <span key={id} className="chip chip-muted mr-1 mb-0.5">{id}</span>
                                                    ))}
                                                    {(a.mitre_ids?.length || 0) > 2 && <span className="text-[10px] text-ui-muted">+{(a.mitre_ids?.length || 0) - 2}</span>}
                                                </td>
                                                <td className="pr-2" onClick={e => e.stopPropagation()}>
                                                    <VerdictPicker
                                                        current={verdicts[a.id]}
                                                        onPick={(v) => setVerdict(a, v)}
                                                    />
                                                </td>
                                                <td className="text-right text-xs text-ui-muted whitespace-nowrap">{timeAgo(a.timestamp)}</td>
                                            </tr>
                                            {expanded && (
                                                <tr key={`${a.id}-x`} className="bg-white/[0.02]">
                                                    <td colSpan={6} className="px-3 pb-4 pt-1">
                                                        <SiemEventDetails a={a} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}


function SiemEventDetails({ a }: { a: WazuhAlert }) {
    const rows: { k: string; v: React.ReactNode }[] = [
        { k: 'Rule ID',       v: a.rule_id || '—' },
        { k: 'Rule Level',    v: a.rule_level ?? '—' },
        { k: 'Description',   v: a.description || '—' },
        { k: 'Timestamp',     v: a.timestamp || '—' },
        { k: 'Index',         v: a.index || '—' },
        { k: 'Agent ID',      v: a.agent_id || '—' },
        { k: 'Agent Name',    v: a.agent_name || '—' },
        { k: 'Agent IP',      v: a.agent_ip || '—' },
        { k: 'Location',      v: a.location || '—' },
        { k: 'Groups',        v: (a.groups || []).length
                                  ? a.groups.map((g, i) => <span key={i} className="chip chip-muted mr-1">{g}</span>)
                                  : '—' },
        { k: 'MITRE IDs',     v: (Array.isArray(a.mitre_ids) ? a.mitre_ids : a.mitre_ids ? [a.mitre_ids] : []).length
                                  ? (Array.isArray(a.mitre_ids) ? a.mitre_ids : a.mitre_ids ? [a.mitre_ids] : []).map((m: any, i: number) => <span key={i} className="chip chip-muted mr-1 font-mono">{m}</span>)
                                  : '—' },
        { k: 'MITRE Tactics', v: (Array.isArray(a.mitre_tactics) ? a.mitre_tactics : a.mitre_tactics ? [a.mitre_tactics] : []).length
                                  ? (Array.isArray(a.mitre_tactics) ? a.mitre_tactics : a.mitre_tactics ? [a.mitre_tactics] : []).map((m: any, i: number) => <span key={i} className="chip chip-muted mr-1">{m}</span>)
                                  : '—' },
        { k: 'MITRE Techs',   v: (Array.isArray(a.mitre_techniques) ? a.mitre_techniques : a.mitre_techniques ? [a.mitre_techniques] : []).length
                                  ? (Array.isArray(a.mitre_techniques) ? a.mitre_techniques : a.mitre_techniques ? [a.mitre_techniques] : []).map((m: any, i: number) => <span key={i} className="chip chip-muted mr-1">{m}</span>)
                                  : '—' },
    ];
    return (
        <div className="rounded-md border border-ui-border/40 bg-ui-panel/40 p-4 mt-2">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {rows.map(r => (
                    <div key={r.k} className="flex gap-2">
                        <span className="text-ui-muted uppercase tracking-widest text-[10px] w-28 flex-none">{r.k}</span>
                        <span className="font-mono text-white break-words">{r.v}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function VerdictPicker({ current, onPick }: {
    current?: WazuhVerdict;
    onPick: (v: WazuhVerdict) => void;
}) {
    const opts: { v: WazuhVerdict; label: string; tone: string }[] = [
        { v: 'tp', label: 'TP', tone: 'text-neon-green border-neon-green/40 hover:bg-neon-green/10' },
        { v: 'fp', label: 'FP', tone: 'text-neon-red border-neon-red/40 hover:bg-neon-red/10' },
        { v: 'tn', label: 'TN', tone: 'text-neon-blue border-neon-blue/40 hover:bg-neon-blue/10' },
        { v: 'fn', label: 'FN', tone: 'text-neon-magenta border-neon-magenta/40 hover:bg-neon-magenta/10' },
    ];
    const activeBg: Record<WazuhVerdict, string> = {
        tp: 'bg-neon-green/15 text-neon-green border-neon-green/60',
        fp: 'bg-neon-red/15 text-neon-red border-neon-red/60',
        tn: 'bg-neon-blue/15 text-neon-blue border-neon-blue/60',
        fn: 'bg-neon-magenta/15 text-neon-magenta border-neon-magenta/60',
    };
    return (
        <div className="flex gap-1">
            {opts.map(o => {
                const active = current === o.v;
                return (
                    <button
                        key={o.v}
                        onClick={() => onPick(o.v)}
                        title={
                            o.v === 'tp' ? 'True Positive — real threat / legit detection'
                          : o.v === 'fp' ? 'False Positive — noise, no real threat'
                          : o.v === 'tn' ? 'True Negative — benign, correctly low-priority'
                                         : 'False Negative — should have fired but did not'
                        }
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wide transition
                            ${active ? activeBg[o.v] : `border-ui-border/40 text-ui-muted ${o.tone}`}`}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}


// ===========================================================================
//  TAB: XDR · Dashboard (File Integrity Monitoring)
// ===========================================================================
//
//  All widgets here render data fetched from /api/soc/wazuh/xdr/fim/dashboard
//  — a single backend aggregator that proxies the Wazuh indexer. No iframe,
//  no embed, no redirect. UI matches the Cyber Arena Midnight Ops palette.

const FIM_COLOR = {
    added:    '#00E5A8',
    modified: '#F5C84B',
    deleted:  '#FF3B6B',
} as const;

const FIM_PALETTE = [
    '#00E5A8', '#F5C84B', '#FF3B6B', '#7C8CFF', '#A78BFA',
    '#5BC0EB', '#FF8A3D', '#34D399', '#F472B6', '#94A3B8',
];

function fimEventChip(e: string | null): string {
    const x = (e || '').toLowerCase();
    if (x === 'added')    return 'chip-green';
    if (x === 'modified') return 'chip-yellow';
    if (x === 'deleted')  return 'chip-red';
    return 'chip-muted';
}
// retain export for any future event-row usage
void fimEventChip;

function FimDashboardTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [data, setData] = useState<WazuhFimDashboard | null>(null);
    const [agentInput, setAgentInput] = useState<string>('');
    const [agent, setAgent] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const d = await wazuhAPI.xdrFimDashboard({
                    start: range.start, end: 'now', interval: range.interval,
                    agent: agent || undefined, top_size: 10,
                });
                if (!cancelled) setData(d);
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load FIM dashboard.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start, range.interval, agent]);

    if (error) return <ErrorBlock msg={error} />;

    const a = data?.actions || { added: 0, modified: 0, deleted: 0 };
    const totalSpark = (data?.over_time || []).map(p => p.count);

    return (
        <div className="space-y-6">
            {/* ---- Filter bar ---- */}
            <div className="glass-panel p-3 flex flex-wrap items-center gap-3">
                <Server size={14} className="text-ui-muted" />
                <span className="text-xs text-ui-muted">Agent:</span>
                <input
                    type="text"
                    value={agentInput}
                    onChange={e => setAgentInput(e.target.value)}
                    onBlur={() => setAgent(agentInput.trim())}
                    onKeyDown={e => { if (e.key === 'Enter') setAgent(agentInput.trim()); }}
                    placeholder="agent.id or agent.name (blank = all)"
                    className="cyber-input !py-1.5 !px-2 !text-xs w-64 font-mono"
                />
                {agent && (
                    <button
                        onClick={() => { setAgentInput(''); setAgent(''); }}
                        className="chip chip-muted cursor-pointer"
                        title="Clear agent filter"
                    >
                        scoped to <span className="font-mono text-white ml-1">{agent}</span> · clear
                    </button>
                )}
                <span className="text-xs text-ui-muted ml-auto">
                    {agent ? `filtering on agent "${agent}"` : 'whole fleet'}
                </span>
            </div>

            {/* ---- Overview cards (7) ---- */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <KpiTile label="Total FIM events" value={data ? fmtNum(data.total) : '—'}
                         hint={`in ${range.label.toLowerCase()}`}
                         spark={totalSpark} color="#00E5A8" loading={loading} />
                <KpiTile label="Modified" value={a.modified} hint="content changed"
                         color={FIM_COLOR.modified} loading={loading} />
                <KpiTile label="Added" value={a.added} hint="new on disk"
                         color={FIM_COLOR.added} loading={loading} />
                <KpiTile label="Deleted" value={a.deleted} hint="removed"
                         color={FIM_COLOR.deleted} loading={loading}
                         deltaTone={a.deleted > 0 ? 'down' : 'up'} />
                <KpiTile label="Affected agents" value={data ? data.affected_agents : '—'}
                         hint="distinct endpoints" color="#7C8CFF" loading={loading} />
                <KpiTile label="Critical events" value={data ? data.critical : '—'}
                         hint="rule.level ≥ 12" color="#FF3B6B" loading={loading}
                         deltaTone={(data?.critical ?? 0) > 0 ? 'down' : 'up'} />
            </div>

            {/* ---- Action area chart + Event summary ---- */}
            <div className="grid lg:grid-cols-3 gap-4">
                <div className="glass-panel p-5 lg:col-span-2">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h3 className="font-bold text-white">Alerts by action over time</h3>
                            <p className="text-ui-muted text-xs mt-0.5">Stacked area · {range.label}</p>
                        </div>
                        <div className="flex gap-1.5">
                            {(['added','modified','deleted'] as const).map(k => (
                                <span key={k} className="chip chip-muted">
                                    <span className="w-2 h-2 rounded-sm" style={{ background: FIM_COLOR[k] }} />
                                    {k}
                                </span>
                            ))}
                        </div>
                    </div>
                    <FimActionArea data={data?.over_time || []} />
                </div>
                <div className="glass-panel p-5">
                    <h3 className="font-bold text-white">Event summary</h3>
                    <p className="text-ui-muted text-xs mb-4">
                        {data ? fmtNum(data.total) : '—'} total · {data ? data.affected_agents : '—'} agents
                    </p>
                    <FimSpark data={data?.over_time || []} color="#00E5A8" />
                    <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                        <FimMiniStat label="added"    value={a.added}    color={FIM_COLOR.added} />
                        <FimMiniStat label="modified" value={a.modified} color={FIM_COLOR.modified} />
                        <FimMiniStat label="deleted"  value={a.deleted}  color={FIM_COLOR.deleted} />
                    </div>
                </div>
            </div>

            {/* ---- Donut row: Top agents · Actions · Rules ---- */}
            <div className="grid lg:grid-cols-3 gap-4">
                <div className="glass-panel p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold text-white">Top agents</h3>
                        <Server size={14} className="text-ui-muted" />
                    </div>
                    <FimDonut items={(data?.top_agents || []).map((t, i) => ({
                        label: t.agent_name || t.agent_id || '—',
                        value: t.count,
                        color: FIM_PALETTE[i % FIM_PALETTE.length],
                    }))} />
                </div>
                <div className="glass-panel p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold text-white">Actions distribution</h3>
                        <FilePlus2 size={14} className="text-ui-muted" />
                    </div>
                    <FimDonut items={[
                        { label: 'added',    value: a.added,    color: FIM_COLOR.added    },
                        { label: 'modified', value: a.modified, color: FIM_COLOR.modified },
                        { label: 'deleted',  value: a.deleted,  color: FIM_COLOR.deleted  },
                    ]} />
                </div>
                <div className="glass-panel p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold text-white">Rule distribution</h3>
                        <ShieldAlert size={14} className="text-ui-muted" />
                    </div>
                    <FimDonut items={(data?.top_rules || []).map((r, i) => ({
                        label: r.description || (r.rule_id ? `rule ${r.rule_id}` : '—'),
                        value: r.count,
                        color: FIM_PALETTE[i % FIM_PALETTE.length],
                    }))} />
                </div>
            </div>

            {/* ---- Top users table ---- */}
            <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="font-bold text-white">Top users</h3>
                        <p className="text-ui-muted text-xs mt-0.5">Distinct FIM events per user · ranked</p>
                    </div>
                    <Users size={14} className="text-ui-muted" />
                </div>
                {(data?.top_users || []).length === 0 ? (
                    <EmptyMsg title="No user data"
                              body="Wazuh FIM events aren't tagged with a post-change owner in this window." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-[10px] uppercase tracking-widest text-ui-muted">
                                <tr>
                                    <th className="py-2 pr-3">User</th>
                                    <th className="pr-3">Agent ID</th>
                                    <th className="pr-3">Agent name</th>
                                    <th className="text-right">Events</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data?.top_users || []).map((u, i) => (
                                    <tr key={`${u.user || ''}-${i}`}
                                        className="border-t border-ui-border/30 hover:bg-white/[0.02]">
                                        <td className="py-2.5 pr-3 font-mono text-xs text-white">{u.user || '—'}</td>
                                        <td className="pr-3 font-mono text-xs text-ui-muted">{u.agent_id || '—'}</td>
                                        <td className="pr-3 text-xs text-ui-muted truncate max-w-[280px]">{u.agent_name || '—'}</td>
                                        <td className="text-right font-mono text-sm text-white tabular-nums">{fmtNum(u.count)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function FimMiniStat({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="rounded-md border border-ui-border/40 py-2">
            <div className="text-lg font-black tabular-nums" style={{ color }}>{fmtNum(value)}</div>
            <div className="text-[10px] uppercase tracking-widest text-ui-muted">{label}</div>
        </div>
    );
}

function FimSpark({ data, color }: { data: WazuhFimDashboard['over_time']; color: string }) {
    if (!data.length) return <EmptyMsg title="No events" body="Nothing recorded in this window." />;
    const w = 320, h = 80;
    const max = Math.max(1, ...data.map(d => d.count));
    const stepX = w / Math.max(1, data.length - 1);
    const pts = data.map((d, i) => {
        const x = i * stepX;
        const y = h - (d.count / max) * (h - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const path = `M${pts.join(' L')}`;
    const area = `${path} L${w},${h} L0,${h} Z`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
            <defs>
                <linearGradient id="fim-spark-grad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%"  stopColor={color} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill="url(#fim-spark-grad)" />
            <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
    );
}

function FimActionArea({ data }: { data: WazuhFimDashboard['over_time'] }) {
    if (!data.length) return <EmptyMsg title="No FIM activity" body="No FIM alerts in this time range." />;
    const w = 800, h = 220;
    const max = Math.max(1, ...data.map(p => p.by_action.added + p.by_action.modified + p.by_action.deleted));
    const stepX = w / Math.max(1, data.length - 1);

    // Cumulative tops so areas stack: added (bottom) → modified → deleted (top)
    const cum = data.map(p => {
        const added = p.by_action.added;
        const modified = added + p.by_action.modified;
        const deleted  = modified + p.by_action.deleted;
        return { added, modified, deleted };
    });

    const yOf = (v: number) => h - (v / max) * (h - 8) - 4;

    const areaFor = (key: 'added' | 'modified' | 'deleted') => {
        const top: string[] = [];
        const bot: string[] = [];
        data.forEach((_, i) => {
            const x = i * stepX;
            const yTop = yOf(cum[i][key]);
            const yBot = key === 'added'    ? h
                       : key === 'modified' ? yOf(cum[i].added)
                                            : yOf(cum[i].modified);
            top.push(`${x.toFixed(1)},${yTop.toFixed(1)}`);
            bot.push(`${x.toFixed(1)},${yBot.toFixed(1)}`);
        });
        return `M${top.join(' L')} L${bot.reverse().join(' L')} Z`;
    };

    const lineFor = (key: 'added' | 'modified' | 'deleted') => {
        const pts = data.map((_, i) => `${(i * stepX).toFixed(1)},${yOf(cum[i][key]).toFixed(1)}`);
        return `M${pts.join(' L')}`;
    };

    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56">
            {(['deleted','modified','added'] as const).map(k => (
                <path key={`a-${k}`} d={areaFor(k)} fill={FIM_COLOR[k]} fillOpacity={0.45} />
            ))}
            {(['deleted','modified','added'] as const).map(k => (
                <path key={`l-${k}`} d={lineFor(k)} fill="none" stroke={FIM_COLOR[k]} strokeWidth="1.25" strokeOpacity="0.95" />
            ))}
        </svg>
    );
}

function FimDonut({ items }: { items: { label: string; value: number; color: string }[] }) {
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) return <EmptyMsg title="No data" body="No events to plot in this window." />;
    const r = 56, cx = 72, cy = 72, circ = 2 * Math.PI * r;
    let acc = 0;
    return (
        <div className="flex flex-col items-center gap-3">
            <svg viewBox="0 0 144 144" className="w-32 h-32">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1F2532" strokeWidth="14" />
                {items.map((it, i) => {
                    const dash = (it.value / total) * circ;
                    const off = -acc;
                    acc += dash;
                    return (
                        <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                                stroke={it.color} strokeWidth="14"
                                strokeDasharray={`${dash} ${circ - dash}`}
                                strokeDashoffset={off}
                                transform={`rotate(-90 ${cx} ${cy})`} />
                    );
                })}
                <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
                      className="fill-white font-bold" fontSize="18">{fmtNum(total)}</text>
            </svg>
            <div className="w-full space-y-1.5">
                {items.slice(0, 6).map((it, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-sm flex-none" style={{ background: it.color }} />
                        <span className="text-ui-muted truncate flex-1">{it.label}</span>
                        <span className="font-mono text-white tabular-nums">{fmtNum(it.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}


// ===========================================================================
//  TAB: XDR · Events (raw FIM events, paginated)
// ===========================================================================
//
//  Backed by /api/soc/wazuh/xdr/fim — same data source the Wazuh "FIM →
//  events" view consumes (alerts that carry a syscheck.path field). We
//  render the same dataset in the Cyber Arena table style: no iframe.

function FimEventsTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [data, setData] = useState<{ total: number; events: WazuhFimEvent[] }>({ total: 0, events: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [evt, setEvt] = useState<'' | 'added' | 'modified' | 'deleted'>('');
    const [agentInput, setAgentInput] = useState('');
    const [agent, setAgent] = useState('');
    const [qInput, setQInput] = useState('');
    const [q, setQ] = useState('');
    // Pagination
    const PAGE_SIZE = 50;
    const [page, setPage] = useState(0);
    const [open, setOpen] = useState<string | null>(null);     // expanded row id

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const r = await wazuhAPI.xdrFim({
                    start: range.start, end: 'now',
                    size: PAGE_SIZE, from: page * PAGE_SIZE,
                    event: evt || undefined,
                    agent: agent || undefined,
                    q: q || undefined,
                });
                if (!cancelled) setData(r);
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load FIM events.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start, evt, agent, q, page]);

    if (error) return <ErrorBlock msg={error} />;

    const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

    return (
        <div className="space-y-6">
            {/* ----- Filter bar ----- */}
            <div className="glass-panel p-3 flex flex-wrap items-center gap-3">
                <FileSearch size={14} className="text-ui-muted" />
                <span className="text-xs text-ui-muted">Action:</span>
                <div className="flex gap-1">
                    {(['', 'added', 'modified', 'deleted'] as const).map(s => (
                        <button key={s || 'all'}
                                onClick={() => { setEvt(s); setPage(0); }}
                                className={`chip cursor-pointer ${evt === s
                                    ? 'bg-brand-primary/15 text-brand-primary-bright border-brand-primary/40'
                                    : 'chip-muted'}`}>
                            {s || 'all'}
                        </button>
                    ))}
                </div>

                <span className="text-xs text-ui-muted ml-3">Agent:</span>
                <input
                    type="text"
                    value={agentInput}
                    onChange={e => setAgentInput(e.target.value)}
                    onBlur={() => { setAgent(agentInput.trim()); setPage(0); }}
                    onKeyDown={e => { if (e.key === 'Enter') { setAgent(agentInput.trim()); setPage(0); } }}
                    placeholder="agent.id or name"
                    className="cyber-input !py-1.5 !px-2 !text-xs w-44 font-mono"
                />

                <span className="text-xs text-ui-muted ml-3">Search:</span>
                <input
                    type="text"
                    value={qInput}
                    onChange={e => setQInput(e.target.value)}
                    onBlur={() => { setQ(qInput.trim()); setPage(0); }}
                    onKeyDown={e => { if (e.key === 'Enter') { setQ(qInput.trim()); setPage(0); } }}
                    placeholder='Lucene · e.g. syscheck.path:"/etc/passwd"'
                    className="cyber-input !py-1.5 !px-2 !text-xs flex-1 min-w-[260px] font-mono"
                />

                <span className="text-xs text-ui-muted ml-auto">
                    {loading ? 'loading…' : `${fmtNum(data.total)} matching · page ${page + 1}/${pageCount}`}
                </span>
            </div>

            {/* ----- KPIs ----- */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiTile label="Matching events" value={fmtNum(data.total)} hint={`in ${range.label.toLowerCase()}`}
                         color="#00E5A8" loading={loading} />
                <KpiTile label="Showing" value={data.events.length} hint={`page ${page + 1} of ${pageCount}`}
                         color="#7C8CFF" loading={loading} />
                <KpiTile label="Critical" value={data.events.filter(e => (e.rule_level || 0) >= 12).length}
                         hint="rule.level ≥ 12" color="#FF3B6B" loading={loading} />
                <KpiTile label="Unique paths"
                         value={new Set(data.events.map(e => e.path).filter(Boolean)).size}
                         hint="distinct files in page" color="#A78BFA" loading={loading} />
            </div>

            {/* ----- Events table ----- */}
            <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="font-bold text-white">FIM events</h3>
                        <p className="text-ui-muted text-xs mt-0.5">Click a row to expand details</p>
                    </div>
                    <FileSearch size={14} className="text-ui-muted" />
                </div>

                {data.events.length === 0 ? (
                    <EmptyMsg title="Quiet" body="No FIM events match this filter." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-[10px] uppercase tracking-widest text-ui-muted">
                                <tr>
                                    <th className="py-2 pr-3">Action</th>
                                    <th className="pr-3">When</th>
                                    <th className="pr-3">Agent</th>
                                    <th className="pr-3">Path</th>
                                    <th className="pr-3">Rule</th>
                                    <th className="pr-3">User</th>
                                    <th className="pr-3">MITRE</th>
                                    <th className="text-right">Lvl</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.events.map(f => {
                                    const expanded = open === f.id;
                                    return (
                                        <>
                                            <tr key={f.id}
                                                onClick={() => setOpen(expanded ? null : f.id)}
                                                className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer">
                                                <td className="py-2.5 pr-3">
                                                    <span className={`chip ${fimEventChip(f.event)}`}>{f.event || '—'}</span>
                                                </td>
                                                <td className="pr-3 text-xs text-ui-muted whitespace-nowrap">{timeAgo(f.timestamp)}</td>
                                                <td className="pr-3 font-mono text-xs text-ui-muted truncate max-w-[160px]">
                                                    {f.agent_name || f.agent_id || '—'}
                                                </td>
                                                <td className="pr-3 font-mono text-xs text-white truncate max-w-[420px]"
                                                    title={f.path || ''}>{f.path || '—'}</td>
                                                <td className="pr-3 text-xs text-ui-muted truncate max-w-[260px]"
                                                    title={f.rule_description || ''}>
                                                    {f.rule_description || (f.rule_id ? `rule ${f.rule_id}` : '—')}
                                                </td>
                                                <td className="pr-3 font-mono text-xs text-ui-muted truncate max-w-[120px]">
                                                    {f.uname_after || f.uname_before || '—'}
                                                </td>
                                                <td className="pr-3 text-[10px] font-mono text-ui-muted truncate max-w-[140px]">
                                                    {(f.mitre_ids || []).slice(0, 2).join(', ') || '—'}
                                                </td>
                                                <td className="text-right font-mono text-xs text-white tabular-nums">
                                                    {f.rule_level ?? '—'}
                                                </td>
                                            </tr>
                                            {expanded && (
                                                <tr key={`${f.id}-x`} className="bg-white/[0.02]">
                                                    <td colSpan={8} className="px-3 pb-4 pt-1">
                                                        <FimEventDetails f={f} />
                                                    </td>
                                                </tr>
                                            )}
                                        </>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* ----- Pagination footer ----- */}
                <div className="flex items-center justify-between mt-4 text-xs text-ui-muted">
                    <span>{loading ? 'loading…' : `${fmtNum(data.total)} matching events`}</span>
                    <div className="flex gap-1.5">
                        <button onClick={() => setPage(0)} disabled={page === 0}
                                className="cyber-button cyber-button-outline !py-1.5 !px-2 !text-[11px] disabled:opacity-40">
                            « first
                        </button>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                className="cyber-button cyber-button-outline !py-1.5 !px-2 !text-[11px] disabled:opacity-40">
                            ‹ prev
                        </button>
                        <span className="px-2 py-1 font-mono text-white">{page + 1} / {pageCount}</span>
                        <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                                disabled={page + 1 >= pageCount}
                                className="cyber-button cyber-button-outline !py-1.5 !px-2 !text-[11px] disabled:opacity-40">
                            next ›
                        </button>
                        <button onClick={() => setPage(pageCount - 1)}
                                disabled={page + 1 >= pageCount}
                                className="cyber-button cyber-button-outline !py-1.5 !px-2 !text-[11px] disabled:opacity-40">
                            last »
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FimEventDetails({ f }: { f: WazuhFimEvent }) {
    const rows: { k: string; v: React.ReactNode }[] = [
        { k: 'Path',          v: <code className="text-white">{f.path || '—'}</code> },
        { k: 'Action',        v: <span className={`chip ${fimEventChip(f.event)}`}>{f.event || '—'}</span> },
        { k: 'Timestamp',     v: f.timestamp || '—' },
        { k: 'Agent',         v: `${f.agent_name || '—'} (${f.agent_id || '—'})` },
        { k: 'Mode',          v: f.mode || '—' },
        { k: 'Rule',          v: `${f.rule_description || '—'}${f.rule_id ? ` · id ${f.rule_id}` : ''}${f.rule_level != null ? ` · lvl ${f.rule_level}` : ''}` },
        { k: 'Owner (after)',  v: f.uname_after || '—' },
        { k: 'Owner (before)', v: f.uname_before || '—' },
        { k: 'UID / GID',     v: `${f.uid_after || '—'} / ${f.gid_after || '—'}` },
        { k: 'Permissions',   v: `${f.perm_before || '—'} → ${f.perm_after || '—'}` },
        { k: 'Size',          v: `${f.size_before || '—'} → ${f.size_after || '—'}` },
        { k: 'MD5',           v: f.md5_after ? <code className="text-ui-muted">{f.md5_after}</code> : '—' },
        { k: 'SHA1',          v: f.sha1_after ? <code className="text-ui-muted">{f.sha1_after}</code> : '—' },
        { k: 'SHA256',        v: f.sha256_after ? <code className="text-ui-muted break-all">{f.sha256_after}</code> : '—' },
        { k: 'Changed',       v: (f.changed_attributes || []).length
                                  ? f.changed_attributes.map((c, i) => <span key={i} className="chip chip-muted mr-1">{c}</span>)
                                  : '—' },
        { k: 'MITRE',         v: (f.mitre_ids || []).length
                                  ? f.mitre_ids.map((m, i) => <span key={i} className="chip chip-muted mr-1 font-mono">{m}</span>)
                                  : '—' },
    ];
    return (
        <div className="rounded-md border border-ui-border/40 bg-ui-panel/40 p-4">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {rows.map(r => (
                    <div key={r.k} className="flex gap-2">
                        <span className="text-ui-muted uppercase tracking-widest text-[10px] w-32 flex-none">{r.k}</span>
                        <span className="font-mono text-white break-all">{r.v}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}



// ===========================================================================
//  TAB: Threat Intel · Dashboard
// ===========================================================================

const MITRE_COLORS = [
    '#00E5A8', '#FF8A3D', '#FF3B6B', '#7C8CFF', '#D65CFF', 
    '#F5C84B', '#FF6B6B', '#4BC0C0', '#9966FF', '#FF9F40',
    '#B0BEC5', '#FFE082', '#81D4FA', '#A5D6A7', '#CE93D8'
];

function getColor(index: number) {
    return MITRE_COLORS[index % MITRE_COLORS.length];
}

function TiAlertsOverTimeChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <EmptyMsg title="No data" body="No timeline data available" />;
    
    // data is an array of { time: string, categories: { [cat: string]: number } }
    // We want to draw a line for each category over time.
    const allCategories = new Set<string>();
    data.forEach(d => Object.keys(d.categories).forEach(c => allCategories.add(c)));
    const categories = Array.from(allCategories);
    
    if (categories.length === 0) return <EmptyMsg title="No data" body="No timeline data available" />;

    const maxVal = Math.max(...data.map(d => Math.max(...Object.values(d.categories as Record<string, number>).concat([0]))));
    
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 relative mt-2 min-h-[200px]">
                <svg viewBox={`0 0 1000 200`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
                    {/* Y Axis Grid Lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                        <g key={pct}>
                            <line x1="0" y1={200 - pct * 200} x2="1000" y2={200 - pct * 200} stroke="#ffffff" strokeOpacity="0.05" />
                            <text x="-5" y={200 - pct * 200 + 4} fill="#8A93A6" fontSize="10" textAnchor="end">{Math.round(maxVal * pct)}</text>
                        </g>
                    ))}
                    {/* Lines */}
                    {categories.map((cat, i) => {
                        const pts = data.map((d, di) => {
                            const val = d.categories[cat] || 0;
                            const x = (di / Math.max(1, data.length - 1)) * 1000;
                            const y = 200 - (val / Math.max(1, maxVal)) * 200;
                            return `${x},${y}`;
                        }).join(' ');
                        return (
                            <polyline key={cat} points={pts} fill="none" stroke={getColor(i)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        );
                    })}
                </svg>
            </div>
            {/* X Axis labels */}
            <div className="flex justify-between text-[9px] text-ui-muted mt-2 ml-6">
                <span>{data[0]?.time}</span>
                <span>{data[Math.floor(data.length / 2)]?.time}</span>
                <span>{data[data.length - 1]?.time}</span>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4 ml-6 justify-end">
                {categories.map((cat, i) => (
                    <div key={cat} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-2 h-2 rounded-full" style={{ background: getColor(i) }} />
                        <span className="text-ui-muted truncate max-w-[120px]">{cat}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TiCategoryDonut({ data, label }: { data: { key: string; count: number }[], label: string }) {
    if (!data || data.length === 0) return <EmptyMsg title="No data" body="No data available" />;
    
    const total = data.reduce((sum, d) => sum + d.count, 0);
    const C = 2 * Math.PI * 15.91;
    let offset = 0;
    
    return (
        <div className="flex items-center gap-6 h-full w-full justify-center lg:justify-start">
            <svg viewBox="0 0 42 42" width="160" height="160" className="drop-shadow-md shrink-0">
                <circle cx="21" cy="21" r="15.91" fill="transparent" stroke="#1F2430" strokeWidth="6" />
                {data.map((d, i) => {
                    const pct = d.count / total;
                    if (pct === 0) return null;
                    const dash = pct * C;
                    const el = (
                        <circle key={d.key} cx="21" cy="21" r="15.91" fill="transparent"
                                stroke={getColor(i)} strokeWidth="6"
                                strokeDasharray={`${dash} ${C - dash}`}
                                strokeDashoffset={-offset} transform="rotate(-90 21 21)" />
                    );
                    offset += dash;
                    return el;
                })}
            </svg>
            <div className="space-y-2 flex-1 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                {data.map((d, i) => (
                    <div key={d.key} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getColor(i) }} />
                        <span className="text-ui-muted truncate flex-1" title={d.key}>{d.key}</span>
                        <span className="text-white tabular-nums font-mono">{fmtNum(d.count)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TiStackedBar({ data, xKey, stackKey }: { data: any[], xKey: string, stackKey: string }) {
    if (!data || data.length === 0) return <EmptyMsg title="No data" body="No data available" />;
    
    // data is array of { xLabel, stacks: { [stackCat]: count } }
    const allStacks = new Set<string>();
    data.forEach(d => Object.keys(d.stacks).forEach(s => allStacks.add(s)));
    const stacks = Array.from(allStacks);
    
    if (stacks.length === 0) return <EmptyMsg title="No data" body="No data available" />;

    const maxTotal = Math.max(...data.map(d => Object.values(d.stacks as Record<string, number>).reduce((a,b)=>a+b,0)));
    
    return (
        <div className="flex h-full w-full gap-4">
            <div className="flex-1 flex flex-col h-[200px]">
                <div className="flex flex-1 items-end gap-2 relative">
                    {/* Y Axis Grid Lines */}
                    {[0.25, 0.5, 0.75, 1].map(pct => (
                        <line key={pct} x1="0" y1={`${100 - pct * 100}%`} x2="100%" y2={`${100 - pct * 100}%`} stroke="#ffffff" strokeOpacity="0.05" className="absolute w-full" />
                    ))}
                    
                    {data.map((d, i) => {
                        const total = Object.values(d.stacks as Record<string, number>).reduce((a,b)=>a+b,0);
                        const hPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                        return (
                            <div key={i} className="flex-1 flex flex-col-reverse justify-start group relative" style={{ height: `${hPct}%` }}>
                                {stacks.map((stack, si) => {
                                    const val = d.stacks[stack] || 0;
                                    if (val === 0) return null;
                                    const spct = (val / total) * 100;
                                    return (
                                        <div key={stack} style={{ height: `${spct}%`, background: getColor(si) }} className="w-full opacity-90 group-hover:opacity-100 transition-opacity" title={`${stack}: ${val}`} />
                                    );
                                })}
                                {/* X Axis label */}
                                <div className="absolute -bottom-6 w-full text-center truncate text-[9px] text-ui-muted" title={d.xLabel}>{d.xLabel}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            {/* Legend */}
            <div className="w-[140px] space-y-1.5 overflow-y-auto pr-2 custom-scrollbar max-h-[200px]">
                {stacks.map((stack, i) => (
                    <div key={stack} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getColor(i) }} />
                        <span className="text-ui-muted truncate" title={stack}>{stack}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TiDashboardTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [alerts, setAlerts] = useState<WazuhAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                // Fetch top 5000 MITRE alerts to build the dashboard visualizations
                const res = await wazuhAPI.siemAlerts({ q: "rule.mitre.id:*", size: 5000, start: range.start });
                if (!cancelled) {
                    setAlerts(res.alerts);
                }
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load MITRE alerts.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start]);

    if (error) return <ErrorBlock msg={error} />;

    // --- Data Aggregations ---
    
    // 1. Alerts evolution over time (Line chart, grouped by Tactic)
    // We'll bucket by hours or days depending on range. For simplicity, just use timestamp strings sliced.
    const timeDataMap: Record<string, Record<string, number>> = {};
    const topTacticsMap: Record<string, number> = {};
    const tacticTechniqueMap: Record<string, Record<string, number>> = {}; // Tactic -> Technique -> Count
    const agentTacticMap: Record<string, Record<string, number>> = {}; // Agent -> Tactic -> Count
    const agentTechniqueMap: Record<string, number> = {}; // Agent+Technique -> Count (for double donut or simple pie)

    alerts.forEach(a => {
        // Safe access
        const tactics = Array.isArray(a.mitre_tactics) ? a.mitre_tactics : a.mitre_tactics ? [a.mitre_tactics] : [];
        const techniques = Array.isArray(a.mitre_ids) ? a.mitre_ids : a.mitre_ids ? [a.mitre_ids] : [];
        const agent = a.agent_name || 'Unknown Agent';
        
        // Time bucket (YYYY-MM-DD HH)
        const ts = a.timestamp ? a.timestamp.substring(0, 13) + 'h' : 'Unknown';
        if (!timeDataMap[ts]) timeDataMap[ts] = {};
        
        tactics.forEach((tac: string) => {
            timeDataMap[ts][tac] = (timeDataMap[ts][tac] || 0) + 1;
            topTacticsMap[tac] = (topTacticsMap[tac] || 0) + 1;
            
            if (!tacticTechniqueMap[tac]) tacticTechniqueMap[tac] = {};
            if (!agentTacticMap[agent]) agentTacticMap[agent] = {};
            
            agentTacticMap[agent][tac] = (agentTacticMap[agent][tac] || 0) + 1;
            
            techniques.forEach((tech: string) => {
                tacticTechniqueMap[tac][tech] = (tacticTechniqueMap[tac][tech] || 0) + 1;
                agentTechniqueMap[`${agent} - ${tech}`] = (agentTechniqueMap[`${agent} - ${tech}`] || 0) + 1;
            });
        });
    });

    // Formatting for charts
    const alertsOverTime = Object.keys(timeDataMap).sort().map(ts => ({
        time: ts,
        categories: timeDataMap[ts]
    }));

    const topTactics = Object.keys(topTacticsMap).map(k => ({ key: k, count: topTacticsMap[k] })).sort((a,b)=>b.count-a.count).slice(0, 10);
    
    const attacksByTechnique = Object.keys(tacticTechniqueMap).map(tac => ({
        xLabel: tac,
        stacks: tacticTechniqueMap[tac]
    })).sort((a,b) => Object.values(b.stacks).reduce((sum, v) => sum+v, 0) - Object.values(a.stacks).reduce((sum, v) => sum+v, 0));

    const topTacticsByAgent = Object.keys(agentTacticMap).map(ag => ({
        xLabel: ag,
        stacks: agentTacticMap[ag]
    })).sort((a,b) => Object.values(b.stacks).reduce((sum, v) => sum+v, 0) - Object.values(a.stacks).reduce((sum, v) => sum+v, 0));

    const mitreTechByAgent = Object.keys(agentTechniqueMap).map(k => ({ key: k, count: agentTechniqueMap[k] })).sort((a,b)=>b.count-a.count).slice(0, 15);

    return (
        <div className="space-y-4">
            {loading && <div className="text-xs text-ui-muted animate-pulse">Loading dashboard...</div>}
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Top Left: Alerts evolution over time */}
                <div className="glass-panel p-5 lg:col-span-2 flex flex-col">
                    <h3 className="font-bold text-white text-sm mb-4">Alerts evolution over time</h3>
                    <div className="flex-1">
                        <TiAlertsOverTimeChart data={alertsOverTime} />
                    </div>
                </div>

                {/* Top Right: Top tactics */}
                <div className="glass-panel p-5 flex flex-col">
                    <h3 className="font-bold text-white text-sm mb-4">Top tactics</h3>
                    <div className="flex-1 flex items-center">
                        <TiCategoryDonut data={topTactics} label="Tactics" />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Bottom Left: Attacks by technique */}
                <div className="glass-panel p-5 flex flex-col h-[280px]">
                    <h3 className="font-bold text-white text-sm mb-4">Attacks by technique</h3>
                    <div className="flex-1 pb-6">
                        <TiStackedBar data={attacksByTechnique} xKey="Tactic" stackKey="Technique" />
                    </div>
                </div>

                {/* Bottom Center: Top tactics by agent */}
                <div className="glass-panel p-5 flex flex-col h-[280px]">
                    <h3 className="font-bold text-white text-sm mb-4">Top tactics by agent</h3>
                    <div className="flex-1 pb-6">
                        <TiStackedBar data={topTacticsByAgent} xKey="Agent" stackKey="Tactic" />
                    </div>
                </div>

                {/* Bottom Right: Mitre techniques by agent */}
                <div className="glass-panel p-5 flex flex-col h-[280px]">
                    <h3 className="font-bold text-white text-sm mb-4">Mitre techniques by agent</h3>
                    <div className="flex-1 flex items-center">
                        <TiCategoryDonut data={mitreTechByAgent} label="Techniques" />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ===========================================================================
//  TAB: Threat Intel · Intelligence
// ===========================================================================

function TiIntelligenceTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [matrix, setMatrix] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const m = await wazuhAPI.mitreMatrix(range.start, 'now', 200);
                if (!cancelled) setMatrix(m);
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load intelligence data.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start]);

    if (error) return <ErrorBlock msg={error} />;

    const techniques = matrix?.techniques || [];

    // Group techniques by tactic to simulate a Threat Group/Intelligence mapping view
    const tacticMap: Record<string, typeof techniques> = {};
    techniques.forEach((t: any) => {
        (t.tactics || []).forEach((tactic: string) => {
            if (!tacticMap[tactic]) tacticMap[tactic] = [];
            tacticMap[tactic].push(t);
        });
    });

    const entries = Object.entries(tacticMap).sort((a, b) => b[1].length - a[1].length);

    return (
        <div className="space-y-6">
            <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="font-bold text-white">Intelligence Mappings</h3>
                        <p className="text-ui-muted text-xs mt-0.5">Techniques clustered by adversary tactic</p>
                    </div>
                    <Globe size={14} className="text-ui-muted" />
                </div>
                {loading ? (
                    <div className="h-20 flex items-center justify-center text-ui-muted text-xs">Loading intelligence...</div>
                ) : entries.length === 0 ? (
                    <EmptyMsg title="No mappings" body="No intelligence mappings available for this window." />
                ) : (
                    <div className="space-y-6">
                        {entries.map(([tactic, techs]) => (
                            <div key={tactic} className="border border-ui-border/50 rounded-xl p-4 bg-ui-surface-2/20">
                                <h4 className="text-brand-primary-bright font-bold mb-3">{tactic} <span className="text-ui-muted text-xs font-normal ml-2">{techs.length} techniques</span></h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {techs.map((t: any) => (
                                        <div key={t.id} className="flex items-center gap-3 bg-ui-bg p-2.5 rounded-lg border border-ui-border/40">
                                            <span className="chip chip-muted min-w-[60px] justify-center">{t.id}</span>
                                            <span className="text-xs text-white truncate flex-1" title={t.name}>{t.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ===========================================================================
//  TAB: Threat Intel · Framework
// ===========================================================================

function TiFrameworkTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [matrix, setMatrix] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const m = await wazuhAPI.mitreMatrix(range.start, 'now', 1000);
                if (!cancelled) setMatrix(m);
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load framework inventory.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start]);

    if (error) return <ErrorBlock msg={error} />;

    const techniques = matrix?.techniques || [];

    return (
        <div className="space-y-6">
            <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="font-bold text-white">MITRE ATT&CK Inventory</h3>
                        <p className="text-ui-muted text-xs mt-0.5">Comprehensive list of detected techniques</p>
                    </div>
                    <Radar size={14} className="text-ui-muted" />
                </div>
                {loading ? (
                    <div className="h-40 flex items-center justify-center text-ui-muted text-xs">Loading framework data...</div>
                ) : techniques.length === 0 ? (
                    <EmptyMsg title="No framework data" body="No MITRE techniques found." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-[10px] uppercase tracking-widest text-ui-muted">
                                <tr>
                                    <th className="py-2 pr-3">Technique ID</th>
                                    <th className="pr-3">Name</th>
                                    <th className="pr-3">Tactics</th>
                                    <th className="text-right">Detections</th>
                                </tr>
                            </thead>
                            <tbody>
                                {techniques.map((t: any) => (
                                    <tr key={t.id} className="border-t border-ui-border/30 hover:bg-white/[0.02]">
                                        <td className="py-2.5 pr-3">
                                            <span className="chip chip-muted font-mono">{t.id}</span>
                                        </td>
                                        <td className="pr-3">
                                            <div className="text-white font-medium max-w-[300px]">{t.name}</div>
                                        </td>
                                        <td className="pr-3">
                                            <div className="flex flex-wrap gap-1">
                                                {(t.tactics || []).map((tac: string) => (
                                                    <span key={tac} className="text-[10px] text-ui-subtle bg-ui-surface-2 px-1.5 py-0.5 rounded">
                                                        {tac}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="text-right tabular-nums text-white">{fmtNum(t.count)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ===========================================================================
//  TAB: Threat Intel · Events
// ===========================================================================

function TiEventsTab({ range }: { range: typeof RANGE_OPTS[0] }) {
    const [alerts, setAlerts] = useState<WazuhAlert[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                // Fetch alerts that MUST have a mitre ID
                const r = await wazuhAPI.siemAlerts({
                    start: range.start, end: 'now', size: 100,
                    q: "rule.mitre.id:*"
                });
                if (!cancelled) { setAlerts(r.alerts); setTotal(r.total); }
            } catch (e: any) {
                if (!cancelled) setError(e?.response?.data?.detail || e?.message || 'Failed to load MITRE events.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [range.start]);

    if (error) return <ErrorBlock msg={error} />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <KpiTile label="MITRE Events" value={fmtNum(total)}
                         hint={`in ${range.label.toLowerCase()}`}
                         color="#00E5A8" loading={loading} />
            </div>

            <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white">MITRE Alert Stream</h3>
                    <ShieldAlert size={14} className="text-ui-muted" />
                </div>
                {loading ? (
                    <div className="h-40 flex items-center justify-center text-ui-muted text-xs">Loading events...</div>
                ) : alerts.length === 0 ? (
                    <EmptyMsg title="No events" body="No alerts with MITRE techniques in this window." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-[10px] uppercase tracking-widest text-ui-muted">
                                <tr>
                                    <th className="py-2 pr-3">Sev</th>
                                    <th className="pr-3">MITRE ID</th>
                                    <th className="pr-3">Tactic</th>
                                    <th className="pr-3">Event Detail</th>
                                    <th className="pr-3">Agent</th>
                                    <th className="text-right">When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {alerts.map(a => {
                                    const expanded = open === a.id;
                                    return (
                                        <React.Fragment key={a.id}>
                                            <tr onClick={() => setOpen(expanded ? null : a.id)} className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer">
                                                <td className="py-2.5 pr-3">
                                                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${SEV_CHIP[a.severity]}`}>
                                                        {a.severity}
                                                    </span>
                                                </td>
                                                <td className="pr-3">
                                                    <div className="flex flex-wrap gap-1 max-w-[120px]">
                                                        {(Array.isArray(a.mitre_ids) ? a.mitre_ids : a.mitre_ids ? [a.mitre_ids] : []).slice(0, 2).map((id: any) => (
                                                            <span key={id} className="chip chip-muted">{id}</span>
                                                        ))}
                                                        {(Array.isArray(a.mitre_ids) ? a.mitre_ids : a.mitre_ids ? [a.mitre_ids] : []).length > 2 && <span className="text-[10px] text-ui-muted">+{(Array.isArray(a.mitre_ids) ? a.mitre_ids : a.mitre_ids ? [a.mitre_ids] : []).length - 2}</span>}
                                                    </div>
                                                </td>
                                                <td className="pr-3">
                                                    <div className="text-[10px] text-ui-subtle max-w-[120px] truncate">
                                                        {(Array.isArray(a.mitre_tactics) ? a.mitre_tactics : a.mitre_tactics ? [a.mitre_tactics] : []).slice(0, 2).join(', ') || '—'}
                                                    </div>
                                                </td>
                                                <td className="pr-3">
                                                    <div className="text-white font-medium truncate max-w-[300px]">{a.description || a.rule_id}</div>
                                                    <div className="text-[10px] text-ui-muted font-mono truncate max-w-[300px]">rule {a.rule_id}</div>
                                                </td>
                                                <td className="pr-3 font-mono text-xs text-ui-muted truncate max-w-[140px]">
                                                    {a.agent_name || a.agent_id || '—'}
                                                </td>
                                                <td className="text-right text-xs text-ui-muted whitespace-nowrap">{timeAgo(a.timestamp)}</td>
                                            </tr>
                                            {expanded && (
                                                <tr key={`${a.id}-x`} className="bg-white/[0.02]">
                                                    <td colSpan={6} className="px-3 pb-4 pt-1">
                                                        <SiemEventDetails a={a} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ===========================================================================
//  Shared presentational helpers
// ===========================================================================

function KpiTile({
    label, value, hint, color, spark, loading, deltaTone,
}: {
    label: string; value: number | string; hint: string; color: string;
    spark?: number[]; loading?: boolean; deltaTone?: 'up' | 'down';
}) {
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-5 lift-card relative overflow-hidden">
            <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-[0.22em]">{label}</p>
            <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black tabular-nums text-white">
                    {loading ? <span className="inline-block w-14 h-6 rounded bg-ui-surface-2 animate-pulse" /> : value}
                </span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${deltaTone === 'down' ? 'text-neon-red' : 'text-neon-green'}`}>
                    {deltaTone === 'down' ? <ArrowDownRight size={12} strokeWidth={3} />
                                          : <ArrowUpRight size={12} strokeWidth={3} />}
                    {hint}
                </span>
            </div>
            <div className="mt-4 h-[34px]">
                {spark && spark.length > 0
                    ? <Sparkline values={spark} color={color} />
                    : <div className="h-full w-full rounded bg-white/[0.03]" />}
            </div>
        </motion.div>
    );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
    if (values.length === 0) return null;
    const max = Math.max(1, ...values);
    const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${28 - (v / max) * 26}`).join(' ');
    return (
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-full">
            <polygon points={`0,28 ${pts} 100,28`} fill={color} opacity="0.12" />
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function StackedBars({ data }: { data: WazuhOverTimePoint[] }) {
    if (!data.length) return <div className="text-xs text-ui-muted py-6">No data.</div>;
    const max = Math.max(1, ...data.map(d => d.count));
    return (
        <div className="flex items-end gap-[2px] h-[180px]">
            {data.map((d, i) => {
                const h = Math.max(1, (d.count / max) * 170);
                const sev = d.by_severity || { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as any;
                const total = Math.max(1, d.count);
                const segs: { color: string; pct: number }[] = [
                    { color: SEV_COLOR.critical, pct: sev.critical / total },
                    { color: SEV_COLOR.high,     pct: sev.high / total },
                    { color: SEV_COLOR.medium,   pct: sev.medium / total },
                    { color: SEV_COLOR.low,      pct: sev.low / total },
                    { color: SEV_COLOR.info,     pct: sev.info / total },
                ];
                return (
                    <div key={i} className="flex-1 flex flex-col-reverse gap-[1px]" style={{ height: h }}
                         title={`${d.time}\n${d.count} events`}>
                        {segs.map((s, k) => s.pct > 0 && (
                            <div key={k} style={{ background: s.color, height: `${s.pct * 100}%`, borderRadius: 1 }} />
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function SeverityDonut({ totals }: { totals: Record<WazuhSeverity, number> }) {
    const order: WazuhSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const total = order.reduce((a, k) => a + totals[k], 0);
    if (total === 0) return <p className="text-center text-ui-muted text-sm py-8">No data.</p>;
    const C = 2 * Math.PI * 15.91;
    let offset = 0;
    return (
        <div className="flex items-center gap-5">
            <svg viewBox="0 0 42 42" width="140" height="140">
                <circle cx="21" cy="21" r="15.91" fill="transparent" stroke="#1F2430" strokeWidth="6" />
                {order.map(k => {
                    const pct = totals[k] / total;
                    if (pct === 0) return null;
                    const dash = pct * C;
                    const el = (
                        <circle key={k} cx="21" cy="21" r="15.91" fill="transparent"
                                stroke={SEV_COLOR[k]} strokeWidth="6"
                                strokeDasharray={`${dash} ${C - dash}`}
                                strokeDashoffset={-offset} transform="rotate(-90 21 21)" />
                    );
                    offset += dash;
                    return el;
                })}
                <text x="21" y="21" textAnchor="middle" fill="#fff" fontSize="6" fontWeight="700">{fmtNum(total)}</text>
                <text x="21" y="26" textAnchor="middle" fill="#8A93A6" fontSize="3">alerts</text>
            </svg>
            <div className="space-y-1.5 text-xs flex-1">
                {order.map(k => (
                    <div key={k} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: SEV_COLOR[k] }} />
                        <span className="text-ui-muted capitalize">{k}</span>
                        <span className="ml-auto text-white tabular-nums">{totals[k]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SeverityMiniBar({ sev }: { sev: Record<WazuhSeverity, number> }) {
    const total = Math.max(1, sev.critical + sev.high + sev.medium + sev.low + sev.info);
    const order: WazuhSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    return (
        <div className="flex h-2 w-28 rounded overflow-hidden bg-white/[0.04]">
            {order.map(k => sev[k] > 0 && (
                <div key={k} style={{ background: SEV_COLOR[k], width: `${(sev[k] / total) * 100}%` }} />
            ))}
        </div>
    );
}

function TopList({ title, items, icon: Icon }: { title: string; items: WazuhTopItem[]; icon: any }) {
    const max = Math.max(1, ...items.map(i => i.count));
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Icon size={13} className="text-ui-muted" />
                <h4 className="text-white text-sm font-semibold">{title}</h4>
            </div>
            {items.length === 0 ? (
                <p className="text-xs text-ui-muted py-2">No data.</p>
            ) : (
                <div className="space-y-1.5">
                    {items.map(it => (
                        <div key={String(it.key)}>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-ui-muted truncate max-w-[72%]">{String(it.key || '—')}</span>
                                <span className="font-mono text-white tabular-nums">{it.count}</span>
                            </div>
                            <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden mt-0.5">
                                <div className="h-full rounded-full bg-brand-primary" style={{ width: `${(it.count / max) * 100}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function EmptyMsg({ title, body }: { title: string; body: string }) {
    return (
        <div className="text-center py-10">
            <p className="text-white font-bold text-sm">{title}</p>
            <p className="text-ui-muted text-xs mt-1">{body}</p>
        </div>
    );
}

function ErrorBlock({ msg }: { msg: string }) {
    return (
        <div className="glass-panel p-6 border-neon-red/30 bg-neon-red/[0.04]">
            <div className="flex items-start gap-3">
                <AlertTriangle className="text-neon-red mt-0.5" size={18} />
                <div className="flex-1 min-w-0">
                    <p className="text-white font-bold">Request failed</p>
                    <p className="text-ui-muted text-sm mt-1 break-words">{msg}</p>
                </div>
            </div>
        </div>
    );
}
