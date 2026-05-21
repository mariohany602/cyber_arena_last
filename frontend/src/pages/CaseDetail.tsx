/**
 * Case detail — module 8 (Case Management). Includes evidence upload with
 * SHA-256 + chain-of-custody log displayed inline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, Download, MessageSquarePlus, Paperclip,
    RefreshCw, Trash2, UploadCloud,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { casesAPI, rbacAPI } from '../utils/api';
import type {
    CaseDetail as CaseDetailType, CaseStatus, IncidentSeverity, Tlp,
} from '../utils/api';
import {
    SocPage, SocCard, SeverityChip, CaseStatusChip, TlpChip,
    PermissionGate, timeAgo, fmtDateTime, fmtBytes,
} from '../components/soc/SocLayout';
import { useAuth } from '../context/AuthContext';

const STATUSES: CaseStatus[] = ['open', 'in_progress', 'closed'];
const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const TLPS: Tlp[] = ['white', 'green', 'amber', 'red'];

export default function CaseDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const caseId = Number(id);
    const fileRef = useRef<HTMLInputElement>(null);

    const [data, setData] = useState<CaseDetailType | null>(null);
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<Array<{ id: number; username: string }>>([]);
    const [note, setNote] = useState('');
    const [evDescription, setEvDescription] = useState('');
    const [uploading, setUploading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            setData(await casesAPI.get(caseId));
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load case');
        } finally { setLoading(false); }
    };

    useEffect(() => {
        if (Number.isNaN(caseId)) return;
        load();
        rbacAPI.users().then(setUsers).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId]);

    const userMap = useMemo(() => {
        const m: Record<number, string> = {};
        users.forEach(u => { m[u.id] = u.username; });
        return m;
    }, [users]);

    const setStatus = async (status: CaseStatus) => {
        if (!data) return;
        try { await casesAPI.patch(data.id, { status } as any); toast.success(`Status → ${status}`); load(); }
        catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };
    const setSeverity = async (severity: IncidentSeverity) => {
        if (!data) return;
        try { await casesAPI.patch(data.id, { severity } as any); load(); }
        catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };
    const setTlp = async (tlp: Tlp) => {
        if (!data) return;
        try { await casesAPI.patch(data.id, { tlp } as any); load(); }
        catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const addNote = async () => {
        if (!data || !note.trim()) return;
        try {
            await casesAPI.addEvent(data.id, { kind: 'note', content: note.trim() });
            setNote(''); toast.success('Note added'); load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    const uploadEvidence = async (file: File) => {
        if (!data) return;
        setUploading(true);
        try {
            await casesAPI.uploadEvidence(data.id, file, evDescription || undefined);
            setEvDescription('');
            toast.success('Evidence uploaded');
            load();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Upload failed');
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const remove = async () => {
        if (!data) return;
        if (!confirm(`Delete case #${data.id} and all its evidence?`)) return;
        try {
            await casesAPI.delete(data.id);
            toast.success('Case deleted');
            navigate('/cases');
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    if (Number.isNaN(caseId)) {
        return <SocPage eyebrow="Case" title="Invalid case id"><SocCard>—</SocCard></SocPage>;
    }

    return (
        <SocPage
            eyebrow={`Case #${caseId}`}
            title={data ? <span className="text-white">{data.title}</span> : <span className="text-ui-muted">Loading…</span>}
            subtitle={data ? <>Created {fmtDateTime(data.created_at)} · Updated {timeAgo(data.updated_at)}</> : null}
            actions={
                <>
                    <button onClick={() => navigate('/cases')} className="chip chip-base"><ArrowLeft size={14} /> Back</button>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="case.delete">
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
                    {/* Main column */}
                    <div className="lg:col-span-2 space-y-5">
                        <SocCard>
                            <div className="flex items-center gap-2 mb-3 flex-wrap">
                                <SeverityChip severity={data.severity} />
                                <CaseStatusChip status={data.status} />
                                <TlpChip tlp={data.tlp} />
                                {data.thehive_case_id && (
                                    <span className="chip chip-base">TheHive: {data.thehive_case_id}</span>
                                )}
                            </div>
                            {data.summary
                                ? <p className="text-sm text-slate-300 whitespace-pre-wrap">{data.summary}</p>
                                : <p className="text-sm text-ui-subtle italic">No summary.</p>}
                        </SocCard>

                        {/* Evidence */}
                        <SocCard>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                    <Paperclip size={14} /> Evidence
                                </h3>
                                <span className="text-[10px] text-ui-subtle">{data.evidence.length} item{data.evidence.length === 1 ? '' : 's'}</span>
                            </div>

                            <PermissionGate permission="case.evidence.upload">
                                <div className="border border-dashed border-ui-border/40 rounded-xl p-4 mb-4">
                                    <input
                                        ref={fileRef} type="file"
                                        onChange={(e) => e.target.files?.[0] && uploadEvidence(e.target.files[0])}
                                        className="hidden"
                                    />
                                    <input
                                        value={evDescription}
                                        onChange={e => setEvDescription(e.target.value)}
                                        placeholder="Optional description"
                                        className="soc-input mb-2"
                                    />
                                    <button
                                        onClick={() => fileRef.current?.click()}
                                        disabled={uploading}
                                        className="chip chip-base hover:bg-brand-primary/15 hover:text-brand-primary-bright">
                                        <UploadCloud size={14} /> {uploading ? 'Uploading…' : 'Pick file & upload'}
                                    </button>
                                </div>
                            </PermissionGate>

                            {data.evidence.length === 0 ? (
                                <p className="text-sm text-ui-subtle italic">No evidence attached yet.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {data.evidence.map(ev => (
                                        <li key={ev.id}
                                            className="border border-ui-border/30 rounded-lg p-3 hover:bg-white/[0.02]">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-white font-medium truncate">{ev.name}</div>
                                                    <div className="text-[11px] text-ui-subtle flex gap-3 mt-0.5 flex-wrap">
                                                        <span>{fmtBytes(ev.size_bytes)}</span>
                                                        {ev.mime_type && <span>{ev.mime_type}</span>}
                                                        {ev.sha256 && <code className="font-mono">sha256:{ev.sha256.slice(0, 12)}…</code>}
                                                    </div>
                                                    {ev.description && <div className="text-xs text-ui-muted mt-1">{ev.description}</div>}
                                                </div>
                                                <div className="flex gap-1.5 flex-shrink-0">
                                                    <button onClick={() => casesAPI.downloadEvidence(data.id, ev.id, ev.name)}
                                                        className="chip chip-base"><Download size={12} /></button>
                                                    <PermissionGate permission="case.delete">
                                                        <button onClick={async () => {
                                                            if (!confirm('Delete this evidence file?')) return;
                                                            try { await casesAPI.deleteEvidence(data.id, ev.id); toast.success('Deleted'); load(); }
                                                            catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
                                                        }} className="chip chip-base hover:text-neon-red hover:border-neon-red/40">
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </PermissionGate>
                                                </div>
                                            </div>
                                            {ev.custody_log.length > 0 && (
                                                <details className="mt-2">
                                                    <summary className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle cursor-pointer hover:text-white">
                                                        chain of custody ({ev.custody_log.length})
                                                    </summary>
                                                    <ol className="mt-2 text-[11px] text-ui-muted space-y-1">
                                                        {ev.custody_log.map((c, i) => (
                                                            <li key={i} className="flex gap-2">
                                                                <span className="text-ui-subtle">{fmtDateTime(c.at)}</span>
                                                                <span className="text-brand-primary-bright">{c.action}</span>
                                                                <span>by {c.by_email || `user#${c.by_user_id}`}</span>
                                                                {c.note && <span className="text-ui-subtle">— {c.note}</span>}
                                                            </li>
                                                        ))}
                                                    </ol>
                                                </details>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SocCard>

                        {/* Timeline */}
                        <SocCard>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Timeline</h3>
                                <span className="text-[10px] text-ui-subtle">{data.events.length} events</span>
                            </div>
                            <PermissionGate permission="case.update">
                                <div className="flex gap-2 mb-4">
                                    <input value={note} onChange={e => setNote(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && addNote()}
                                        placeholder="Add a note to the timeline…" className="soc-input flex-1" />
                                    <button onClick={addNote} disabled={!note.trim()}
                                        className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30 disabled:opacity-40">
                                        <MessageSquarePlus size={14} /> Note
                                    </button>
                                </div>
                            </PermissionGate>
                            {data.events.length === 0 && (
                                <p className="text-sm text-ui-subtle italic">No events yet.</p>
                            )}
                            <ol className="space-y-3">
                                {data.events.slice().reverse().map(ev => (
                                    <li key={ev.id} className="border-l-2 border-brand-primary/30 pl-3">
                                        <div className="flex items-baseline gap-2 text-xs">
                                            <span className="font-mono text-ui-muted uppercase tracking-wider">{ev.kind}</span>
                                            <span className="text-ui-subtle">{fmtDateTime(ev.created_at)}</span>
                                            {ev.user_id && <span className="text-ui-muted">by {userMap[ev.user_id] || `#${ev.user_id}`}</span>}
                                        </div>
                                        {ev.content && (
                                            <div className="text-sm text-slate-200 mt-1 whitespace-pre-wrap">{ev.content}</div>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        </SocCard>
                    </div>

                    {/* Side column */}
                    <div className="space-y-5">
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Status</div>
                            <div className="space-y-2">
                                {STATUSES.map(s => {
                                    const active = s === data.status;
                                    const disabled = !hasPermission('case.update');
                                    return (
                                        <button key={s}
                                            onClick={() => !active && setStatus(s)}
                                            disabled={active || disabled}
                                            className={`w-full text-left px-3 py-2 rounded-lg border transition-colors text-xs
                                                ${active
                                                    ? 'bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40'
                                                    : 'border-ui-border/30 text-ui-muted hover:bg-white/[0.04] hover:text-white'}
                                                ${disabled && !active ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                            <span className="font-mono uppercase tracking-wider">{s.replace('_', ' ')}</span>
                                            {active && <ChevronRight size={12} className="inline ml-1" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </SocCard>

                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Severity</div>
                            <select value={data.severity} onChange={e => setSeverity(e.target.value as IncidentSeverity)}
                                disabled={!hasPermission('case.update')} className="soc-input">
                                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </SocCard>

                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">TLP</div>
                            <select value={data.tlp} onChange={e => setTlp(e.target.value as Tlp)}
                                disabled={!hasPermission('case.update')} className="soc-input">
                                {TLPS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </SocCard>

                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Lifecycle</div>
                            <dl className="text-xs space-y-1.5">
                                <div className="flex justify-between gap-3"><dt className="text-ui-subtle">Created</dt><dd>{fmtDateTime(data.created_at)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-ui-subtle">Updated</dt><dd>{fmtDateTime(data.updated_at)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-ui-subtle">Closed</dt><dd>{fmtDateTime(data.closed_at)}</dd></div>
                            </dl>
                        </SocCard>
                    </div>
                </div>
            )}
        </SocPage>
    );
}
