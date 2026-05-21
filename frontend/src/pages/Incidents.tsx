/**
 * Incidents — list view for module 1 (Incident Management).
 * Includes filter bar, summary stats, and a "New Incident" modal.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle, ChevronRight, Plus, RefreshCw, Search, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
    incidentsAPI,
} from '../utils/api';
import type {
    Incident, IncidentSeverity, IncidentStatus, IncidentStats,
} from '../utils/api';
import {
    SocPage, SocCard, StatCard,
    SeverityChip, IncidentStatusChip,
    PermissionGate, timeAgo,
} from '../components/soc/SocLayout';

const STATUSES: IncidentStatus[] = ['open', 'investigating', 'escalated', 'resolved', 'closed'];
const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export default function Incidents() {
    const navigate = useNavigate();
    const [rows, setRows] = useState<Incident[]>([]);
    const [stats, setStats] = useState<IncidentStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<{ status?: IncidentStatus; severity?: IncidentSeverity; q: string }>({ q: '' });
    const [showCreate, setShowCreate] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [list, summary] = await Promise.all([
                incidentsAPI.list({
                    status: filters.status,
                    severity: filters.severity,
                    q: filters.q || undefined,
                    limit: 200,
                }),
                incidentsAPI.summary(),
            ]);
            setRows(list.items);
            setStats(summary);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load incidents');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters.status, filters.severity]);

    return (
        <SocPage
            eyebrow="Incident management"
            title={<><span className="text-white">Incident </span><span className="text-gradient-brand">Queue</span></>}
            subtitle={stats ? <>{stats.total} total · <span className="text-neon-yellow">{stats.open}</span> open / investigating / escalated</> : 'loading…'}
            actions={
                <>
                    <button onClick={load} disabled={loading}
                        className="chip chip-base hover:bg-white/10">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="incident.create">
                        <button onClick={() => setShowCreate(true)}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                            <Plus size={14} /> New incident
                        </button>
                    </PermissionGate>
                </>
            }
        >
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Total" value={stats?.total ?? '—'} />
                <StatCard label="Open" value={stats?.by_status.open ?? 0} tone="warn" />
                <StatCard label="Investigating" value={stats?.by_status.investigating ?? 0} tone="info" />
                <StatCard label="Escalated" value={stats?.by_status.escalated ?? 0} tone="danger" />
                <StatCard label="Resolved" value={stats?.by_status.resolved ?? 0} tone="positive" />
            </div>

            {/* Filters */}
            <SocCard padding="p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px] relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-subtle" />
                        <input
                            value={filters.q}
                            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && load()}
                            placeholder="Search title / description"
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm focus:border-brand-primary outline-none"
                        />
                    </div>
                    <select
                        value={filters.status || ''}
                        onChange={e => setFilters(f => ({ ...f, status: (e.target.value || undefined) as any }))}
                        className="px-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm"
                    >
                        <option value="">All statuses</option>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select
                        value={filters.severity || ''}
                        onChange={e => setFilters(f => ({ ...f, severity: (e.target.value || undefined) as any }))}
                        className="px-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm"
                    >
                        <option value="">All severities</option>
                        {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            </SocCard>

            {/* Table */}
            <SocCard padding="p-0">
                <table className="w-full text-sm">
                    <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                        <tr>
                            <th className="text-left px-4 py-3">ID</th>
                            <th className="text-left px-4 py-3">Title</th>
                            <th className="text-left px-4 py-3">Severity</th>
                            <th className="text-left px-4 py-3">Status</th>
                            <th className="text-left px-4 py-3">Category</th>
                            <th className="text-left px-4 py-3">Detected</th>
                            <th className="text-right px-4 py-3">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && !loading && (
                            <tr><td colSpan={7} className="text-center text-ui-subtle py-12">
                                <AlertTriangle className="mx-auto mb-2 text-ui-subtle" size={24} />
                                No incidents yet. Click "New incident" to open the first one.
                            </td></tr>
                        )}
                        {rows.map(r => (
                            <tr key={r.id}
                                className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer"
                                onClick={() => navigate(`/incidents/${r.id}`)}
                            >
                                <td className="px-4 py-3 font-mono text-xs text-ui-muted">#{r.id}</td>
                                <td className="px-4 py-3 max-w-xs">
                                    <div className="text-white font-medium truncate">{r.title}</div>
                                    {r.description && <div className="text-xs text-ui-subtle truncate">{r.description}</div>}
                                </td>
                                <td className="px-4 py-3"><SeverityChip severity={r.severity} /></td>
                                <td className="px-4 py-3"><IncidentStatusChip status={r.status} /></td>
                                <td className="px-4 py-3 text-xs text-ui-muted">{r.category || '—'}</td>
                                <td className="px-4 py-3 text-xs text-ui-muted">{timeAgo(r.detected_at)}</td>
                                <td className="px-4 py-3 text-right">
                                    <ChevronRight size={16} className="text-ui-subtle inline" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </SocCard>

            {showCreate && (
                <CreateIncidentModal
                    onClose={() => setShowCreate(false)}
                    onCreated={(inc) => {
                        setShowCreate(false);
                        navigate(`/incidents/${inc.id}`);
                    }}
                />
            )}
        </SocPage>
    );
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------
function CreateIncidentModal({
    onClose, onCreated,
}: { onClose: () => void; onCreated: (i: Incident) => void }) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [severity, setSeverity] = useState<IncidentSeverity>('medium');
    const [category, setCategory] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!title.trim()) { toast.error('Title is required'); return; }
        setBusy(true);
        try {
            const inc = await incidentsAPI.create({
                title: title.trim(),
                description: description.trim() || undefined,
                severity,
                category: category.trim() || undefined,
            } as any);
            toast.success('Incident created');
            onCreated(inc);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to create incident');
        } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={onClose}>
            <div className="glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full max-w-lg space-y-4"
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">New incident</h2>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                <div className="space-y-3">
                    <Field label="Title">
                        <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
                            className="soc-input" placeholder="Suspicious lateral movement on host-42" />
                    </Field>
                    <Field label="Description">
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
                            className="soc-input" placeholder="What was observed, where, when…" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Severity">
                            <select value={severity} onChange={e => setSeverity(e.target.value as IncidentSeverity)}
                                className="soc-input">
                                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </Field>
                        <Field label="Category">
                            <input value={category} onChange={e => setCategory(e.target.value)}
                                className="soc-input" placeholder="malware / phishing / data_exfil" />
                        </Field>
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="chip chip-base">Cancel</button>
                    <button onClick={submit} disabled={busy}
                        className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                        {busy ? 'Creating…' : 'Create incident'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">{label}</span>
            {children}
        </label>
    );
}
