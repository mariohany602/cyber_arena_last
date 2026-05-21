/**
 * SOAR Control Center — module 6 of the SOC platform extension.
 *
 * Dynamic action launcher driven by the backend's action catalogue
 * (/api/soc/soar/config). Renders one form per action with permission
 * gating, plus a unified execution history table with refresh-from-Shuffle.
 */
import { useEffect, useState } from 'react';
import {
    AlertCircle, CheckCircle2, Clock, PlayCircle, RefreshCw, X, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { soarAPI } from '../utils/api';
import type {
    SoarActionSpec, SoarConfig, SoarExecutionRow, SoarStats,
} from '../utils/api';
import {
    SocPage, SocCard, StatCard, PermissionGate, timeAgo, fmtDateTime,
} from '../components/soc/SocLayout';
import { useAuth } from '../context/AuthContext';

const STATUS_TONE: Record<string, string> = {
    pending:    'bg-white/5 text-ui-muted border-ui-border/40',
    running:    'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
    success:    'bg-neon-green/10 text-neon-green border-neon-green/30',
    failed:     'bg-neon-red/10 text-neon-red border-neon-red/30',
    local_only: 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
};

export default function SoarControlCenter() {
    const { hasPermission } = useAuth();
    const [config, setConfig] = useState<SoarConfig | null>(null);
    const [stats, setStats] = useState<SoarStats | null>(null);
    const [executions, setExecutions] = useState<SoarExecutionRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedAction, setSelectedAction] = useState<SoarActionSpec | null>(null);
    const [details, setDetails] = useState<SoarExecutionRow | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const [c, s, ex] = await Promise.all([
                soarAPI.config(),
                soarAPI.stats(),
                soarAPI.executions({ limit: 200 }),
            ]);
            setConfig(c); setStats(s); setExecutions(ex.items);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load SOAR data');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const testConnection = async () => {
        try {
            const result = await soarAPI.testConnection();
            if (result.success) {
                toast.success(result.message || `Connected to ${result.platform} successfully!`);
            } else {
                toast.error(result.error || 'Connection test failed');
            }
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Connection test failed');
        }
    };

    const refreshOne = async (id: number) => {
        try {
            const ex = await soarAPI.refresh(id);
            setExecutions(prev => prev.map(e => e.id === id ? ex : e));
            toast.success(`#${id} → ${ex.status}`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Refresh failed');
        }
    };

    // Determine SOAR platform status and display
    const platformChip = config && (() => {
        const platform = config.platform || 'none';
        const isConfigured = config.n8n_configured || config.shuffle_configured;
        const platformName = platform === 'n8n' ? 'n8n' :
                           platform === 'shuffle' ? 'Shuffle' :
                           'SOAR';
        const platformUrl = platform === 'n8n' ? config.n8n_url : config.shuffle_url;

        return (
            <span className={`chip ${isConfigured ? 'chip-green' : 'chip-yellow'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isConfigured ? 'bg-neon-green animate-pulse' : 'bg-neon-yellow'}`} />
                {platformName} {isConfigured ? 'connected' : 'not configured'}
            </span>
        );
    })();

    return (
        <SocPage
            eyebrow="SOAR control"
            title={<><span className="text-white">SOAR </span><span className="text-gradient-brand">Control Center</span></>}
            subtitle={(() => {
                if (!config) return 'Loading...';
                const platform = config.platform || 'none';
                const url = platform === 'n8n' ? config.n8n_url : config.shuffle_url;
                const platformName = platform === 'n8n' ? 'n8n' :
                                   platform === 'shuffle' ? 'Shuffle' :
                                   'SOAR platform';

                return url
                    ? <>Routing to {platformName}: <span className="font-mono text-white">{url}</span></>
                    : 'No SOAR platform configured — actions will be logged locally only.';
            })()}
            actions={
                <>
                    {platformChip}
                    <button onClick={testConnection} className="chip chip-base">
                        <Zap size={14} /> Test Connection
                    </button>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                </>
            }
        >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total actions"   value={stats?.total ?? 0} />
                <StatCard label="Last 24h"        value={stats?.last_24h ?? 0} tone="info" />
                <StatCard label="Success"         value={stats?.by_status?.success ?? 0} tone="positive" />
                <StatCard label="Failed"          value={stats?.by_status?.failed ?? 0} tone="danger" />
            </div>

            {/* Action launcher grid */}
            <SocCard>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Zap size={14} /> Available actions
                </h3>
                {!config ? (
                    <p className="text-sm text-ui-subtle italic">Loading actions…</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        {config.actions.map(a => {
                            const allowed = hasPermission(a.permission);
                            return (
                                <button key={a.key}
                                    onClick={() => setSelectedAction(a)}
                                    disabled={!allowed}
                                    className={`text-left rounded-xl border p-4 transition-all
                                        ${allowed
                                            ? 'border-ui-border/30 hover:border-brand-primary/40 hover:bg-white/[0.04]'
                                            : 'border-ui-border/20 opacity-50 cursor-not-allowed'}`}>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <PlayCircle size={16} className="text-brand-primary-bright" />
                                        <span className="text-sm font-bold text-white">{a.label}</span>
                                    </div>
                                    <p className="text-xs text-ui-muted">{a.description}</p>
                                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ui-subtle">
                                        <span className="font-mono">perm: {a.permission}</span>
                                        {a.workflow_id && <span className="font-mono">· wf: {a.workflow_id.slice(0, 8)}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </SocCard>

            {/* Execution history */}
            <SocCard padding="p-0">
                <div className="px-5 py-3 border-b border-ui-border/30">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Clock size={14} /> Execution history
                    </h3>
                </div>
                <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-sm">
                        <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle sticky top-0">
                            <tr>
                                <th className="text-left px-4 py-3">When</th>
                                <th className="text-left px-4 py-3">Action</th>
                                <th className="text-left px-4 py-3">Target</th>
                                <th className="text-left px-4 py-3">Status</th>
                                <th className="text-left px-4 py-3">Workflow</th>
                                <th className="w-24"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {executions.length === 0 && !loading && (
                                <tr><td colSpan={6} className="text-center text-ui-subtle py-12">No SOAR actions executed yet.</td></tr>
                            )}
                            {executions.map(ex => {
                                const tone = STATUS_TONE[ex.status] || STATUS_TONE.pending;
                                return (
                                    <tr key={ex.id} className="border-t border-ui-border/30 hover:bg-white/[0.02]">
                                        <td className="px-4 py-3 text-xs text-ui-muted whitespace-nowrap">{timeAgo(ex.created_at)}</td>
                                        <td className="px-4 py-3">
                                            <div className="text-white text-xs font-medium">{ex.playbook || ex.action}</div>
                                            <div className="text-[10px] font-mono text-ui-subtle">{ex.action}</div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-ui-muted max-w-[180px] truncate">{ex.target || '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`chip ${tone}`}>{ex.status}</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-[11px] text-ui-muted">
                                            {ex.workflow_id ? <span title={ex.execution_id || ''}>{ex.workflow_id.slice(0, 12)}…</span> : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex gap-1 justify-end">
                                                {ex.workflow_id && (
                                                    <button onClick={() => refreshOne(ex.id)} title="Refresh status"
                                                        className="chip chip-base"><RefreshCw size={12} /></button>
                                                )}
                                                <button onClick={() => setDetails(ex)} className="chip chip-base">View</button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </SocCard>

            {selectedAction && (
                <ActionModal
                    spec={selectedAction}
                    onClose={() => setSelectedAction(null)}
                    onDone={() => { setSelectedAction(null); load(); }}
                />
            )}
            {details && <ExecutionDetailsModal ex={details} onClose={() => setDetails(null)} />}
        </SocPage>
    );
}

function ActionModal({
    spec, onClose, onDone,
}: { spec: SoarActionSpec; onClose: () => void; onDone: () => void }) {
    const [values, setValues] = useState<Record<string, any>>({});
    const [incidentId, setIncidentId] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        // Validate required params
        for (const p of spec.params) {
            if (p.required && !String(values[p.key] ?? '').trim()) {
                toast.error(`Missing: ${p.label}`); return;
            }
        }
        // For JSON params, parse before sending
        const final: Record<string, any> = { ...values };
        for (const p of spec.params) {
            if (p.type === 'json' && typeof final[p.key] === 'string' && final[p.key].trim()) {
                try { final[p.key] = JSON.parse(final[p.key]); }
                catch { toast.error(`Invalid JSON in ${p.label}`); return; }
            }
        }
        setBusy(true);
        try {
            const ex = await soarAPI.execute({
                action: spec.key,
                params: final,
                incident_id: incidentId ? Number(incidentId) : undefined,
            });
            toast.success(`Action queued · status: ${ex.status}`);
            onDone();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to execute');
        } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full max-w-lg space-y-4"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white">{spec.label}</h2>
                        <p className="text-xs text-ui-muted">{spec.description}</p>
                    </div>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                {spec.params.map(p => (
                    <label key={p.key} className="block">
                        <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">
                            {p.label}{p.required && <span className="text-neon-red ml-1">*</span>}
                        </span>
                        {p.type === 'json' ? (
                            <textarea rows={4} className="soc-input font-mono text-xs"
                                value={values[p.key] || ''}
                                onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                                placeholder='{"key": "value"}' />
                        ) : (
                            <input type={p.type === 'number' ? 'number' : 'text'}
                                className="soc-input"
                                value={values[p.key] || ''}
                                onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))} />
                        )}
                    </label>
                ))}
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">
                        Link to incident (optional)
                    </span>
                    <input className="soc-input" type="number" value={incidentId}
                        onChange={e => setIncidentId(e.target.value)} placeholder="42" />
                </label>
                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="chip chip-base">Cancel</button>
                    <PermissionGate
                        permission={spec.permission}
                        fallback={<span className="chip chip-base opacity-40">Permission required: {spec.permission}</span>}
                    >
                        <button onClick={submit} disabled={busy}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                            <PlayCircle size={14} /> {busy ? 'Executing…' : 'Execute'}
                        </button>
                    </PermissionGate>
                </div>
            </div>
        </div>
    );
}

function ExecutionDetailsModal({
    ex, onClose,
}: { ex: SoarExecutionRow; onClose: () => void }) {
    const StatusIcon = ex.status === 'success' ? CheckCircle2 :
        ex.status === 'failed' ? AlertCircle :
        ex.status === 'running' ? RefreshCw : Clock;
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full max-w-2xl space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <StatusIcon size={18} className={ex.status === 'running' ? 'animate-spin' : ''} />
                            Execution #{ex.id}
                        </h2>
                        <p className="text-xs text-ui-muted">{ex.playbook || ex.action} · {fmtDateTime(ex.created_at)}</p>
                    </div>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                <dl className="text-xs grid grid-cols-2 gap-2">
                    <Row k="Action"        v={ex.action} />
                    <Row k="Status"        v={ex.status} />
                    <Row k="Target"        v={ex.target || '—'} />
                    <Row k="Workflow"      v={ex.workflow_id || '—'} />
                    <Row k="Execution ID"  v={ex.execution_id || '—'} />
                    <Row k="Incident"      v={ex.incident_id ? `#${ex.incident_id}` : '—'} />
                    <Row k="Finished"      v={fmtDateTime(ex.finished_at)} />
                </dl>
                <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Parameters</div>
                    <pre className="text-[11px] text-ui-muted bg-white/[0.02] rounded p-3 overflow-x-auto">
                        {JSON.stringify(ex.params, null, 2)}
                    </pre>
                </div>
                <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Result</div>
                    <pre className="text-[11px] text-ui-muted bg-white/[0.02] rounded p-3 overflow-x-auto">
                        {JSON.stringify(ex.result, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <>
            <dt className="text-ui-subtle">{k}</dt>
            <dd className="text-slate-200 font-mono text-xs break-all">{v}</dd>
        </>
    );
}
