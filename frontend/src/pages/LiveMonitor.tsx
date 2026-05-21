/**
 * Live Monitor — module 10 of the SOC platform extension.
 *
 * Streams realtime events from /api/soc/realtime/ws and renders them in a
 * filtered, paused-on-hover live feed. Includes per-kind counters and a
 * REST polling fallback for environments where WebSockets are blocked.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity, AlertTriangle, Briefcase, Bug, Eye, EyeOff, Pause, Play,
    RefreshCw, Workflow, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { realtimeAPI } from '../utils/api';
import type { RealtimeEvent } from '../utils/api';
import {
    SocPage, SocCard, StatCard, timeAgo,
} from '../components/soc/SocLayout';

const KIND_META: Record<string, { icon: any; color: string; label: string }> = {
    'incident.created':  { icon: AlertTriangle, color: 'text-neon-red',     label: 'Incident created' },
    'incident.updated':  { icon: AlertTriangle, color: 'text-neon-yellow',  label: 'Incident updated' },
    'incident.event':    { icon: AlertTriangle, color: 'text-ui-muted',     label: 'Incident event' },
    'soar.dispatched':   { icon: Workflow,      color: 'text-neon-cyan',    label: 'SOAR action' },
    'soar.updated':      { icon: Workflow,      color: 'text-neon-cyan',    label: 'SOAR update' },
    'alert.triage':      { icon: Zap,           color: 'text-neon-magenta', label: 'Alert triage' },
    'case.created':      { icon: Briefcase,     color: 'text-brand-primary-bright', label: 'Case opened' },
    'case.event':        { icon: Briefcase,     color: 'text-ui-muted',     label: 'Case event' },
    'ioc.created':       { icon: Bug,           color: 'text-neon-yellow',  label: 'IOC added' },
};

const MAX_EVENTS = 500;

export default function LiveMonitor() {
    const [events, setEvents] = useState<RealtimeEvent[]>([]);
    const [paused, setPaused] = useState(false);
    const [connected, setConnected] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
    const [filterKind, setFilterKind] = useState<string>('');
    const wsRef = useRef<WebSocket | null>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    // Connect on mount; reconnect on close with exponential backoff capped at 30s.
    useEffect(() => {
        let backoff = 1000;
        let killed = false;
        let pollTimer: number | undefined;

        const startPolling = () => {
            // Fallback when WS keeps failing: poll the REST endpoint every 5s.
            if (pollTimer) return;
            pollTimer = window.setInterval(async () => {
                if (pausedRef.current) return;
                try {
                    const r = await realtimeAPI.recent(100);
                    setEvents(prev => mergeUnique(prev, r.items));
                } catch { /* ignore */ }
            }, 5000);
        };

        const connect = () => {
            if (killed) return;
            try {
                const url = realtimeAPI.wsUrl();
                const ws = new WebSocket(url);
                wsRef.current = ws;
                setConnected('connecting');

                ws.onopen = () => {
                    setConnected('open');
                    backoff = 1000;
                };
                ws.onmessage = (m) => {
                    if (pausedRef.current) return;
                    try {
                        const evt = JSON.parse(m.data);
                        if (evt.kind === 'hello') return;
                        setEvents(prev => [evt, ...prev].slice(0, MAX_EVENTS));
                    } catch { /* ignore malformed events */ }
                };
                ws.onerror = () => { setConnected('error'); };
                ws.onclose = (e) => {
                    setConnected('closed');
                    if (killed) return;
                    if (e.code === 4401) {
                        toast.error('Realtime: unauthorized (re-login needed)');
                        startPolling();
                        return;
                    }
                    // Reconnect with exponential backoff.
                    setTimeout(connect, backoff);
                    backoff = Math.min(30000, backoff * 2);
                    startPolling();    // also fall back to polling while we wait
                };
            } catch (e: any) {
                setConnected('error');
                startPolling();
            }
        };

        connect();
        return () => {
            killed = true;
            wsRef.current?.close();
            if (pollTimer) window.clearInterval(pollTimer);
        };
    }, []);

    const counts = useMemo(() => {
        const m: Record<string, number> = {};
        for (const e of events) m[e.kind] = (m[e.kind] || 0) + 1;
        return m;
    }, [events]);

    const filtered = useMemo(() => {
        if (!filterKind) return events;
        return events.filter(e => e.kind === filterKind);
    }, [events, filterKind]);

    const refreshHistory = async () => {
        try {
            const r = await realtimeAPI.recent(MAX_EVENTS);
            setEvents(mergeUnique([], r.items.slice().reverse()));
            toast.success(`Loaded ${r.items.length} historical events`);
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    return (
        <SocPage
            eyebrow="Realtime monitoring"
            title={<><span className="text-white">Live </span><span className="text-gradient-brand">Feed</span></>}
            subtitle={
                <span className="flex items-center gap-2">
                    <ConnectionDot status={connected} />
                    {connected === 'open' ? 'connected' :
                     connected === 'connecting' ? 'connecting…' :
                     connected === 'closed' ? 'reconnecting…' : 'using polling fallback'}
                    {' · '}{events.length} event{events.length === 1 ? '' : 's'} buffered
                </span>
            }
            actions={
                <>
                    <button onClick={refreshHistory} className="chip chip-base">
                        <RefreshCw size={14} /> Load history
                    </button>
                    <button onClick={() => setPaused(p => !p)}
                        className={`chip ${paused ? 'chip-yellow' : 'chip-base'}`}>
                        {paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
                    </button>
                </>
            }
        >
            {/* Per-kind counters */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <StatCard label="Total" value={events.length} />
                <StatCard label="Incidents"  value={(counts['incident.created'] || 0) + (counts['incident.updated'] || 0)} tone="danger" />
                <StatCard label="Triage"     value={counts['alert.triage'] || 0} tone="warn" />
                <StatCard label="SOAR"       value={(counts['soar.dispatched'] || 0) + (counts['soar.updated'] || 0)} tone="info" />
                <StatCard label="Cases"      value={(counts['case.created'] || 0) + (counts['case.event'] || 0)} tone="positive" />
                <StatCard label="IOCs"       value={counts['ioc.created'] || 0} />
            </div>

            <SocCard padding="p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setFilterKind('')}
                        className={`chip ${filterKind === '' ? 'chip-primary' : 'chip-base'}`}>All</button>
                    {Object.keys(KIND_META).map(k => (
                        <button key={k} onClick={() => setFilterKind(k === filterKind ? '' : k)}
                            className={`chip ${k === filterKind ? 'chip-primary' : 'chip-base'}`}>
                            {KIND_META[k].label} ({counts[k] || 0})
                        </button>
                    ))}
                </div>
            </SocCard>

            <SocCard padding="p-0">
                <div className="px-5 py-3 border-b border-ui-border/30 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Activity size={14} /> Event stream
                    </h3>
                    {paused
                        ? <span className="chip chip-yellow"><EyeOff size={12} /> paused</span>
                        : <span className="chip chip-green"><Eye size={12} /> streaming</span>}
                </div>

                {filtered.length === 0 ? (
                    <div className="text-center py-16 text-ui-subtle">
                        <Activity className="mx-auto mb-2" size={28} />
                        <p className="text-sm">Waiting for events…</p>
                        <p className="text-[11px] mt-1">Create an incident or run a SOAR action to see live updates.</p>
                    </div>
                ) : (
                    <div className="max-h-[640px] overflow-y-auto custom-scrollbar divide-y divide-ui-border/20">
                        {filtered.map((e, i) => (
                            <EventRow key={`${e.at}-${i}-${e.kind}`} event={e} />
                        ))}
                    </div>
                )}
            </SocCard>
        </SocPage>
    );
}

function ConnectionDot({ status }: { status: 'connecting' | 'open' | 'closed' | 'error' }) {
    const cls =
        status === 'open' ? 'bg-neon-green animate-pulse' :
        status === 'connecting' ? 'bg-neon-yellow animate-pulse' :
        status === 'error' ? 'bg-neon-red' :
        'bg-ui-muted';
    return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`} />;
}

function EventRow({ event: e }: { event: RealtimeEvent }) {
    const meta = KIND_META[e.kind] || {
        icon: Activity,
        color: 'text-ui-muted',
        label: e.kind,
    };
    const Icon = meta.icon;
    return (
        <div className="px-5 py-2.5 hover:bg-white/[0.02] flex items-start gap-3">
            <Icon size={14} className={`mt-0.5 flex-shrink-0 ${meta.color}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">{meta.label}</span>
                    <span className="text-[10px] font-mono text-ui-subtle">{e.kind}</span>
                </div>
                <div className="text-xs text-ui-muted mt-0.5 font-mono break-all">
                    {summarize(e)}
                </div>
            </div>
            <div className="text-[10px] text-ui-subtle font-mono whitespace-nowrap pt-0.5">
                {timeAgo(e.at)}
            </div>
        </div>
    );
}

function summarize(e: RealtimeEvent): string {
    const d = e.data || {};
    switch (e.kind) {
        case 'incident.created':
        case 'incident.updated':
            return `#${d.id} · ${d.severity || 'medium'} · ${d.status || 'open'} · ${d.title || ''}`;
        case 'incident.event':
            return `incident #${d.incident_id} · ${d.kind} · ${d.content || ''}`;
        case 'soar.dispatched':
        case 'soar.updated':
            return `#${d.id} · ${d.action} → ${d.target || '—'} · ${d.status}`;
        case 'alert.triage':
            return `alert ${d.alert_id?.slice(0, 16)}… · ${d.kind}`;
        case 'case.created':
            return `#${d.id} · ${d.severity || 'medium'} · ${d.title || ''}`;
        case 'case.event':
            return `case #${d.case_id} · ${d.kind} · ${d.content || ''}`;
        case 'ioc.created':
            return `#${d.id} · ${d.type}:${d.value} · score=${d.threat_score}`;
        default:
            return JSON.stringify(d);
    }
}

function mergeUnique(prev: RealtimeEvent[], incoming: RealtimeEvent[]): RealtimeEvent[] {
    const seen = new Set(prev.map(e => `${e.at}|${e.kind}|${JSON.stringify(e.data)}`));
    const additions: RealtimeEvent[] = [];
    for (const e of incoming.slice().reverse()) {
        const k = `${e.at}|${e.kind}|${JSON.stringify(e.data)}`;
        if (!seen.has(k)) { additions.unshift(e); seen.add(k); }
    }
    return [...additions, ...prev].slice(0, MAX_EVENTS);
}
