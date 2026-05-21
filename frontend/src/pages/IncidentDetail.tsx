/**
 * Incident detail — full investigation view with timeline, status workflow,
 * assignment, notes, related alerts/incidents/MITRE techniques. Part of
 * module 1 (Incident Management).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, MessageSquarePlus, RefreshCw, Trash2, UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
    incidentsAPI, rbacAPI,
} from '../utils/api';
import type {
    IncidentDetail as IncidentDetailType,
    IncidentSeverity, IncidentStatus,
} from '../utils/api';
import {
    SocPage, SocCard, SeverityChip, IncidentStatusChip,
    PermissionGate, timeAgo, fmtDateTime,
} from '../components/soc/SocLayout';
import { useAuth } from '../context/AuthContext';

const STATUSES: IncidentStatus[] = ['open', 'investigating', 'escalated', 'resolved', 'closed'];
const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export default function IncidentDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const incidentId = Number(id);

    const [data, setData] = useState<IncidentDetailType | null>(null);
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<Array<{ id: number; username: string; email: string }>>([]);
    const [note, setNote] = useState('');
    const [addingNote, setAddingNote] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const d = await incidentsAPI.get(incidentId);
            setData(d);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to load incident');
        } finally { setLoading(false); }
    };

    useEffect(() => {
        if (Number.isNaN(incidentId)) return;
        load();
        // Users list is admin-only; ignore error.
        rbacAPI.users().then(setUsers).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [incidentId]);

    const userMap = useMemo(() => {
        const m: Record<number, string> = {};
        for (const u of users) m[u.id] = u.username;
        return m;
    }, [users]);

    const setStatus = async (status: IncidentStatus) => {
        if (!data) return;
        try {
            await incidentsAPI.changeStatus(data.id, status);
            toast.success(`Status → ${status}`);
            load();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Status change failed');
        }
    };

    const setSeverity = async (severity: IncidentSeverity) => {
        if (!data) return;
        try {
            await incidentsAPI.patch(data.id, { severity } as any);
            toast.success(`Severity → ${severity}`);
            load();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Severity change failed');
        }
    };

    const setAssignee = async (assigneeId: number | null) => {
        if (!data) return;
        try {
            await incidentsAPI.assign(data.id, assigneeId);
            toast.success(assigneeId ? 'Assignee updated' : 'Unassigned');
            load();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Assignment failed');
        }
    };

    const addNote = async () => {
        if (!data || !note.trim()) return;
        setAddingNote(true);
        try {
            await incidentsAPI.addEvent(data.id, { kind: 'note', content: note.trim() });
            setNote('');
            toast.success('Note added');
            load();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Failed to add note');
        } finally { setAddingNote(false); }
    };

    const remove = async () => {
        if (!data) return;
        if (!confirm(`Delete incident #${data.id} permanently?`)) return;
        try {
            await incidentsAPI.delete(data.id);
            toast.success('Incident deleted');
            navigate('/incidents');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Delete failed');
        }
    };

    if (Number.isNaN(incidentId)) {
        return (
            <SocPage eyebrow="Incident" title="Invalid incident id">
                <SocCard>
                    <p className="text-ui-muted">The URL is malformed.</p>
                </SocCard>
            </SocPage>
        );
    }

    return (
        <SocPage
            eyebrow={`Incident #${incidentId}`}
            title={
                data
                    ? <span className="text-white">{data.title}</span>
                    : <span className="text-ui-muted">Loading…</span>
            }
            subtitle={data
                ? <>Created {fmtDateTime(data.created_at)} · Updated {timeAgo(data.updated_at)}</>
                : null
            }
            actions={
                <>
                    <button onClick={() => navigate('/incidents')} className="chip chip-base">
                        <ArrowLeft size={14} /> Back
                    </button>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="incident.delete">
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
                            <div className="flex items-center gap-2 mb-3">
                                <SeverityChip severity={data.severity} />
                                <IncidentStatusChip status={data.status} />
                                {data.category && <span className="chip chip-base">{data.category}</span>}
                                {data.source && <span className="chip chip-base">via {data.source}</span>}
                            </div>
                            {data.description ? (
                                <p className="text-sm text-slate-300 whitespace-pre-wrap">{data.description}</p>
                            ) : (
                                <p className="text-sm text-ui-subtle italic">No description.</p>
                            )}

                            {data.mitre_techniques.length > 0 && (
                                <div className="mt-4">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-2">MITRE ATT&amp;CK</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {data.mitre_techniques.map(t => (
                                            <span key={t} className="chip chip-magenta">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {data.related_alert_ids.length > 0 && (
                                <div className="mt-4">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-2">Related alerts</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {data.related_alert_ids.map(a => (
                                            <code key={a} className="text-[11px] bg-white/5 border border-ui-border/30 px-1.5 py-0.5 rounded font-mono text-ui-muted">{a}</code>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </SocCard>

                        {/* Timeline */}
                        <SocCard>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Timeline</h3>
                                <span className="text-[10px] text-ui-subtle">{data.events.length} events</span>
                            </div>

                            <PermissionGate permission="incident.update">
                                <div className="flex gap-2 mb-4">
                                    <input
                                        value={note}
                                        onChange={e => setNote(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && addNote()}
                                        placeholder="Add a note to the timeline…"
                                        className="soc-input flex-1"
                                    />
                                    <button onClick={addNote} disabled={addingNote || !note.trim()}
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
                                        {Object.keys(ev.meta || {}).length > 0 && (
                                            <pre className="text-[11px] text-ui-subtle bg-white/[0.02] border border-ui-border/20 rounded p-2 mt-1.5 overflow-x-auto">
                                                {JSON.stringify(ev.meta, null, 2)}
                                            </pre>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        </SocCard>

                        {data.resolution && (
                            <SocCard>
                                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-2">Resolution</div>
                                <p className="text-sm text-slate-200 whitespace-pre-wrap">{data.resolution}</p>
                            </SocCard>
                        )}
                    </div>

                    {/* Side column */}
                    <div className="space-y-5">
                        {/* Status workflow */}
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Status</div>
                            <div className="space-y-2">
                                {STATUSES.map(s => {
                                    const active = s === data.status;
                                    const disabled = !hasPermission('incident.update') ||
                                        (s === 'resolved' && !hasPermission('incident.resolve'));
                                    return (
                                        <button key={s}
                                            onClick={() => !active && setStatus(s)}
                                            disabled={active || disabled}
                                            className={`w-full text-left px-3 py-2 rounded-lg border transition-colors text-xs
                                                ${active
                                                    ? 'bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40'
                                                    : 'border-ui-border/30 text-ui-muted hover:bg-white/[0.04] hover:text-white'}
                                                ${disabled && !active ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                            <span className="font-mono uppercase tracking-wider">{s}</span>
                                            {active && <ChevronRight size={12} className="inline ml-1" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </SocCard>

                        {/* Severity */}
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Severity</div>
                            <select
                                value={data.severity}
                                onChange={e => setSeverity(e.target.value as IncidentSeverity)}
                                disabled={!hasPermission('incident.update')}
                                className="soc-input"
                            >
                                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </SocCard>

                        {/* Assignment */}
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3 flex items-center gap-2">
                                <UserPlus size={12} /> Assignee
                            </div>
                            <select
                                value={data.assignee_id ?? ''}
                                onChange={e => setAssignee(e.target.value ? Number(e.target.value) : null)}
                                disabled={!hasPermission('incident.assign')}
                                className="soc-input"
                            >
                                <option value="">Unassigned</option>
                                {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                            </select>
                            {users.length === 0 && (
                                <p className="text-[11px] text-ui-subtle mt-2">
                                    User list requires admin role to view.
                                </p>
                            )}
                        </SocCard>

                        {/* Metadata */}
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Lifecycle</div>
                            <dl className="text-xs space-y-1.5">
                                <Row k="Detected"     v={fmtDateTime(data.detected_at)} />
                                <Row k="Acknowledged" v={fmtDateTime(data.acknowledged_at)} />
                                <Row k="Resolved"     v={fmtDateTime(data.resolved_at)} />
                                <Row k="Closed"       v={fmtDateTime(data.closed_at)} />
                            </dl>
                        </SocCard>
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
            <dd className="text-slate-200 text-right">{v}</dd>
        </div>
    );
}
