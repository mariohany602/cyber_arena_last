import { useEffect, useState } from 'react';
import { Cpu, Copy, RefreshCcw, Trash2, Terminal, Loader2, CheckCircle2, AlertTriangle, CircleDot } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import { orgAPI, type CurrentOrg, type AgentsResponse, type RegisteredAgent } from '../utils/api';
import toast from 'react-hot-toast';

/**
 * Settings → Agents
 *
 * Customer-facing agent onboarding:
 *   - shows the one-liner `curl … | sudo bash` the customer runs on every
 *     host they want monitored
 *   - lists agents currently registered into this tenant's Wazuh group
 *     (live from the Wazuh Manager API, no DB caching)
 *   - revoke removes an agent from Wazuh (refused if it's not in our group)
 */
export default function SettingsAgents() {
    const [org, setOrg] = useState<CurrentOrg | null>(null);
    const [data, setData] = useState<AgentsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);

    const load = async () => {
        setError(null);
        try {
            const [o, d] = await Promise.all([orgAPI.current(), orgAPI.listAgents()]);
            setOrg(o);
            setData(d);
        } catch (e: any) {
            setError(e.response?.data?.detail || 'Failed to load agents');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => { load(); }, []);

    const refresh = () => { setRefreshing(true); load(); };

    const isOwnerOrAdmin = org && (org.my_role === 'owner' || org.my_role === 'admin');

    const installUrl = data
        ? `${window.location.origin}/install.sh?key=${data.enrollment_key || ''}`
        : '';
    const oneLiner = data ? `curl -s "${installUrl}" | sudo bash` : '';

    const copy = (value: string, label: string) => {
        if (!value) return;
        navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
    };

    const handleRevoke = async (a: RegisteredAgent) => {
        if (!confirm(`Revoke agent "${a.name}" (${a.id})? It will be removed from Wazuh and stop reporting immediately.`)) return;
        setRevoking(a.id);
        try {
            await orgAPI.revokeAgent(a.id);
            toast.success('Agent revoked');
            await load();
        } catch (e: any) {
            toast.error(e.response?.data?.detail || 'Revoke failed');
        } finally {
            setRevoking(null);
        }
    };

    return (
        <ToolLayout title="Registered Agents" icon={Cpu}>
            <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                {loading && (
                    <div className="flex items-center gap-3 text-ui-muted">
                        <Loader2 className="w-5 h-5 animate-spin" /> Loading agents…
                    </div>
                )}

                {error && !loading && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm">
                        <AlertTriangle className="inline w-4 h-4 mr-2" /> {error}
                    </div>
                )}

                {data && data.warning && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-sm">
                        <AlertTriangle className="inline w-4 h-4 mr-2" /> {data.warning}
                    </div>
                )}

                {data && (
                    <>
                        {/* Install one-liner */}
                        <div className="rounded-xl border border-ui-border bg-ui-panel p-6">
                            <div className="flex items-start justify-between gap-4 mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Terminal className="w-5 h-5 text-brand-400" /> One-liner installer
                                    </h3>
                                    <p className="text-sm text-ui-muted mt-1">
                                        Run on any Linux host (Debian/Ubuntu or RHEL/CentOS). Installs the
                                        Wazuh agent, registers it into <code className="text-brand-300">{data.group}</code>,
                                        and starts the service.
                                    </p>
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-ui-bg text-ui-muted border border-ui-border whitespace-nowrap">
                                    manager: {data.manager_host}
                                </span>
                            </div>

                            <div className="rounded-lg bg-black/60 border border-ui-border p-3 font-mono text-xs text-emerald-300 flex items-start gap-2">
                                <code className="flex-1 break-all">{oneLiner}</code>
                                <button
                                    onClick={() => copy(oneLiner, 'Installer command')}
                                    className="shrink-0 text-brand-400 hover:text-brand-300"
                                    title="Copy"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                            </div>

                            {!data.enrollment_key && (
                                <p className="text-xs text-amber-300 mt-3 flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    No enrollment key set — rotate one from Organization Settings.
                                </p>
                            )}
                        </div>

                        {/* Agents table */}
                        <div className="rounded-xl border border-ui-border bg-ui-panel overflow-hidden">
                            <div className="flex items-center justify-between gap-4 p-5 border-b border-ui-border">
                                <div>
                                    <h3 className="text-lg font-bold text-white">Registered agents</h3>
                                    <p className="text-xs text-ui-muted mt-1">
                                        {data.agents.length} agent{data.agents.length === 1 ? '' : 's'} in <code className="text-brand-300">{data.group}</code>
                                    </p>
                                </div>
                                <button
                                    onClick={refresh}
                                    disabled={refreshing}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ui-bg hover:bg-ui-border border border-ui-border text-white text-sm transition disabled:opacity-50"
                                >
                                    {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                                    Refresh
                                </button>
                            </div>

                            {data.agents.length === 0 ? (
                                <div className="p-10 text-center text-ui-muted text-sm">
                                    No agents enrolled yet. Run the one-liner above on a host to start monitoring.
                                </div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-ui-bg/60 text-[10px] font-black uppercase tracking-widest text-ui-muted">
                                        <tr>
                                            <th className="text-left px-5 py-2.5">Status</th>
                                            <th className="text-left px-5 py-2.5">Name</th>
                                            <th className="text-left px-5 py-2.5">ID</th>
                                            <th className="text-left px-5 py-2.5">IP</th>
                                            <th className="text-left px-5 py-2.5">OS</th>
                                            <th className="text-left px-5 py-2.5">Version</th>
                                            <th className="text-left px-5 py-2.5">Last seen</th>
                                            <th className="text-right px-5 py-2.5">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.agents.map((a) => (
                                            <tr key={a.id} className="border-t border-ui-border/40 hover:bg-ui-bg/40">
                                                <td className="px-5 py-2.5"><StatusChip status={a.status} /></td>
                                                <td className="px-5 py-2.5 text-white font-medium">{a.name}</td>
                                                <td className="px-5 py-2.5 font-mono text-xs text-ui-muted">{a.id}</td>
                                                <td className="px-5 py-2.5 font-mono text-xs text-ui-muted">{a.ip || '—'}</td>
                                                <td className="px-5 py-2.5 text-ui-muted">{a.os || '—'}</td>
                                                <td className="px-5 py-2.5 text-ui-muted">{a.version || '—'}</td>
                                                <td className="px-5 py-2.5 text-ui-muted">{a.last_keep_alive || '—'}</td>
                                                <td className="px-5 py-2.5 text-right">
                                                    {isOwnerOrAdmin && a.id !== '000' && (
                                                        <button
                                                            onClick={() => handleRevoke(a)}
                                                            disabled={revoking === a.id}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs transition disabled:opacity-50"
                                                            title="Revoke agent"
                                                        >
                                                            {revoking === a.id
                                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                : <Trash2 className="w-3.5 h-3.5" />}
                                                            Revoke
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </ToolLayout>
    );
}

function StatusChip({ status }: { status: string }) {
    const map: Record<string, { color: string; icon: any; label: string }> = {
        active:           { color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: CheckCircle2, label: 'Active' },
        disconnected:     { color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',       icon: AlertTriangle, label: 'Disconnected' },
        never_connected:  { color: 'bg-ui-bg text-ui-muted border-ui-border',                  icon: CircleDot, label: 'Never connected' },
        pending:          { color: 'bg-blue-500/15 text-blue-300 border-blue-500/30',          icon: CircleDot, label: 'Pending' },
    };
    const cfg = map[status] || { color: 'bg-ui-bg text-ui-muted border-ui-border', icon: CircleDot, label: status || '—' };
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${cfg.color}`}>
            <Icon className="w-3 h-3" /> {cfg.label}
        </span>
    );
}
