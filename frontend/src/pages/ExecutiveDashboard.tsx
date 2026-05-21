/**
 * Executive Dashboard — module 9 of the SOC platform extension.
 *
 * High-level KPIs and trends for SOC leadership: MTTD/MTTR, detection &
 * resolution trends, severity heat over time, top risky assets, analyst
 * performance, threat landscape (categories + MITRE).
 *
 * Charts are intentionally CSS/SVG-only (no chart libraries) to keep the
 * bundle small and avoid adding new deps.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity, AlertTriangle, BarChart3, Briefcase, Crown, Gauge, RefreshCw,
    Target, TrendingUp, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { execDashboardAPI } from '../utils/api';
import type {
    ExecAnalystRow, ExecSummary, ExecThreatLandscape, ExecTopAsset, ExecTrends,
} from '../utils/api';
import {
    SocPage, SocCard, StatCard,
} from '../components/soc/SocLayout';

const RANGES = [
    { label: 'Last 7d',  value: 7 },
    { label: 'Last 30d', value: 30 },
    { label: 'Last 90d', value: 90 },
    { label: 'Last 180d', value: 180 },
];

export default function ExecutiveDashboard() {
    const navigate = useNavigate();
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState<ExecSummary | null>(null);
    const [trends, setTrends] = useState<ExecTrends | null>(null);
    const [topAssets, setTopAssets] = useState<ExecTopAsset[]>([]);
    const [analysts, setAnalysts] = useState<ExecAnalystRow[]>([]);
    const [landscape, setLandscape] = useState<ExecThreatLandscape | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const [s, t, ta, a, l] = await Promise.all([
                execDashboardAPI.summary(days),
                execDashboardAPI.trends(days),
                execDashboardAPI.topAssets(10),
                execDashboardAPI.analystPerformance(days),
                execDashboardAPI.threatLandscape(days),
            ]);
            setSummary(s); setTrends(t); setTopAssets(ta); setAnalysts(a); setLandscape(l);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load executive dashboard');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

    const precisionPct = useMemo(() => {
        const p = summary?.triage?.precision;
        return p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`;
    }, [summary]);

    return (
        <SocPage
            eyebrow="Executive analytics"
            title={<><span className="text-white">Executive </span><span className="text-gradient-brand">Dashboard</span></>}
            subtitle="MTTD · MTTR · trends · top risks · analyst KPIs"
            actions={
                <>
                    <select value={days} onChange={e => setDays(Number(e.target.value))}
                        className="px-3 py-1.5 rounded-lg bg-ui-surface border border-ui-border/40 text-xs">
                        {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                </>
            }
        >
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <StatCard label="Incidents"      value={summary?.incidents.total ?? 0} tone="info" />
                <StatCard label="Open now"       value={summary?.incidents.open_now ?? 0} tone="warn" />
                <StatCard label="Resolved"       value={summary?.incidents.resolved ?? 0} tone="positive" />
                <StatCard label="MTTD"           value={summary?.mttd_h ?? '—'} hint="detection → ack" />
                <StatCard label="MTTR"           value={summary?.mttr_h ?? '—'} hint="detection → resolve" />
                <StatCard label="Triage precision" value={precisionPct} hint="TP / (TP + FP)" tone="info" />
            </div>

            {/* Trends */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <SocCard>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <TrendingUp size={14} /> Detections vs resolutions
                    </h3>
                    <TwoSeriesChart
                        a={trends?.detections || []}
                        b={trends?.resolutions || []}
                        colorA="#FF3B6B" colorB="#00E5A8"
                        labelA="Detected" labelB="Resolved"
                    />
                </SocCard>

                <SocCard>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <BarChart3 size={14} /> Severity by day
                    </h3>
                    <SeverityHeatmap data={trends?.severity_by_day || []} />
                </SocCard>

                <SocCard>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Briefcase size={14} /> Cases opened
                    </h3>
                    <SimpleBar data={trends?.cases || []} color="#7C8CFF" />
                </SocCard>

                <SocCard>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity size={14} /> SOAR actions
                    </h3>
                    <SimpleBar data={trends?.soar || []} color="#5BC0EB" />
                </SocCard>
            </div>

            {/* Top assets + analysts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <SocCard padding="p-0">
                    <div className="px-5 py-3 border-b border-ui-border/30 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <AlertTriangle size={14} /> Top risky assets
                        </h3>
                        <button onClick={() => navigate('/assets')} className="text-[10px] text-ui-subtle hover:text-white">all assets →</button>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                            <tr>
                                <th className="text-left px-4 py-2">Host</th>
                                <th className="text-left px-4 py-2">Risk</th>
                                <th className="text-left px-4 py-2">Vulns</th>
                                <th className="text-left px-4 py-2">Agent</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topAssets.length === 0 && <tr><td colSpan={4} className="text-center text-ui-subtle py-6">No assets yet.</td></tr>}
                            {topAssets.map(a => (
                                <tr key={a.id}
                                    className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer"
                                    onClick={() => navigate(`/assets/${a.id}`)}>
                                    <td className="px-4 py-2">
                                        <div className="text-white">{a.hostname}</div>
                                        <div className="text-[10px] text-ui-subtle font-mono">{a.ip || '—'}</div>
                                    </td>
                                    <td className="px-4 py-2 font-bold text-neon-red">{a.risk_score}</td>
                                    <td className="px-4 py-2 text-neon-yellow">{a.vuln_count}</td>
                                    <td className="px-4 py-2 text-xs text-ui-muted">{a.agent_status || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </SocCard>

                <SocCard padding="p-0">
                    <div className="px-5 py-3 border-b border-ui-border/30">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Users size={14} /> Analyst performance
                        </h3>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                            <tr>
                                <th className="text-left px-4 py-2">Analyst</th>
                                <th className="text-left px-4 py-2">Assigned</th>
                                <th className="text-left px-4 py-2">Resolved</th>
                                <th className="text-left px-4 py-2">Avg TTR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analysts.length === 0 && <tr><td colSpan={4} className="text-center text-ui-subtle py-6">No assignments yet.</td></tr>}
                            {analysts.map(a => (
                                <tr key={a.user_id} className="border-t border-ui-border/30">
                                    <td className="px-4 py-2 flex items-center gap-1.5">
                                        {a.resolved === Math.max(...analysts.map(x => x.resolved)) && a.resolved > 0 && (
                                            <Crown size={12} className="text-neon-yellow" />
                                        )}
                                        <span className="text-white">{a.username}</span>
                                    </td>
                                    <td className="px-4 py-2 text-ui-muted">{a.assigned}</td>
                                    <td className="px-4 py-2 text-neon-green font-bold">{a.resolved}</td>
                                    <td className="px-4 py-2 font-mono text-xs text-ui-muted">{a.avg_ttr_h}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </SocCard>
            </div>

            {/* Threat landscape */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <SocCard>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Gauge size={14} /> Top incident categories
                    </h3>
                    <BarList data={landscape?.categories || []} color="#FF8A3D" />
                </SocCard>
                <SocCard>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Target size={14} /> MITRE techniques in incidents
                    </h3>
                    <BarList data={landscape?.mitre_techniques || []} color="#E879F9" />
                </SocCard>
            </div>
        </SocPage>
    );
}

