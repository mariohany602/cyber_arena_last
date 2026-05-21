/**
 * Cases list — module 8 (Case Management).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, ChevronRight, Plus, RefreshCw, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { casesAPI } from '../utils/api';
import type {
    CaseRow, CaseStatus, IncidentSeverity, Tlp,
} from '../utils/api';
import {
    SocPage, SocCard, SeverityChip, CaseStatusChip, TlpChip,
    PermissionGate, timeAgo,
} from '../components/soc/SocLayout';

const STATUSES: CaseStatus[] = ['open', 'in_progress', 'closed'];
const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const TLPS: Tlp[] = ['white', 'green', 'amber', 'red'];

export default function Cases() {
    const navigate = useNavigate();
    const [rows, setRows] = useState<CaseRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<{ status?: CaseStatus; severity?: IncidentSeverity; q: string }>({ q: '' });
    const [showCreate, setShowCreate] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const list = await casesAPI.list({
                status: filters.status, severity: filters.severity,
                q: filters.q || undefined, limit: 200,
            });
            setRows(list.items);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load cases');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [filters.status, filters.severity]);

    return (
        <SocPage
            eyebrow="Case management"
            title={<><span className="text-white">Case </span><span className="text-gradient-brand">Catalogue</span></>}
            subtitle={`${rows.length} case${rows.length === 1 ? '' : 's'} listed`}
            actions={
                <>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="case.create">
                        <button onClick={() => setShowCreate(true)}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                            <Plus size={14} /> New case
                        </button>
                    </PermissionGate>
                </>
            }
        >
            <SocCard padding="p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px] relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-subtle" />
                        <input
                            value={filters.q}
                            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && load()}
                            placeholder="Search title / summary"
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm"
                        />
                    </div>
                    <select value={filters.status || ''} onChange={e => setFilters(f => ({ ...f, status: (e.target.value || undefined) as any }))}
                        className="px-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm">
                        <option value="">All statuses</option>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={filters.severity || ''} onChange={e => setFilters(f => ({ ...f, severity: (e.target.value || undefined) as any }))}
                        className="px-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm">
                        <option value="">All severities</option>
                        {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            </SocCard>

            <SocCard padding="p-0">
                <table className="w-full text-sm">
                    <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                        <tr>
                            <th className="text-left px-4 py-3">ID</th>
                            <th className="text-left px-4 py-3">Title</th>
                            <th className="text-left px-4 py-3">Severity</th>
                            <th className="text-left px-4 py-3">Status</th>
                            <th className="text-left px-4 py-3">TLP</th>
                            <th className="text-left px-4 py-3">Updated</th>
                            <th className="text-right px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && !loading && (
                            <tr><td colSpan={7} className="text-center text-ui-subtle py-12">
                                <Briefcase className="mx-auto mb-2 text-ui-subtle" size={24} />
                                No cases yet.
                            </td></tr>
                        )}
                        {rows.map(c => (
                            <tr key={c.id}
                                className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer"
                                onClick={() => navigate(`/cases/${c.id}`)}
                            >
                                <td className="px-4 py-3 font-mono text-xs text-ui-muted">#{c.id}</td>
                                <td className="px-4 py-3 max-w-xs">
                                    <div className="text-white font-medium truncate">{c.title}</div>
                                    {c.summary && <div className="text-xs text-ui-subtle truncate">{c.summary}</div>}
                                </td>
                                <td className="px-4 py-3"><SeverityChip severity={c.severity} /></td>
                                <td className="px-4 py-3"><CaseStatusChip status={c.status} /></td>
                                <td className="px-4 py-3"><TlpChip tlp={c.tlp} /></td>
                                <td className="px-4 py-3 text-xs text-ui-muted">{timeAgo(c.updated_at)}</td>
                                <td className="px-4 py-3 text-right">
                                    <ChevronRight size={16} className="text-ui-subtle inline" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </SocCard>

            {showCreate && (
                <CreateCaseModal
                    onClose={() => setShowCreate(false)}
                    onCreated={(c) => { setShowCreate(false); navigate(`/cases/${c.id}`); }}
                />
            )}
        </SocPage>
    );
}

function CreateCaseModal({
    onClose, onCreated,
}: { onClose: () => void; onCreated: (c: CaseRow) => void }) {
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [severity, setSeverity] = useState<IncidentSeverity>('medium');
    const [tlp, setTlp] = useState<Tlp>('amber');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!title.trim()) { toast.error('Title required'); return; }
        setBusy(true);
        try {
            const c = await casesAPI.create({
                title: title.trim(),
                summary: summary.trim() || undefined,
                severity, tlp,
            } as any);
            toast.success('Case created');
            onCreated(c);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to create case');
        } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full max-w-lg space-y-4"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">New case</h2>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Title</span>
                    <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className="soc-input"
                        placeholder="Q3 phishing campaign — Operation Drift" />
                </label>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Summary</span>
                    <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4} className="soc-input" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Severity</span>
                        <select value={severity} onChange={e => setSeverity(e.target.value as IncidentSeverity)} className="soc-input">
                            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">TLP</span>
                        <select value={tlp} onChange={e => setTlp(e.target.value as Tlp)} className="soc-input">
                            {TLPS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="chip chip-base">Cancel</button>
                    <button onClick={submit} disabled={busy}
                        className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                        {busy ? 'Creating…' : 'Create case'}
                    </button>
                </div>
            </div>
        </div>
    );
}
