/**
 * TheHive — read-only mirror of an external TheHive 4.x instance.
 *
 * The cyber-arena backend pulls cases / alerts / observables through
 * `/api/soc/thehive/*`; the frontend never speaks to TheHive directly.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Briefcase, ShieldAlert, RefreshCw, Search, ExternalLink, AlertTriangle,
    CheckCircle2, XCircle, Hash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { theHiveAPI } from '../utils/api';
import type {
    TheHiveAlert, TheHiveCase, TheHiveConfig, TheHiveHealth, TheHiveSummary,
    TheHiveSeverity,
} from '../utils/api';
import {
    SocPage, SocCard, StatCard, Chip, SeverityChip, TlpChip, fmtDateTime,
} from '../components/soc/SocLayout';

type TabId = 'cases' | 'alerts';

const TABS: { id: TabId; label: string; icon: any; desc: string }[] = [
    { id: 'cases',  label: 'Cases',  icon: Briefcase,   desc: 'Investigations from TheHive' },
    { id: 'alerts', label: 'Alerts', icon: ShieldAlert, desc: 'Pending alerts awaiting triage' },
];

function fmtThEpoch(v: number | null | undefined): string {
    if (!v) return '—';
    // TheHive returns epoch ms
    return fmtDateTime(new Date(v).toISOString());
}

function StatusBanner({ config, health }: {
    config: TheHiveConfig | null;
    health: TheHiveHealth | null;
}) {
    if (!config) return null;
    const ok = !!health?.ok;
    return (
        <SocCard className="mb-4">
            <div className="flex items-center gap-3 flex-wrap">
                {ok ? (
                    <CheckCircle2 className="text-neon-green" size={18} />
                ) : (
                    <XCircle className="text-neon-red" size={18} />
                )}
                <div className="text-sm">
                    <div className="text-white font-bold">
                        TheHive {ok ? 'reachable' : 'unreachable'}
                    </div>
                    <div className="text-ui-muted text-xs font-mono">
                        {config.url || '(THEHIVE_URL unset)'}
                        {config.org ? ` · org=${config.org}` : ''}
                        {config.verify_ssl ? '' : ' · TLS verify off'}
                    </div>
                </div>
                {config.url && (
                    <a href={config.url} target="_blank" rel="noreferrer"
                       className="ml-auto chip chip-base">
                        <ExternalLink size={12} /> Open TheHive UI
                    </a>
                )}
            </div>
            {!config.configured && (
                <div className="mt-3 flex items-start gap-2 text-xs text-neon-yellow">
                    <AlertTriangle size={14} className="mt-0.5" />
                    <span>
                        Set <code className="font-mono">THEHIVE_URL</code> and
                        {' '}<code className="font-mono">THEHIVE_API_KEY</code> on the
                        backend, then restart.
                    </span>
                </div>
            )}
            {!ok && health?.error && (
                <div className="mt-2 text-xs text-neon-red font-mono break-all">
                    {health.error}
                </div>
            )}
        </SocCard>
    );
}

function CasesTab({ refreshKey }: { refreshKey: number }) {
    const [items, setItems] = useState<TheHiveCase[]>([]);
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState('');
    const [severity, setSeverity] = useState<number | ''>('');

    const load = async () => {
        setLoading(true);
        try {
            const data = await theHiveAPI.listCases({
                range: '0-100',
                q: q || undefined,
                severity: severity === '' ? undefined : Number(severity),
            });
            setItems(data.items);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load TheHive cases');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [refreshKey, severity]);

    return (
        <SocCard padding="p-0" className="overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-ui-border/30">
                <div className="relative flex-1 max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && load()}
                        placeholder="Filter title…"
                        className="w-full pl-9 pr-3 py-1.5 rounded-md bg-ui-bg-elevated border border-ui-border/40 text-sm"
                    />
                </div>
                <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="bg-ui-bg-elevated border border-ui-border/40 rounded-md px-2 py-1.5 text-sm"
                >
                    <option value="">All severities</option>
                    <option value={4}>Critical</option>
                    <option value={3}>High</option>
                    <option value={2}>Medium</option>
                    <option value={1}>Low</option>
                </select>
                <button onClick={load} disabled={loading} className="chip chip-base">
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-ui-subtle bg-white/2">
                        <tr>
                            <th className="text-left px-3 py-2">#</th>
                            <th className="text-left px-3 py-2">Title</th>
                            <th className="text-left px-3 py-2">Severity</th>
                            <th className="text-left px-3 py-2">TLP</th>
                            <th className="text-left px-3 py-2">Status</th>
                            <th className="text-left px-3 py-2">Owner</th>
                            <th className="text-left px-3 py-2">Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((c) => (
                            <tr key={c.id} className="border-t border-ui-border/20 hover:bg-white/2">
                                <td className="px-3 py-2 font-mono text-ui-muted">#{c.case_id ?? '—'}</td>
                                <td className="px-3 py-2 text-white">
                                    <div className="font-bold">{c.title}</div>
                                    {c.tags?.length ? (
                                        <div className="flex gap-1 flex-wrap mt-1">
                                            {c.tags.slice(0, 4).map((t) => (
                                                <Chip key={t} className="bg-white/5 text-ui-muted border-ui-border/40">
                                                    <Hash size={9} />{t}
                                                </Chip>
                                            ))}
                                        </div>
                                    ) : null}
                                </td>
                                <td className="px-3 py-2"><SeverityChip severity={c.severity} /></td>
                                <td className="px-3 py-2"><TlpChip tlp={c.tlp} /></td>
                                <td className="px-3 py-2 text-ui-muted">{c.status}</td>
                                <td className="px-3 py-2 text-ui-muted">{c.owner || '—'}</td>
                                <td className="px-3 py-2 text-ui-muted text-xs">{fmtThEpoch(c.created_at)}</td>
                            </tr>
                        ))}
                        {!items.length && !loading && (
                            <tr><td colSpan={7} className="px-3 py-8 text-center text-ui-muted">
                                No cases returned by TheHive.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </SocCard>
    );
}

function AlertsTab({ refreshKey }: { refreshKey: number }) {
    const [items, setItems] = useState<TheHiveAlert[]>([]);
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const data = await theHiveAPI.listAlerts({ range: '0-100', q: q || undefined });
            setItems(data.items);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load TheHive alerts');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [refreshKey]);

    return (
        <SocCard padding="p-0" className="overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-ui-border/30">
                <div className="relative flex-1 max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && load()}
                        placeholder="Filter title…"
                        className="w-full pl-9 pr-3 py-1.5 rounded-md bg-ui-bg-elevated border border-ui-border/40 text-sm"
                    />
                </div>
                <button onClick={load} disabled={loading} className="chip chip-base">
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-ui-subtle bg-white/2">
                        <tr>
                            <th className="text-left px-3 py-2">Title</th>
                            <th className="text-left px-3 py-2">Type</th>
                            <th className="text-left px-3 py-2">Source</th>
                            <th className="text-left px-3 py-2">Severity</th>
                            <th className="text-left px-3 py-2">TLP</th>
                            <th className="text-left px-3 py-2">Status</th>
                            <th className="text-left px-3 py-2">Obs</th>
                            <th className="text-left px-3 py-2">Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((a) => (
                            <tr key={a.id} className="border-t border-ui-border/20 hover:bg-white/2">
                                <td className="px-3 py-2 text-white font-bold">{a.title}</td>
                                <td className="px-3 py-2 text-ui-muted">{a.type || '—'}</td>
                                <td className="px-3 py-2 text-ui-muted text-xs font-mono">
                                    {a.source}{a.source_ref ? `:${a.source_ref}` : ''}
                                </td>
                                <td className="px-3 py-2"><SeverityChip severity={a.severity} /></td>
                                <td className="px-3 py-2"><TlpChip tlp={a.tlp} /></td>
                                <td className="px-3 py-2 text-ui-muted">{a.status}</td>
                                <td className="px-3 py-2 text-ui-muted">{a.artifact_count ?? '—'}</td>
                                <td className="px-3 py-2 text-ui-muted text-xs">{fmtThEpoch(a.created_at)}</td>
                            </tr>
                        ))}
                        {!items.length && !loading && (
                            <tr><td colSpan={8} className="px-3 py-8 text-center text-ui-muted">
                                No alerts returned by TheHive.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </SocCard>
    );
}

export default function TheHive() {
    const [tab, setTab] = useState<TabId>('cases');
    const [refreshKey, setRefreshKey] = useState(0);
    const [config, setConfig] = useState<TheHiveConfig | null>(null);
    const [health, setHealth] = useState<TheHiveHealth | null>(null);
    const [summary, setSummary] = useState<TheHiveSummary | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        setLoading(true);
        try {
            const [c, h] = await Promise.all([theHiveAPI.config(), theHiveAPI.health()]);
            setConfig(c);
            setHealth(h);
            if (h.ok) {
                try { setSummary(await theHiveAPI.summary()); } catch { /* ignore */ }
            }
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'TheHive probe failed');
        } finally { setLoading(false); }
        setRefreshKey((k) => k + 1);
    };

    useEffect(() => { refresh(); }, []);

    const sev = summary?.cases.by_severity;
    const totalCritical = sev ? (sev.critical || 0) + (sev.high || 0) : 0;
    const sevSubtitle = useMemo(() => {
        if (!sev) return undefined;
        const parts: string[] = [];
        (Object.keys(sev) as TheHiveSeverity[]).forEach((k) => {
            if (sev[k]) parts.push(`${sev[k]} ${k}`);
        });
        return parts.join(' · ');
    }, [sev]);

    return (
        <SocPage
            eyebrow="Cross-platform integration"
            title={<><span className="text-white">The</span><span className="text-gradient-brand">Hive</span></>}
            subtitle="Read-only mirror of the remote TheHive 4.x instance"
            actions={
                <button onClick={refresh} disabled={loading} className="chip chip-base">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            }
        >
            <StatusBanner config={config} health={health} />

            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <StatCard label="Cases" value={summary.cases.total} />
                    <StatCard label="High / Critical" value={totalCritical}
                        tone={totalCritical ? 'danger' : 'default'} hint={sevSubtitle} />
                    <StatCard label="Alerts" value={summary.alerts.total} />
                    <StatCard label="New alerts" value={summary.alerts.by_status?.New || 0} tone="warn" />
                </div>
            )}

            <div className="flex gap-2 mb-4 flex-wrap">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`chip chip-base ${active
                                ? 'bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40'
                                : ''}`}>
                            <Icon size={14} /> {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'cases'  && <CasesTab refreshKey={refreshKey} />}
            {tab === 'alerts' && <AlertsTab refreshKey={refreshKey} />}
        </SocPage>
    );
}
