/**
 * Threat Hunting Portal — module 3 of the SOC platform extension.
 *
 * Multi-field hunting (IP, user, host, process, hash, MITRE, command line,
 * free-text) against Wazuh / Elastic, with saved hunts + recent executions.
 *
 * Backend: /api/soc/hunts/* (see backend/hunts.py).
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Bookmark, Clock, Play, RefreshCw, Save, Search, Star, Trash2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { huntsAPI } from '../utils/api';
import type {
    HuntFilters, HuntResult, SavedHuntRow,
} from '../utils/api';
import {
    SocPage, SocCard, PermissionGate, timeAgo, fmtDateTime,
} from '../components/soc/SocLayout';

const TIME_RANGES = [
    { label: 'Last 15m',  value: 'now-15m' },
    { label: 'Last 1h',   value: 'now-1h' },
    { label: 'Last 24h',  value: 'now-24h' },
    { label: 'Last 7d',   value: 'now-7d' },
    { label: 'Last 30d',  value: 'now-30d' },
];

const EMPTY: HuntFilters = {
    ip: '', username: '', hostname: '', process: '',
    hash: '', command_line: '', mitre: '',
    time_from: 'now-24h', time_to: 'now',
    free_text: '', size: 100,
};

export default function ThreatHunting() {
    const [filters, setFilters] = useState<HuntFilters>(EMPTY);
    const [result, setResult] = useState<HuntResult | null>(null);
    const [running, setRunning] = useState(false);
    const [saved, setSaved] = useState<SavedHuntRow[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [showSave, setShowSave] = useState(false);

    const loadAux = async () => {
        try {
            const [s, h] = await Promise.all([huntsAPI.listSaved(), huntsAPI.history(20)]);
            setSaved(s); setHistory(h);
        } catch { /* tolerated */ }
    };

    useEffect(() => {
        loadAux();
        // Allow the MITRE dashboard to pre-fill the technique filter via
        // localStorage. Cleared after consumption so it doesn't stick.
        try {
            const prefill = localStorage.getItem('hunt_prefill_mitre');
            if (prefill) {
                setFilters(f => ({ ...f, mitre: prefill }));
                localStorage.removeItem('hunt_prefill_mitre');
                toast.success(`Prefilled MITRE = ${prefill}`);
            }
        } catch { /* ignore */ }
    }, []);

    const execute = async (filt: HuntFilters = filters, savedId?: number) => {
        setRunning(true); setResult(null);
        try {
            const r = await huntsAPI.execute(filt, savedId);
            setResult(r);
            if (r.error) toast.error(r.error);
            loadAux();      // refresh history
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Hunt failed');
        } finally { setRunning(false); }
    };

    const loadSaved = (h: SavedHuntRow) => {
        setFilters({ ...EMPTY, ...(h.filters as HuntFilters) });
        toast.success(`Loaded "${h.name}"`);
    };

    const deleteSaved = async (h: SavedHuntRow) => {
        if (!confirm(`Delete saved hunt "${h.name}"?`)) return;
        try { await huntsAPI.deleteSaved(h.id); toast.success('Deleted'); loadAux(); }
        catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const isEmpty = useMemo(() => {
        const { ip, username, hostname, process, hash, command_line, mitre, free_text } = filters;
        return !ip && !username && !hostname && !process && !hash && !command_line && !mitre && !free_text;
    }, [filters]);

    return (
        <SocPage
            eyebrow="Threat hunting"
            title={<><span className="text-white">Hunt </span><span className="text-gradient-brand">Portal</span></>}
            subtitle="Multi-field search across Wazuh / Elastic"
            actions={
                <>
                    <button onClick={() => loadAux()} className="chip chip-base">
                        <RefreshCw size={14} /> Refresh
                    </button>
                    <PermissionGate permission="hunt.save">
                        <button onClick={() => setShowSave(true)}
                            disabled={isEmpty}
                            className="chip chip-base disabled:opacity-40">
                            <Save size={14} /> Save hunt
                        </button>
                    </PermissionGate>
                    <PermissionGate permission="hunt.execute">
                        <button onClick={() => execute()} disabled={running}
                            className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                            <Play size={14} className={running ? 'animate-pulse' : ''} />
                            {running ? 'Hunting…' : 'Execute hunt'}
                        </button>
                    </PermissionGate>
                </>
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                {/* Filter form */}
                <div className="lg:col-span-3 space-y-5">
                    <SocCard>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <FilterField label="IP address" value={filters.ip}
                                onChange={v => setFilters(f => ({ ...f, ip: v }))} placeholder="10.0.0.42" />
                            <FilterField label="Username" value={filters.username}
                                onChange={v => setFilters(f => ({ ...f, username: v }))} placeholder="alice" />
                            <FilterField label="Hostname" value={filters.hostname}
                                onChange={v => setFilters(f => ({ ...f, hostname: v }))} placeholder="WEB-PROD-04" />
                            <FilterField label="Process name" value={filters.process}
                                onChange={v => setFilters(f => ({ ...f, process: v }))} placeholder="powershell.exe" />
                            <FilterField label="File hash" value={filters.hash}
                                onChange={v => setFilters(f => ({ ...f, hash: v }))} placeholder="sha256 / md5 / sha1" />
                            <FilterField label="MITRE technique" value={filters.mitre}
                                onChange={v => setFilters(f => ({ ...f, mitre: v }))} placeholder="T1059" />
                            <FilterField label="Command line" value={filters.command_line}
                                onChange={v => setFilters(f => ({ ...f, command_line: v }))} placeholder="-EncodedCommand" />
                            <FilterField label="Free-text query" value={filters.free_text}
                                onChange={v => setFilters(f => ({ ...f, free_text: v }))} placeholder="rule.level:>10" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                            <label className="block">
                                <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">From</span>
                                <select value={filters.time_from || 'now-24h'}
                                    onChange={e => setFilters(f => ({ ...f, time_from: e.target.value }))}
                                    className="soc-input">
                                    {TIME_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">To</span>
                                <input value={filters.time_to || 'now'}
                                    onChange={e => setFilters(f => ({ ...f, time_to: e.target.value }))}
                                    className="soc-input" />
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Result size</span>
                                <input type="number" value={filters.size ?? 100} min={1} max={1000}
                                    onChange={e => setFilters(f => ({ ...f, size: Number(e.target.value) || 100 }))}
                                    className="soc-input" />
                            </label>
                        </div>
                        <div className="flex justify-between items-center mt-4">
                            <button onClick={() => setFilters(EMPTY)} className="chip chip-base">
                                <X size={14} /> Clear
                            </button>
                            {result && (
                                <div className="text-xs text-ui-muted">
                                    <span className="text-white font-bold">{result.count}</span> /
                                    <span className="ml-1">{result.total} hits</span> ·
                                    <span className="ml-1">{result.duration_ms}ms</span>
                                </div>
                            )}
                        </div>
                    </SocCard>

                    {/* Results */}
                    <SocCard padding="p-0">
                        <div className="px-5 py-3 border-b border-ui-border/30 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                <Search size={14} /> Results
                            </h3>
                        </div>
                        {!result && !running && (
                            <div className="text-center py-16 text-ui-subtle">
                                <Search className="mx-auto mb-2" size={28} />
                                <p className="text-sm">Fill any filter and click <span className="text-white">Execute hunt</span>.</p>
                            </div>
                        )}
                        {running && (
                            <div className="text-center py-16 text-ui-subtle">
                                <RefreshCw className="mx-auto mb-2 animate-spin" size={24} />
                                <p className="text-sm">Querying SIEM…</p>
                            </div>
                        )}
                        {result && !running && (
                            <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                                {result.hits.length === 0 ? (
                                    <p className="text-center text-ui-subtle text-sm py-12">No hits in the selected window.</p>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead className="bg-ui-surface/40 text-[10px] uppercase tracking-[0.2em] text-ui-subtle sticky top-0">
                                            <tr>
                                                <th className="text-left px-4 py-3">Time</th>
                                                <th className="text-left px-4 py-3">Rule</th>
                                                <th className="text-left px-4 py-3">Agent</th>
                                                <th className="text-left px-4 py-3">Source</th>
                                                <th className="text-left px-4 py-3">Description</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.hits.map((h, i) => {
                                                const rule = h?.rule || {};
                                                const agent = h?.agent || {};
                                                const data = h?.data || {};
                                                return (
                                                    <tr key={h._id || i} className="border-t border-ui-border/20 hover:bg-white/[0.02]">
                                                        <td className="px-4 py-2 font-mono text-ui-muted whitespace-nowrap">
                                                            {fmtDateTime(h['@timestamp'])}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <div className="text-white">{rule.description || rule.id || '—'}</div>
                                                            <div className="text-[10px] text-ui-subtle">lvl {rule.level} · {rule.id}</div>
                                                        </td>
                                                        <td className="px-4 py-2 text-ui-muted">{agent.name || agent.ip || '—'}</td>
                                                        <td className="px-4 py-2 font-mono text-ui-muted">{data.srcip || agent.ip || '—'}</td>
                                                        <td className="px-4 py-2 text-ui-muted max-w-xs truncate" title={JSON.stringify(h)}>
                                                            {data.command || data.win?.eventdata?.commandLine || h.full_log || '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}
                    </SocCard>
                </div>

                {/* Side: saved + history */}
                <div className="space-y-5">
                    <SocCard>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Bookmark size={14} /> Saved hunts
                        </h3>
                        {saved.length === 0 ? (
                            <p className="text-xs text-ui-subtle italic">No saved hunts yet.</p>
                        ) : (
                            <ul className="space-y-2">
                                {saved.map(s => (
                                    <li key={s.id} className="border border-ui-border/30 rounded-lg p-2.5 hover:bg-white/[0.02]">
                                        <div className="flex items-start justify-between gap-2">
                                            <button onClick={() => loadSaved(s)} className="text-left flex-1 min-w-0">
                                                <div className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                                                    {s.is_shared && <Star size={11} className="text-neon-yellow" />}
                                                    {s.name}
                                                </div>
                                                {s.description && (
                                                    <div className="text-[11px] text-ui-subtle truncate">{s.description}</div>
                                                )}
                                            </button>
                                            <button onClick={() => deleteSaved(s)}
                                                className="text-ui-subtle hover:text-neon-red transition-colors">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </SocCard>

                    <SocCard>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Clock size={14} /> Recent
                        </h3>
                        {history.length === 0 ? (
                            <p className="text-xs text-ui-subtle italic">No executions yet.</p>
                        ) : (
                            <ul className="space-y-1.5">
                                {history.slice(0, 10).map(h => (
                                    <li key={h.id} className="text-[11px] flex justify-between">
                                        <span className="text-ui-muted">{timeAgo(h.created_at)}</span>
                                        <span className="text-white">{h.result_count} hits</span>
                                        <span className="text-ui-subtle">{h.duration_ms}ms</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </SocCard>
                </div>
            </div>

            {showSave && (
                <SaveHuntModal
                    filters={filters}
                    onClose={() => setShowSave(false)}
                    onSaved={() => { setShowSave(false); loadAux(); }}
                />
            )}
        </SocPage>
    );
}

function FilterField({
    label, value, onChange, placeholder,
}: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <label className="block">
            <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">{label}</span>
            <input value={value || ''} onChange={e => onChange(e.target.value)}
                placeholder={placeholder} className="soc-input" />
        </label>
    );
}

function SaveHuntModal({
    filters, onClose, onSaved,
}: { filters: HuntFilters; onClose: () => void; onSaved: () => void }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [shared, setShared] = useState(false);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!name.trim()) { toast.error('Name required'); return; }
        setBusy(true);
        try {
            await huntsAPI.saveNew({
                name: name.trim(),
                description: description.trim() || undefined,
                filters,
                is_shared: shared,
            });
            toast.success('Hunt saved');
            onSaved();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-panel-dark border border-ui-border/50 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">Save hunt</h2>
                    <button onClick={onClose} className="text-ui-subtle hover:text-white"><X size={18} /></button>
                </div>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Name</span>
                    <input autoFocus value={name} onChange={e => setName(e.target.value)} className="soc-input"
                        placeholder="High-priv lateral movement" />
                </label>
                <label className="block">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-1">Description</span>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="soc-input" />
                </label>
                <label className="flex items-center gap-2 text-xs text-ui-muted cursor-pointer">
                    <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
                    Share with team
                </label>
                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="chip chip-base">Cancel</button>
                    <button onClick={submit} disabled={busy}
                        className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                        {busy ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
