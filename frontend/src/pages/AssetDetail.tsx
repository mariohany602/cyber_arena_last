/**
 * Asset detail — module 7. Shows full inventory record, computed risk
 * score, open vulnerabilities, software/services, with quick controls for
 * criticality and tags.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, Box, Cpu, Network, RefreshCw, Save, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { assetsAPI } from '../utils/api';
import type { AssetRow } from '../utils/api';
import {
    SocPage, SocCard, PermissionGate, timeAgo, fmtDateTime,
} from '../components/soc/SocLayout';
import { useAuth } from '../context/AuthContext';
import { RiskBar } from './AssetInventory';

export default function AssetDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const assetId = Number(id);

    const [data, setData] = useState<AssetRow | null>(null);
    const [loading, setLoading] = useState(false);
    const [criticality, setCriticality] = useState(50);
    const [vulnCount, setVulnCount] = useState(0);
    const [notes, setNotes] = useState('');
    const [dirty, setDirty] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const a = await assetsAPI.get(assetId);
            setData(a);
            setCriticality(a.criticality);
            setVulnCount(a.vuln_count);
            setNotes(a.notes || '');
            setDirty(false);
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (!Number.isNaN(assetId)) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assetId]);

    const save = async () => {
        if (!data) return;
        try {
            await assetsAPI.patch(data.id, {
                criticality, vuln_count: vulnCount, notes,
            } as any);
            toast.success('Saved');
            load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const remove = async () => {
        if (!data) return;
        if (!confirm(`Delete asset ${data.hostname}?`)) return;
        try {
            await assetsAPI.delete(data.id);
            toast.success('Deleted');
            navigate('/assets');
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    if (Number.isNaN(assetId)) {
        return <SocPage eyebrow="Asset" title="Invalid id"><SocCard>—</SocCard></SocPage>;
    }

    return (
        <SocPage
            eyebrow={`Asset #${assetId}`}
            title={data ? <span className="text-white">{data.hostname}</span> : <span className="text-ui-muted">Loading…</span>}
            subtitle={data ? <>{data.ip || 'no IP'} · {data.os || 'unknown OS'} · last seen {timeAgo(data.last_seen)}</> : null}
            actions={
                <>
                    <button onClick={() => navigate('/assets')} className="chip chip-base"><ArrowLeft size={14} /> Back</button>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="asset.update">
                        <button onClick={save} disabled={!dirty}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30 disabled:opacity-40">
                            <Save size={14} /> Save
                        </button>
                        <button onClick={remove}
                            className="chip chip-base hover:bg-neon-red/15 hover:text-neon-red hover:border-neon-red/40">
                            <Trash2 size={14} /> Delete
                        </button>
                    </PermissionGate>
                </>
            }
        >
            {!data ? (
                <SocCard><div className="text-center text-ui-subtle py-10">Loading…</div></SocCard>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2 space-y-5">
                        <SocCard>
                            <div className="flex items-start justify-between gap-3 mb-4">
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle">Risk score</div>
                                    <div className="text-4xl font-black text-white mt-1">{data.risk_score}</div>
                                </div>
                                <RiskBar score={data.risk_score} />
                            </div>
                            <div className="text-[10px] text-ui-muted">
                                Computed from criticality ({data.criticality}/100), vulnerability pressure
                                ({data.vuln_count} known) and agent state.
                            </div>
                        </SocCard>

                        <SocCard>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Network size={14} /> Network
                            </h3>
                            <dl className="grid grid-cols-2 gap-3 text-xs">
                                <Row k="IP"   v={data.ip || '—'} />
                                <Row k="MAC"  v={data.mac || '—'} />
                                <Row k="Open ports" v={data.open_ports.length ? data.open_ports.join(', ') : '—'} />
                                <Row k="Owner" v={data.owner || '—'} />
                            </dl>
                            {data.services && data.services.length > 0 && (
                                <div className="mt-4">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-2">Services</div>
                                    <div className="flex flex-wrap gap-1">
                                        {data.services.map((s: any, i) => (
                                            <span key={i} className="chip chip-base">
                                                {(s.name || 'unknown')}{s.port ? `:${s.port}` : ''}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </SocCard>

                        <SocCard>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Box size={14} /> Software
                            </h3>
                            {(!data.software || data.software.length === 0) ? (
                                <p className="text-xs text-ui-subtle italic">No installed software recorded.</p>
                            ) : (
                                <div className="max-h-72 overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-xs">
                                        <thead className="text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                                            <tr>
                                                <th className="text-left py-1">Name</th>
                                                <th className="text-left py-1">Version</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.software.map((s: any, i) => (
                                                <tr key={i} className="border-t border-ui-border/20">
                                                    <td className="py-1 text-white">{s.name || '—'}</td>
                                                    <td className="py-1 font-mono text-ui-muted">{s.version || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </SocCard>

                        <SocCard>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Notes</h3>
                            <textarea value={notes} rows={4}
                                disabled={!hasPermission('asset.update')}
                                onChange={e => { setNotes(e.target.value); setDirty(true); }}
                                className="soc-input" />
                        </SocCard>
                    </div>

                    <div className="space-y-5">
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3 flex items-center gap-2">
                                <Cpu size={12} /> Agent
                            </div>
                            <dl className="text-xs space-y-1.5">
                                <Row k="ID"     v={data.agent_id || '—'} />
                                <Row k="Status" v={data.agent_status || '—'} />
                                <Row k="OS"     v={`${data.os || ''} ${data.os_version || ''}`.trim() || '—'} />
                                <Row k="Last seen" v={fmtDateTime(data.last_seen)} />
                            </dl>
                        </SocCard>

                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Criticality</div>
                            <input type="range" min={0} max={100} value={criticality}
                                onChange={e => { setCriticality(Number(e.target.value)); setDirty(true); }}
                                disabled={!hasPermission('asset.update')}
                                className="w-full accent-brand-primary" />
                            <div className="text-2xl font-bold text-white mt-1">{criticality}</div>
                            <p className="text-[11px] text-ui-subtle mt-1">
                                Higher criticality → faster risk-score escalation.
                            </p>
                        </SocCard>

                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Vulnerability count</div>
                            <input type="number" min={0} value={vulnCount}
                                onChange={e => { setVulnCount(Number(e.target.value) || 0); setDirty(true); }}
                                disabled={!hasPermission('asset.update')}
                                className="soc-input" />
                            <p className="text-[11px] text-ui-subtle mt-1">
                                Override if you want to drive risk manually.
                            </p>
                        </SocCard>

                        {data.tags.length > 0 && (
                            <SocCard>
                                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Tags</div>
                                <div className="flex flex-wrap gap-1">
                                    {data.tags.map(t => <span key={t} className="chip chip-base">{t}</span>)}
                                </div>
                            </SocCard>
                        )}
                    </div>
                </div>
            )}
        </SocPage>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex justify-between gap-3">
            <dt className="text-ui-subtle">{k}</dt>
            <dd className="text-slate-200 text-right break-all">{v}</dd>
        </div>
    );
}