// ---------------------------------------------------------------------------
// Tiny charts — no external libs
// ---------------------------------------------------------------------------

function SimpleBar({ data, color }: { data: Array<{ date: string; count: number }>; color: string }) {
    const max = Math.max(1, ...data.map(d => d.count));
    if (data.length === 0) return <p className="text-xs text-ui-subtle italic">No data.</p>;
    return (
        <div className="h-32 flex items-end gap-[2px]">
            {data.map(d => (
                <div key={d.date} className="flex-1 group relative" title={`${d.date}: ${d.count}`}>
                    <div className="w-full rounded-t transition-opacity hover:opacity-100"
                        style={{
                            height: `${(d.count / max) * 100}%`,
                            background: color,
                            minHeight: d.count > 0 ? 2 : 0,
                        }} />
                </div>
            ))}
        </div>
    );
}

function TwoSeriesChart({
    a, b, colorA, colorB, labelA, labelB,
}: {
    a: Array<{ date: string; count: number }>;
    b: Array<{ date: string; count: number }>;
    colorA: string; colorB: string;
    labelA: string; labelB: string;
}) {
    const n = Math.max(a.length, b.length);
    if (n === 0) return <p className="text-xs text-ui-subtle italic">No data.</p>;
    const max = Math.max(1, ...a.map(d => d.count), ...b.map(d => d.count));
    return (
        <div>
            <div className="flex gap-4 text-[10px] mb-2">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: colorA }} /> {labelA}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: colorB }} /> {labelB}</span>
            </div>
            <div className="h-32 flex items-end gap-[2px]">
                {Array.from({ length: n }).map((_, i) => {
                    const da = a[i]?.count || 0;
                    const db = b[i]?.count || 0;
                    return (
                        <div key={i} className="flex-1 flex flex-col gap-[1px] items-stretch"
                            title={`${a[i]?.date || b[i]?.date || ''}: ${labelA}=${da}, ${labelB}=${db}`}>
                            <div style={{ height: `${(da / max) * 50}%`, background: colorA, minHeight: da > 0 ? 1 : 0 }} className="rounded-t" />
                            <div style={{ height: `${(db / max) * 50}%`, background: colorB, minHeight: db > 0 ? 1 : 0 }} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SeverityHeatmap({ data }: { data: Array<{ date: string; critical: number; high: number; medium: number; low: number; info: number }> }) {
    if (data.length === 0) return <p className="text-xs text-ui-subtle italic">No data.</p>;
    const rows: Array<{ key: 'critical' | 'high' | 'medium' | 'low'; color: string }> = [
        { key: 'critical', color: 'rgba(255,59,107,' },
        { key: 'high',     color: 'rgba(232,121,249,' },
        { key: 'medium',   color: 'rgba(245,200,75,' },
        { key: 'low',      color: 'rgba(91,192,235,' },
    ];
    const max = Math.max(1, ...data.flatMap(d => rows.map(r => d[r.key] || 0)));
    return (
        <div className="space-y-1">
            {rows.map(r => (
                <div key={r.key} className="flex items-center gap-2">
                    <div className="w-12 text-[10px] font-mono uppercase tracking-wider text-ui-subtle text-right">{r.key}</div>
                    <div className="flex-1 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
                        {data.map(d => {
                            const v = d[r.key] || 0;
                            const a = v ? Math.max(0.12, v / max) : 0;
                            return (
                                <div key={d.date} className="h-4 rounded-sm" title={`${d.date} · ${r.key} · ${v}`}
                                    style={{ background: a ? `${r.color}${a})` : 'rgba(255,255,255,0.03)' }} />
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function BarList({ data, color }: { data: Array<{ key: string; count: number }>; color: string }) {
    if (data.length === 0) return <p className="text-xs text-ui-subtle italic">No data.</p>;
    const max = Math.max(1, ...data.map(d => d.count));
    return (
        <ol className="space-y-1.5">
            {data.map(d => (
                <li key={d.key} className="flex items-center gap-2 text-xs">
                    <div className="w-28 truncate text-ui-muted">{d.key}</div>
                    <div className="flex-1 h-2 rounded bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${(d.count / max) * 100}%`, background: color }} />
                    </div>
                    <div className="w-10 text-right font-bold text-white">{d.count}</div>
                </li>
            ))}
        </ol>
    );
}
