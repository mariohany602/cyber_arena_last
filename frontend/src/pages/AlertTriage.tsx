/**
 * Alert Triage queue — module 2.
 *
 * Lists all triaged alerts (any alert with a triage record). Allows quick
 * re-classification, severity override, assignment, and linking to an
 * incident / case. Untriaged Wazuh alerts are still surfaced on the
 * existing /soc page; this view focuses on the analyst workflow state.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
    ChevronDown, Link2, RefreshCw, Search, ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
    incidentsAPI, rbacAPI, triageAPI,
} from '../utils/api';
import type {
    AlertClassification, AlertTriageState, IncidentSeverity, Incident,
} from '../utils/api';
import {
    SocPage, SocCard, ClassificationChip, SeverityChip,
    PermissionGate, timeAgo,
} from '../components/soc/SocLayout';
import { useAuth } from '../context/AuthContext';

const CLASSIFICATIONS: AlertClassification[] = [
    'true_positive', 'false_positive', 'benign', 'escalated', 'resolved',
];
const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export default function AlertTriage() {
    const { hasPermission } = useAuth();
    const [rows, setRows] = useState<AlertTriageState[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<AlertClassification | ''>('');
    const [q, setQ] = useState('');
    const [users, setUsers] = useState<Array<{ id: number; username: string }>>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const r = await triageAPI.list({ classification: filter || undefined, limit: 500 });
            setRows(r.items);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load triage queue');
        } finally { setLoading(false); }
    };

    useEffect(() => {
        load();
        rbacAPI.users().then(setUsers).catch(() => {});
        incidentsAPI.list({ limit: 200 }).then(r => setIncidents(r.items)).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter]);

    const filtered = useMemo(() => {
        if (!q) return rows;
        const needle = q.toLowerCase();
        return rows.filter(r => r.alert_id.toLowerCase().includes(needle) ||
            (r.notes || '').toLowerCase().includes(needle));
    }, [rows, q]);

    const userMap = useMemo(() => {
        const m: Record<number, string> = {};
        users.forEach(u => { m[u.id] = u.username; });
        return m;
    }, [users]);

    const incidentMap = useMemo(() => {
        const m: Record<number, Incident> = {};
        incidents.forEach(i => { m[i.id] = i; });
        return m;
    }, [incidents]);

    const reclassify = async (alertId: string, c: AlertClassification) => {
        try {
            await triageAPI.update(alertId, { classification: c });
            toast.success('Updated');
            load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const setSeverity = async (alertId: string, sev: IncidentSeverity | '') => {
        try {
            await triageAPI.update(alertId, { severity_override: (sev || null) as any });
            load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const setAssignee = async (alertId: string, id: number | null) => {
        try {
            await triageAPI.update(alertId, { assignee_id: id });
            load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const linkIncident = async (alertId: string, incidentId: number | null) => {
        try {
            await triageAPI.link(alertId, { incident_id: incidentId });
            toast.success(incidentId ? `Linked to incident #${incidentId}` : 'Unlinked');
            load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    return (
        <SocPage
            eyebrow="Alert triage"
            title={<><span className="text-white">Triage </span><span className="text-gradient-brand">Queue</span></>}
            subtitle={`${filtered.length} alert${filtered.length === 1 ? '' : 's'} with triage state`}
            actions={
                <button onClick={load} disabled={loading} className="chip chip-base">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            }
        >
            {/* Quick filter chips */}
            <SocCard padding="p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[200px] relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-subtle" />
                        <input value={q} onChange={e => setQ(e.target.value)}
                            placeholder="Search alert id or note"
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm" />
                    </div>
                    <button onClick={() => setFilter('')}
                        className={`chip ${filter === '' ? 'chip-primary' : 'chip-base'}`}>
                        All
                    </button>
                    {CLASSIFICATIONS.map(c => (
                        <button key={c} onClick={() => setFilter(c)}
                            className={`chip ${filter === c ? 'chip-primary' : 'chip-base'}`}>
                            {c.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </SocCard>

            <SocCard padding="p-0">
                <table className="w-full text-sm">
                    <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                        <tr>
                            <th className="text-left px-4 py-3">Alert ID</th>
                            <th className="text-left px-4 py-3">Classification</th>
                            <th className="text-left px-4 py-3">Severity</th>
                            <th className="text-left px-4 py-3">Assignee</th>
                            <th className="text-left px-4 py-3">Linked</th>
                            <th className="text-left px-4 py-3">Updated</th>
                            <th className="w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 && !loading && (
                            <tr><td colSpan={7} className="text-center text-ui-subtle py-12">
                                <ShieldAlert className="mx-auto mb-2 text-ui-subtle" size={24} />
                                No triage records yet. Triage from the SIEM page to populate this queue.
                            </td></tr>
                        )}
                        {filtered.map(t => (
                            <Fragment key={t.alert_id}>
                                <tr className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer"
                                    onClick={() => setExpanded(e => e === t.alert_id ? null : t.alert_id)}>
                                    <td className="px-4 py-3 font-mono text-[11px] text-ui-muted max-w-[280px] truncate">{t.alert_id}</td>
                                    <td className="px-4 py-3"><ClassificationChip value={t.classification} /></td>
                                    <td className="px-4 py-3">
                                        {t.severity_override ? <SeverityChip severity={t.severity_override} /> : <span className="text-ui-subtle text-xs">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-ui-muted">
                                        {t.assignee_id ? (userMap[t.assignee_id] || `#${t.assignee_id}`) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-ui-muted">
                                        {t.incident_id
                                            ? <span className="chip chip-primary">incident #{t.incident_id}</span>
                                            : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-ui-muted">{timeAgo(t.updated_at)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <ChevronDown
                                            size={14}
                                            className={`text-ui-subtle transition-transform ${expanded === t.alert_id ? 'rotate-180' : ''}`}
                                        />
                                    </td>
                                </tr>
                                {expanded === t.alert_id && (
                                    <tr className="bg-ui-surface/30 border-t border-ui-border/20">
                                        <td colSpan={7} className="px-4 py-4">
                                            <PermissionGate
                                                permission="alert.triage"
                                                fallback={<p className="text-xs text-ui-subtle italic">You don't have permission to triage alerts.</p>}
                                            >
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                    <div>
                                                        <Label>Classify</Label>
                                                        <select value={t.classification || ''}
                                                            onChange={e => reclassify(t.alert_id, e.target.value as AlertClassification)}
                                                            className="soc-input">
                                                            <option value="">— untriaged —</option>
                                                            {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <Label>Severity override</Label>
                                                        <select value={t.severity_override || ''}
                                                            onChange={e => setSeverity(t.alert_id, e.target.value as IncidentSeverity | '')}
                                                            className="soc-input">
                                                            <option value="">— inherit —</option>
                                                            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <Label>Assignee</Label>
                                                        <select value={t.assignee_id ?? ''}
                                                            onChange={e => setAssignee(t.alert_id, e.target.value ? Number(e.target.value) : null)}
                                                            disabled={!hasPermission('alert.assign')}
                                                            className="soc-input">
                                                            <option value="">Unassigned</option>
                                                            {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <Label>Link to incident</Label>
                                                        <select value={t.incident_id ?? ''}
                                                            onChange={e => linkIncident(t.alert_id, e.target.value ? Number(e.target.value) : null)}
                                                            className="soc-input">
                                                            <option value="">— none —</option>
                                                            {incidents.map(i => (
                                                                <option key={i.id} value={i.id}>#{i.id} · {i.title}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                {t.notes && (
                                                    <div className="mt-3 text-xs text-ui-muted">
                                                        <span className="font-mono uppercase tracking-wider mr-2 text-ui-subtle">Notes:</span>
                                                        <span className="whitespace-pre-wrap">{t.notes}</span>
                                                    </div>
                                                )}
                                                {t.incident_id && incidentMap[t.incident_id] && (
                                                    <div className="mt-2 text-xs text-ui-muted flex items-center gap-1.5">
                                                        <Link2 size={12} />
                                                        Linked to <a href={`/incidents/${t.incident_id}`}
                                                            className="text-brand-primary-bright hover:underline">
                                                            #{t.incident_id} {incidentMap[t.incident_id].title}
                                                        </a>
                                                    </div>
                                                )}
                                            </PermissionGate>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </SocCard>
        </SocPage>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">{children}</div>
    );
}
