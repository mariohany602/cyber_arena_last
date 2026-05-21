/**
 * Asset Inventory — module 7 of the SOC platform extension.
 *
 * Local asset store with risk scoring + Wazuh agent sync. Includes filter
 * bar, summary stats, and a "Sync from Wazuh" action that pulls the agent
 * roster into the local table.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChevronRight, DownloadCloud, Plus, RefreshCw, Search, Server, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { assetsAPI } from '../utils/api';
import type { AssetRow, AssetStats } from '../utils/api';
import {
    SocPage, SocCard, StatCard, PermissionGate, timeAgo,
} from '../components/soc/SocLayout';

const AGENT_TONE: Record<string, string> = {
    active:             'bg-neon-green/10 text-neon-green border-neon-green/30',
    disconnected:       'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
    never_connected:    'bg-white/5 text-ui-muted border-ui-border/40',
    pending:            'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
    unknown:            'bg-white/5 text-ui-muted border-ui-border/40',
};

export default function AssetInventory() {
    const navigate = useNavigate();
    const [rows, setRows] = useState<AssetRow[]>([]);
    const [stats, setStats] = useState<AssetStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [q, setQ] = useState('');
    const [minRisk, setMinRisk] = useState(0);
    const [agentStatus, setAgentStatus] = useState('');
    const [showCreate, setShowCreate] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [list, s] = await Promise.all([
                assetsAPI.list({
                    q: q || undefined,
                    min_risk: minRisk || undefined,
                    agent_status: agentStatus || undefined,
                    limit: 500,
                }),
                assetsAPI.stats(),
            ]);
            setRows(list.items); setStats(s);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load assets');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [minRisk, agentStatus]);

    const syncWazuh = async () => {
        setSyncing(true);
        try {
            const r = await assetsAPI.syncWazuh();
            toast.success(`Synced ${r.total_agents} agents (${r.created} new, ${r.updated} updated)`);
            load();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Sync failed (Wazuh unreachable?)');
        } finally { setSyncing(false); }
    };

    return (
        <SocPage
            eyebrow="Asset management"
            title={<><span className="text-white">Asset </span><span className="text-gradient-brand">Inventory</span></>}
            subtitle={`${rows.length} asset${rows.length === 1 ? '' : 's'} · ${stats?.total_vulnerabilities ?? 0} known vulnerabilities`}
            actions={
                <>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="asset.update">
                        <button onClick={syncWazuh} disabled={syncing}
                            className="chip chip-base bg-neon-cyan/10 text-neon-cyan border-neon-cyan/40 hover:bg-neon-cyan/20">
                            <DownloadCloud size={14} className={syncing ? 'animate-pulse' : ''} />
                            {syncing ? 'Syncing…' : 'Sync Wazuh'}
                        </button>
                        <button onClick={() => setShowCreate(true)}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                            <Plus size={14} /> New asset
                        </button>
                    </PermissionGate>
                </>
            }
        >
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Total assets"          value={stats?.total ?? 0} />
                <StatCard label="Critical risk ≥ 80"    value={stats?.risk_buckets?.critical ?? 0} tone="danger" />
                <StatCard label="High risk 60-80"       value={stats?.risk_buckets?.high ?? 0} tone="warn" />
                <StatCard label="Agents active"         value={stats?.by_agent_status?.active ?? 0} tone="positive" />
                <StatCard label="Open vulnerabilities"  value={stats?.total_vulnerabilities ?? 0} tone="info" />
            </div>

            <SocCard padding="p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px] relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-subtle" />
                        <input value={q} onChange={e => setQ(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && load()}
                            placeholder="Search hostname / IP"
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm" />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ui-muted">
                        Min risk
                        <input type="number" value={minRisk} min={0} max={100}
                            onChange={e => setMinRisk(Number(e.target.value) || 0)}
                            className="w-16 px-2 py-1 rounded bg-ui-surface border border-ui-border/40" />
                    </label>
                    <select value={agentStatus} onChange={e => setAgentStatus(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm">
                        <option value="">All agent states</option>
                        <option value="active">active</option>
                        <option value="disconnected">disconnected</option>
                        <option value="never_connected">never connected</option>
                    </select>
                </div>
            </SocCard>

            <SocCard padding="p-0">
                <table className="w-full text-sm">
                    <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                        <tr>
                            <th className="text-left px-4 py-3">Host</th>
                            <th className="text-left px-4 py-3">IP</th>
                            <th className="text-left px-4 py-3">OS</th>
                            <th className="text-left px-4 py-3">Risk</th>
                            <th className="text-left px-4 py-3">Vulns</th>
                            <th className="text-left px-4 py-3">Agent</th>
                            <th className="text-left px-4 py-3">Last seen</th>
                            <th className="w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && !loading && (
                            <tr><td colSpan={8} className="text-center text-ui-subtle py-12">
                                <Server className="mx-auto mb-2 text-ui-subtle" size={24} />
                                No assets yet — click "Sync Wazuh" to import the agent roster.
                            </td></tr>
                        )}
                        {rows.map(a => (
                            <tr key={a.id}
                                className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer"
                                onClick={() => navigate(`/assets/${a.id}`)}>
                                <td className="px-4 py-3">
                                    <div className="text-white font-medium">{a.hostname}</div>
                                    {a.agent_id && <div className="text-[10px] font-mono text-ui-subtle">agent #{a.agent_id}</div>}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-ui-muted">{a.ip || '—'}</td>
                                <td className="px-4 py-3 text-xs text-ui-muted">{a.os || '—'}</td>
                                <td className="px-4 py-3"><RiskBar score={a.risk_score} /></td>
                                <td className="px-4 py-3 text-xs">
                                    <span className={a.vuln_count > 0 ? 'text-neon-red font-bold' : 'text-ui-muted'}>
                                        {a.vuln_count}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`chip ${AGENT_TONE[a.agent_status || 'unknown'] || AGENT_TONE.unknown}`}>
                                        {a.agent_status || 'unknown'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-ui-muted">{timeAgo(a.last_seen)}</td>
                                <td className="px-4 py-3 text-right">
                                    <ChevronRight size={16} className="text-ui-subtle inline" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </SocCard>

            {showCreate && (
                <CreateAssetModal
                    onClose={() => setShowCreate(false)}
                    onCreated={(a) => { setShowCreate(false); navigate(`/assets/${a.id}`); }}
                />
            )}
        </SocPage>
    );
}

export function RiskBar({ score }: { score: number }) {
    const tone =
        score >= 80 ? 'text-neon-red'      :
        score >= 60 ? 'text-neon-magenta'  :
        score >= 30 ? 'text-neon-yellow'   :
                      'text-neon-cyan';
    const bg =
        score >= 80 ? 'bg-neon-red'     :
        score >= 60 ? 'bg-neon-magenta' :
        score >= 30 ? 'bg-neon-yellow'  :
                      'bg-neon-cyan';
    return (
        <div className="flex items-center gap-2 min-w-[100px]">
            <div className="h-1.5 w-16 bg-white/5 rounded overflow-hidden">
                <div className={`h-full ${bg}`} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
            </div>
            <span className={`text-xs font-bold ${tone}`}>{score}</span>
        </div>
    );
}

function CreateAssetModal({
    onClose, onCreated,
}: { onClose: () => void; onCreated: (a: AssetRow) => void }) {
    const [hostname, setHostname] = useState('');
    const [ip, setIp] = useState('');
    const [os, setOs] = useState('');
    const [criticality, setCriticality] = useState(50);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!hostname.trim()) { toast.error('Hostname required'); return; }
        setBusy(true);
        try {
            const a = await assetsAPI.create({
                hostname: hostname.trim(),
                ip: ip.trim() || undefined,
                os: os.trim() || undefined,
                criticality,
            } as any);
            toast.success('Asset created');
            onCreated(a);
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">New asset</h2>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Hostname</span>
                    <input autoFocus value={hostname} onChange={e => setHostname(e.target.value)} className="soc-input" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">IP</span>
                        <input value={ip} onChange={e => setIp(e.target.value)} className="soc-input font-mono" />
                    </label>
                    <label className="block">
                        <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">OS</span>
                        <input value={os} onChange={e => setOs(e.target.value)} className="soc-input" />
                    </label>
                </div>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Criticality (0-100)</span>
                    <input type="number" min={0} max={100} value={criticality}
                        onChange={e => setCriticality(Number(e.target.value) || 50)} className="soc-input" />
                </label>
                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="chip chip-base">Cancel</button>
                    <button onClick={submit} disabled={busy}
                        className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                        {busy ? 'Creating…' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
}
