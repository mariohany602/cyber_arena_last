/**
 * IOC Intelligence Center — module 4 of the SOC platform extension.
 *
 * Lists IOCs from the local store, supports filtering by type, free-text
 * search, and threat-score threshold. Includes inline "Enrich" form that
 * proxies to VirusTotal / AbuseIPDB / GeoIP via /api/soc/iocs/enrich.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChevronRight, Globe, Hash, Mail, Plus, RefreshCw, Search, Sparkles, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { iocsAPI } from '../utils/api';
import type { IOCRow } from '../utils/api';
import {
    SocPage, SocCard, StatCard, PermissionGate, timeAgo,
} from '../components/soc/SocLayout';

const IOC_TYPES = ['ip', 'domain', 'url', 'hash', 'email'] as const;
type IocType = typeof IOC_TYPES[number];

const TYPE_ICON: Record<string, any> = {
    ip: Globe, domain: Globe, url: Globe, hash: Hash, email: Mail,
};

export default function IOCs() {
    const navigate = useNavigate();
    const [rows, setRows] = useState<IOCRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [type, setType] = useState<IocType | ''>('');
    const [q, setQ] = useState('');
    const [minScore, setMinScore] = useState(0);
    const [showCreate, setShowCreate] = useState(false);
    const [showEnrich, setShowEnrich] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const r = await iocsAPI.list({
                type: type || undefined, q: q || undefined,
                min_score: minScore || undefined, limit: 500,
            });
            setRows(r.items);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load IOCs');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type, minScore]);

    const stats = {
        total: rows.length,
        high: rows.filter(r => r.threat_score >= 60).length,
        ip: rows.filter(r => r.type === 'ip').length,
        domain: rows.filter(r => r.type === 'domain').length,
        hash: rows.filter(r => r.type === 'hash').length,
    };

    return (
        <SocPage
            eyebrow="IOC intelligence"
            title={<><span className="text-white">IOC </span><span className="text-gradient-brand">Intel</span></>}
            subtitle={`${rows.length} indicator${rows.length === 1 ? '' : 's'} tracked locally`}
            actions={
                <>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="ioc.enrich">
                        <button onClick={() => setShowEnrich(true)}
                            className="chip chip-base bg-neon-magenta/15 text-neon-magenta border-neon-magenta/40 hover:bg-neon-magenta/25">
                            <Sparkles size={14} /> Enrich
                        </button>
                    </PermissionGate>
                    <PermissionGate permission="ioc.create">
                        <button onClick={() => setShowCreate(true)}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                            <Plus size={14} /> New IOC
                        </button>
                    </PermissionGate>
                </>
            }
        >
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Total IOCs" value={stats.total} />
                <StatCard label="High threat ≥60" value={stats.high} tone="danger" />
                <StatCard label="IPs" value={stats.ip} tone="info" />
                <StatCard label="Domains" value={stats.domain} tone="info" />
                <StatCard label="Hashes" value={stats.hash} tone="info" />
            </div>

            <SocCard padding="p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px] relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-subtle" />
                        <input value={q} onChange={e => setQ(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && load()}
                            placeholder="Search value (1.2.3.4, evil.com, sha256…)"
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm" />
                    </div>
                    <select value={type} onChange={e => setType(e.target.value as IocType | '')}
                        className="px-3 py-2 rounded-lg bg-ui-surface border border-ui-border/40 text-sm">
                        <option value="">All types</option>
                        {IOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-xs text-ui-muted">
                        Min score
                        <input type="number" value={minScore} min={0} max={100}
                            onChange={e => setMinScore(Number(e.target.value) || 0)}
                            className="w-16 px-2 py-1 rounded bg-ui-surface border border-ui-border/40" />
                    </label>
                </div>
            </SocCard>

            <SocCard padding="p-0">
                <table className="w-full text-sm">
                    <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle">
                        <tr>
                            <th className="text-left px-4 py-3">Type</th>
                            <th className="text-left px-4 py-3">Value</th>
                            <th className="text-left px-4 py-3">Threat</th>
                            <th className="text-left px-4 py-3">Source</th>
                            <th className="text-left px-4 py-3">Last seen</th>
                            <th className="w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && !loading && (
                            <tr><td colSpan={6} className="text-center text-ui-subtle py-12">
                                <Search className="mx-auto mb-2 text-ui-subtle" size={24} />
                                No IOCs match the current filters.
                            </td></tr>
                        )}
                        {rows.map(r => {
                            const Icon = TYPE_ICON[r.type] || Globe;
                            return (
                                <tr key={r.id}
                                    className="border-t border-ui-border/30 hover:bg-white/[0.02] cursor-pointer"
                                    onClick={() => navigate(`/iocs/${r.id}`)}>
                                    <td className="px-4 py-3">
                                        <span className="inline-flex items-center gap-1.5 text-xs text-ui-muted uppercase tracking-wider">
                                            <Icon size={12} /> {r.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-white max-w-xs truncate">{r.value}</td>
                                    <td className="px-4 py-3"><ThreatBadge score={r.threat_score} /></td>
                                    <td className="px-4 py-3 text-xs text-ui-muted">{r.source || '—'}</td>
                                    <td className="px-4 py-3 text-xs text-ui-muted">{timeAgo(r.last_seen)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <ChevronRight size={16} className="text-ui-subtle inline" />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </SocCard>

            {showCreate && <CreateIocModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
            {showEnrich && <EnrichModal onClose={() => setShowEnrich(false)} onDone={(id) => {
                setShowEnrich(false);
                if (id) navigate(`/iocs/${id}`);
                else load();
            }} />}
        </SocPage>
    );
}

export function ThreatBadge({ score }: { score: number }) {
    const cls =
        score >= 80 ? 'bg-neon-red/15 text-neon-red border-neon-red/40' :
        score >= 60 ? 'bg-neon-magenta/15 text-neon-magenta border-neon-magenta/40' :
        score >= 30 ? 'bg-neon-yellow/15 text-neon-yellow border-neon-yellow/40' :
        score > 0   ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/40'
                    : 'bg-white/5 text-ui-muted border-ui-border/30';
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold ${cls}`}>
            {score}
        </span>
    );
}

function CreateIocModal({
    onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
    const [type, setType] = useState<IocType>('ip');
    const [value, setValue] = useState('');
    const [score, setScore] = useState(50);
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!value.trim()) { toast.error('Value required'); return; }
        setBusy(true);
        try {
            await iocsAPI.create({
                type, value: value.trim(),
                threat_score: score, description: description.trim() || undefined,
            } as any);
            toast.success('IOC saved');
            onCreated();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setBusy(false); }
    };

    return (
        <Modal title="New IOC" onClose={onClose}>
            <div className="grid grid-cols-2 gap-3">
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Type</span>
                    <select value={type} onChange={e => setType(e.target.value as IocType)} className="soc-input">
                        {IOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Threat score (0–100)</span>
                    <input type="number" value={score} min={0} max={100}
                        onChange={e => setScore(Number(e.target.value) || 0)} className="soc-input" />
                </label>
            </div>
            <label className="block">
                <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Value</span>
                <input autoFocus value={value} onChange={e => setValue(e.target.value)} className="soc-input font-mono" />
            </label>
            <label className="block">
                <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Description</span>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="soc-input" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="chip chip-base">Cancel</button>
                <button onClick={submit} disabled={busy}
                    className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                    {busy ? 'Saving…' : 'Save'}
                </button>
            </div>
        </Modal>
    );
}

function EnrichModal({
    onClose, onDone,
}: { onClose: () => void; onDone: (id?: number) => void }) {
    const [type, setType] = useState<IocType>('ip');
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<any>(null);

    const run = async () => {
        if (!value.trim()) { toast.error('Value required'); return; }
        setBusy(true); setResult(null);
        try {
            const r = await iocsAPI.enrich(type, value.trim(), true);
            setResult(r);
            toast.success('Enrichment complete');
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setBusy(false); }
    };

    return (
        <Modal title="Enrich indicator" onClose={onClose} wide>
            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-2">
                <select value={type} onChange={e => setType(e.target.value as IocType)} className="soc-input">
                    {IOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input autoFocus value={value} onChange={e => setValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && run()}
                    placeholder="value to enrich" className="soc-input font-mono" />
                <button onClick={run} disabled={busy}
                    className="chip chip-base bg-neon-magenta/15 text-neon-magenta border-neon-magenta/40 hover:bg-neon-magenta/25">
                    {busy ? 'Enriching…' : <><Sparkles size={14} /> Run</>}
                </button>
            </div>

            {result && (
                <div className="mt-4 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3 text-xs">
                    {result.ioc && (
                        <div className="flex items-center gap-2 text-ui-muted">
                            Saved as IOC <button onClick={() => onDone(result.ioc.id)}
                                className="text-brand-primary-bright hover:underline">
                                #{result.ioc.id}
                            </button>
                            with threat score <ThreatBadge score={result.ioc.threat_score} />
                        </div>
                    )}
                    <EnrichSection title="VirusTotal" data={result.enrichment?.virustotal} />
                    <EnrichSection title="AbuseIPDB" data={result.enrichment?.abuseipdb} />
                    <EnrichSection title="GeoIP" data={result.enrichment?.geoip} />
                    <EnrichSection title="DNS" data={result.enrichment?.dns} />
                </div>
            )}
        </Modal>
    );
}

function EnrichSection({ title, data }: { title: string; data: any }) {
    if (!data) return null;
    const disabled = data.provider_disabled;
    return (
        <div className="border border-ui-border/30 rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1.5">{title}</div>
            {disabled ? (
                <div className="text-ui-subtle italic text-[11px]">Provider disabled — set API key env var to enable.</div>
            ) : data.error ? (
                <div className="text-neon-red text-[11px]">{data.error}</div>
            ) : (
                <pre className="text-[11px] text-ui-muted whitespace-pre-wrap break-all">
                    {JSON.stringify(data, null, 2)}
                </pre>
            )}
        </div>
    );
}

function Modal({
    title, onClose, wide, children,
}: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className={`glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} space-y-4`}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">{title}</h2>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}
