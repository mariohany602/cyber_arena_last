import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
    X, CheckCircle2, AlertCircle, Clock, Loader2,
    ZoomIn, ZoomOut, Maximize2, Minus, Plus,
    Workflow, Activity, Hourglass, Zap, Code2, Globe, Database,
    Mail, Filter, Webhook, GitBranch, FileJson, Settings2,
    ChevronRight, Copy, Check,
} from 'lucide-react';
import api from '../../utils/api';
import { fmtDateTime } from './SocLayout';

interface N8nViewerProps {
    executionId: string;
    onClose: () => void;
}

type NodeStatus = 'success' | 'error' | 'running' | 'pending';

// Node dimensions used for layout + edge routing.
const NODE_W = 280;
const NODE_H = 112;
// Floor for auto-fit zoom — text becomes unreadable below this.
const MIN_FIT_SCALE = 0.75;

// Map n8n node type → icon + accent. Falls back to the workflow icon.
function nodeMeta(type: string): { Icon: React.ComponentType<any>; tone: string } {
    const t = (type || '').toLowerCase();
    if (t.includes('webhook'))                        return { Icon: Webhook,    tone: 'cyan' };
    if (t.includes('http'))                           return { Icon: Globe,      tone: 'blue' };
    if (t.includes('code') || t.includes('function')) return { Icon: Code2,      tone: 'purple' };
    if (t.includes('if') || t.includes('switch'))     return { Icon: GitBranch,  tone: 'yellow' };
    if (t.includes('filter'))                         return { Icon: Filter,     tone: 'yellow' };
    if (t.includes('set'))                            return { Icon: Settings2,  tone: 'magenta' };
    if (t.includes('email') || t.includes('mail'))    return { Icon: Mail,       tone: 'magenta' };
    if (t.includes('db') || t.includes('sql') ||
        t.includes('postgres') || t.includes('mongo')) return { Icon: Database,  tone: 'blue' };
    if (t.includes('json'))                           return { Icon: FileJson,   tone: 'purple' };
    if (t.includes('trigger') || t.includes('cron'))  return { Icon: Zap,        tone: 'cyan' };
    return { Icon: Workflow, tone: 'primary' };
}

// Tone → tailwind colour helpers. Keeps node styling consistent + readable.
const TONE: Record<string, { ring: string; text: string; bgGlow: string; stroke: string }> = {
    primary: { ring: 'ring-brand-primary/40',    text: 'text-brand-primary-bright', bgGlow: 'shadow-glow-primary',   stroke: '#00E5A8' },
    cyan:    { ring: 'ring-neon-cyan/40',        text: 'text-neon-cyan',            bgGlow: 'shadow-glow-cyan',      stroke: '#5BC0EB' },
    blue:    { ring: 'ring-neon-blue/40',        text: 'text-neon-blue',            bgGlow: 'shadow-glow-blue',      stroke: '#7C8CFF' },
    purple:  { ring: 'ring-neon-purple/40',      text: 'text-neon-purple',          bgGlow: 'shadow-glow-secondary', stroke: '#A78BFA' },
    magenta: { ring: 'ring-neon-magenta/40',     text: 'text-neon-magenta',         bgGlow: 'shadow-glow-magenta',   stroke: '#E879F9' },
    yellow:  { ring: 'ring-neon-yellow/40',      text: 'text-neon-yellow',          bgGlow: 'shadow-glow-yellow',    stroke: '#F5C84B' },
};

const STATUS_META: Record<NodeStatus, { label: string; chip: string; icon: React.ComponentType<any>; dot: string; edge: string }> = {
    success: { label: 'Success', chip: 'bg-neon-green/15 text-neon-green border-neon-green/40',  icon: CheckCircle2, dot: 'bg-neon-green',  edge: '#00E5A8' },
    error:   { label: 'Failed',  chip: 'bg-neon-red/15 text-neon-red border-neon-red/40',        icon: AlertCircle,  dot: 'bg-neon-red',    edge: '#FF3B6B' },
    running: { label: 'Running', chip: 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/40',     icon: Loader2,      dot: 'bg-neon-cyan',   edge: '#5BC0EB' },
    pending: { label: 'Skipped', chip: 'bg-white/5 text-ui-muted border-ui-border/40',           icon: Hourglass,    dot: 'bg-ui-muted',    edge: '#2A3142' },
};

export default function N8nViewer({ executionId, onClose }: N8nViewerProps) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedNode, setSelectedNode] = useState<any>(null);
    const [sidebarTab, setSidebarTab] = useState<'output' | 'params'>('output');
    const [copied, setCopied] = useState(false);

    // --- fetch ---
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await api.get(`/api/soc/soar/n8n/executions/${executionId}`);
                if (!alive) return;
                setData(res.data.data);
            } catch (err: any) {
                if (!alive) return;
                setError(err.response?.data?.detail || 'Failed to load execution');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [executionId]);

    const nodes: any[]       = data?.workflowData?.nodes || [];
    const connections        = data?.workflowData?.connections || {};
    const runData            = data?.resultData?.runData || {};

    // --- status per node ---
    const getNodeStatus = useCallback((name: string): NodeStatus => {
        const runs = runData[name];
        if (!runs || runs.length === 0) return 'pending';
        const last = runs[runs.length - 1];
        if (last.error || last.executionStatus === 'error') return 'error';
        if (last.executionStatus === 'running') return 'running';
        return 'success';
    }, [runData]);

    // --- aggregate counts for the footer ---
    const counts = useMemo(() => {
        const c = { success: 0, error: 0, running: 0, pending: 0, total: nodes.length, ms: 0 };
        for (const n of nodes) {
            const s = getNodeStatus(n.name);
            c[s] += 1;
            const runs = runData[n.name] || [];
            for (const r of runs) c.ms += r.executionTime || 0;
        }
        return c;
    }, [nodes, runData, getNodeStatus]);

    // --- fit to view (bounds-based) ---
    const fitToView = useCallback(() => {
        if (!nodes.length || !containerRef.current) {
            setScale(1); setPan({ x: 0, y: 0 }); return;
        }
        const xs = nodes.map(n => n.position[0]);
        const ys = nodes.map(n => n.position[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
        const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
        const w = maxX - minX, h = maxY - minY;
        const rect = containerRef.current.getBoundingClientRect();
        const pad = 80;
        const raw = Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h, 1);
        const s = Math.max(MIN_FIT_SCALE, raw);
        setScale(s);
        setPan({
            x: (rect.width  - w * s) / 2 - minX * s,
            y: (rect.height - h * s) / 2 - minY * s,
        });
    }, [nodes]);

    // Auto-fit once nodes arrive.
    useEffect(() => { if (nodes.length) fitToView(); }, [nodes.length, fitToView]);

    // --- interaction handlers ---
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newScale = Math.min(Math.max(0.2, scale * factor), 2.5);
        // Keep the point under the cursor stable while zooming.
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setPan(p => ({
            x: cx - (cx - p.x) * (newScale / scale),
            y: cy - (cy - p.y) * (newScale / scale),
        }));
        setScale(newScale);
    };
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-node]')) return;
        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    };
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setPan({
            x: dragStart.current.px + (e.clientX - dragStart.current.x),
            y: dragStart.current.py + (e.clientY - dragStart.current.y),
        });
    };
    const handleMouseUp = () => setIsDragging(false);

    // --- keyboard shortcuts ---
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { if (selectedNode) setSelectedNode(null); else onClose(); }
            else if (e.key === '+' || e.key === '=') setScale(s => Math.min(2.5, s + 0.15));
            else if (e.key === '-' || e.key === '_') setScale(s => Math.max(0.2, s - 0.15));
            else if (e.key === '0') fitToView();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedNode, onClose, fitToView]);

    if (loading) return (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center" onClick={onClose}>
            <div className="flex items-center gap-3 text-brand-primary-bright text-sm font-mono">
                <Loader2 className="animate-spin" size={20} />
                <span>Loading execution #{executionId}…</span>
            </div>
        </div>
    );

    if (error) return (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6" onClick={onClose}>
            <div className="glass-panel-dark border border-neon-red/40 rounded-2xl p-6 max-w-md w-full">
                <h3 className="font-bold flex items-center gap-2 text-neon-red text-base">
                    <AlertCircle size={18} /> Failed to load execution
                </h3>
                <p className="mt-3 text-sm text-ui-muted">{error}</p>
                <button className="mt-5 chip chip-base w-full justify-center" onClick={onClose}>Close</button>
            </div>
        </div>
    );

    // --- build SVG edges (Bezier, colored by source status) ---
    const edges: JSX.Element[] = [];
    Object.keys(connections).forEach(sourceName => {
        const sourceNode = nodes.find(n => n.name === sourceName);
        if (!sourceNode) return;
        const sStatus = getNodeStatus(sourceName);
        const stroke = STATUS_META[sStatus].edge;
        const isLive = sStatus === 'success' || sStatus === 'error';
        const outputs = connections[sourceName]?.main || [];
        outputs.forEach((outputList: any[], outputIdx: number) => {
            if (!Array.isArray(outputList)) return;
            outputList.forEach((targetRef, i) => {
                const targetNode = nodes.find(n => n.name === targetRef.node);
                if (!targetNode) return;
                const sx = sourceNode.position[0] + NODE_W;
                const sy = sourceNode.position[1] + NODE_H / 2;
                const tx = targetNode.position[0];
                const ty = targetNode.position[1] + NODE_H / 2;
                const dx = Math.max(60, Math.abs(tx - sx) / 2);
                const d  = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
                const key = `${sourceName}-${outputIdx}-${i}-${targetRef.node}`;
                edges.push(
                    <g key={key} opacity={isLive ? 1 : 0.45}>
                        <path d={d} fill="none" stroke={stroke} strokeWidth={3.5} strokeLinecap="round"
                              className="transition-opacity" />
                        {isLive && (
                            <circle r={5} fill={stroke}>
                                <animateMotion dur="2.6s" repeatCount="indefinite" path={d} />
                            </circle>
                        )}
                    </g>
                );
            });
        });
    });

    const wfName     = data?.workflowData?.name || 'Workflow';
    const startedAt  = data?.startedAt;
    const stoppedAt  = data?.stoppedAt;
    const wfStatus: NodeStatus =
        data?.status === 'error' || data?.status === 'failed' ? 'error' :
        data?.status === 'running' || data?.finished === false ? 'running' :
        data?.status === 'success' ? 'success' : 'pending';
    const wfStatusMeta = STATUS_META[wfStatus];
    const WfStatusIcon = wfStatusMeta.icon;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gradient-main animate-fade-in">
            {/* ─── Header ─── */}
            <div className="h-[72px] shrink-0 border-b border-ui-border/60 bg-ui-surface/70 backdrop-blur-xl
                            flex items-center justify-between px-6 z-30">
                <div className="flex items-center gap-5 min-w-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-brand-soft border border-brand-primary/40
                                        flex items-center justify-center">
                            <Workflow size={18} className="text-brand-primary-bright" />
                        </div>
                        <div className="leading-tight min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">n8n · execution</span>
                                <span className="text-sm font-mono font-bold text-brand-primary-bright">#{executionId}</span>
                            </div>
                            <div className="text-base font-bold text-white truncate max-w-[460px]">{wfName}</div>
                        </div>
                    </div>

                    <div className="h-9 w-px bg-ui-border/60" />

                    <span className={`chip ${wfStatusMeta.chip} text-sm font-semibold gap-1.5 px-3 py-1`}>
                        <WfStatusIcon size={14} className={wfStatus === 'running' ? 'animate-spin' : ''} />
                        {wfStatusMeta.label}
                    </span>
                    {startedAt && (
                        <span className="text-sm font-mono text-slate-300 hidden md:flex items-center gap-1.5">
                            <Clock size={13} /> {fmtDateTime(startedAt)}
                        </span>
                    )}
                    {startedAt && stoppedAt && (
                        <span className="text-sm font-mono text-slate-300 hidden lg:flex items-center gap-1.5">
                            <Activity size={13} />
                            {((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000).toFixed(2)}s
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-ui-surface-2/80 border border-ui-border/50 rounded-lg overflow-hidden">
                        <button onClick={() => setScale(s => Math.max(0.2, s - 0.15))}
                                title="Zoom out (-)"
                                className="px-3 py-2 hover:bg-white/5 text-slate-300 hover:text-white transition-colors">
                            <Minus size={15} />
                        </button>
                        <span className="px-3 text-sm font-mono font-semibold text-slate-200 tabular-nums border-x border-ui-border/50 min-w-[58px] text-center">
                            {Math.round(scale * 100)}%
                        </span>
                        <button onClick={() => setScale(s => Math.min(2.5, s + 0.15))}
                                title="Zoom in (+)"
                                className="px-3 py-2 hover:bg-white/5 text-slate-300 hover:text-white transition-colors">
                            <Plus size={15} />
                        </button>
                    </div>
                    <button onClick={fitToView} title="Fit to view (0)"
                            className="chip chip-base text-sm gap-1.5 px-3 py-2">
                        <Maximize2 size={14} /> Fit
                    </button>
                    <button onClick={onClose} title="Close (Esc)"
                            className="ml-2 w-9 h-9 rounded-full text-slate-300 hover:text-white
                                       bg-white/[0.04] hover:bg-neon-red/20 hover:text-neon-red
                                       border border-ui-border/50 hover:border-neon-red/40
                                       flex items-center justify-center transition-all">
                        <X size={17} />
                    </button>
                </div>
            </div>

            {/* ─── Canvas ─── */}
            <div ref={containerRef}
                 className="flex-1 relative overflow-hidden select-none"
                 onWheel={handleWheel}
                 onMouseDown={handleMouseDown}
                 onMouseMove={handleMouseMove}
                 onMouseUp={handleMouseUp}
                 onMouseLeave={handleMouseUp}
                 style={{
                     cursor: isDragging ? 'grabbing' : 'grab',
                     backgroundColor: '#0A0B0F',
                     backgroundImage: `
                        radial-gradient(circle at 25px 25px, rgba(255,255,255,0.035) 1.5px, transparent 1.5px),
                        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,229,168,0.10), transparent 70%)
                     `,
                     backgroundSize: '32px 32px, 100% 100%',
                 }}>

                <div style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transformOrigin: '0 0',
                    position: 'absolute',
                    inset: 0,
                    willChange: 'transform',
                }}>
                    <svg className="absolute pointer-events-none"
                         style={{ left: -2000, top: -2000, width: 12000, height: 12000, overflow: 'visible' }}>
                        <g transform="translate(2000,2000)">{edges}</g>
                    </svg>

                    {nodes.map(n => {
                        const status   = getNodeStatus(n.name);
                        const sm       = STATUS_META[status];
                        const StatusIcon = sm.icon;
                        const meta     = nodeMeta(n.type);
                        const tone     = TONE[meta.tone];
                        const Icon     = meta.Icon;
                        const isSel    = selectedNode?.name === n.name;
                        const runs     = runData[n.name];
                        const ms       = runs?.[0]?.executionTime;
                        const typeShort = (n.type || '').split('.').pop();

                        return (
                            <div key={n.name} data-node
                                 onClick={(e) => { e.stopPropagation(); setSelectedNode(n); setSidebarTab('output'); }}
                                 style={{
                                     left: n.position[0], top: n.position[1],
                                     width: NODE_W, height: NODE_H,
                                 }}
                                 className={`
                                    absolute rounded-xl border cursor-pointer transition-all duration-200
                                    bg-ui-surface/95 backdrop-blur-sm
                                    ${isSel
                                        ? `ring-2 ${tone.ring} border-transparent scale-[1.03] z-20 ${tone.bgGlow}`
                                        : `border-ui-border/60 hover:border-ui-border-bright hover:scale-[1.02] hover:z-10`}
                                    ${status === 'pending' ? 'opacity-75' : ''}
                                 `}>
                                 {/* left accent stripe based on category */}
                                 <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r ${tone.text.replace('text-', 'bg-')} opacity-80`} />

                                 <div className="h-full flex flex-col px-4 py-3">
                                     <div className="flex items-start gap-3">
                                         <div className={`mt-0.5 shrink-0 w-9 h-9 rounded-lg
                                                          bg-white/[0.05] border border-ui-border/50
                                                          flex items-center justify-center ${tone.text}`}>
                                             <Icon size={18} />
                                         </div>
                                         <div className="flex-1 min-w-0">
                                             <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-slate-400 truncate">
                                                 {typeShort}
                                             </div>
                                             <div className="text-[15px] font-bold text-white truncate leading-snug">
                                                 {n.name}
                                             </div>
                                         </div>
                                         <div className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center ${sm.chip}`}>
                                             <StatusIcon size={12} className={status === 'running' ? 'animate-spin' : ''} />
                                         </div>
                                     </div>

                                     <div className="mt-auto flex items-center justify-between pt-2 border-t border-ui-border/40">
                                         <div className="flex items-center gap-2">
                                             <span className={`w-2 h-2 rounded-full ${sm.dot} ${status === 'running' ? 'animate-pulse' : ''}`} />
                                             <span className="text-[12px] font-semibold uppercase tracking-wider text-slate-300">{sm.label}</span>
                                         </div>
                                         {ms != null && (
                                             <span className="text-[12px] font-mono font-semibold text-slate-200 tabular-nums">
                                                 {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`}
                                             </span>
                                         )}
                                     </div>
                                 </div>

                                 {/* connector dots */}
                                 <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-ui-border-bright border-2 border-ui-bg" />
                                 <span className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-ui-border-bright border-2 border-ui-bg" />
                            </div>
                        );
                    })}
                </div>

                {/* ─── Footer stat bar ─── */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-20
                                flex items-center gap-1 px-2 py-1.5
                                bg-ui-surface/85 backdrop-blur-xl border border-ui-border/50 rounded-xl
                                shadow-glass">
                    <Stat icon={Workflow} label="Nodes"   value={counts.total}   tone="text-white" />
                    <Sep />
                    <Stat icon={CheckCircle2} label="OK"  value={counts.success} tone="text-neon-green" />
                    <Stat icon={AlertCircle}  label="Err" value={counts.error}   tone="text-neon-red" />
                    <Stat icon={Hourglass}    label="Skip" value={counts.pending} tone="text-ui-muted" />
                    <Sep />
                    <Stat icon={Activity}    label="Total"
                          value={counts.ms < 1000 ? `${counts.ms}ms` : `${(counts.ms / 1000).toFixed(2)}s`}
                          tone="text-brand-primary-bright" />
                </div>

                {/* hint */}
                <div className="absolute left-4 bottom-4 z-20 text-[12px] font-mono text-slate-300
                                bg-ui-surface/80 backdrop-blur border border-ui-border/50 rounded-lg px-3 py-2
                                hidden md:flex items-center gap-2">
                    <kbd className="px-1.5 py-0.5 bg-ui-bg/60 border border-ui-border/50 rounded text-slate-100 text-[11px]">drag</kbd> pan
                    <kbd className="px-1.5 py-0.5 bg-ui-bg/60 border border-ui-border/50 rounded text-slate-100 text-[11px]">scroll</kbd> zoom
                    <kbd className="px-1.5 py-0.5 bg-ui-bg/60 border border-ui-border/50 rounded text-slate-100 text-[11px]">0</kbd> fit
                    <kbd className="px-1.5 py-0.5 bg-ui-bg/60 border border-ui-border/50 rounded text-slate-100 text-[11px]">esc</kbd> close
                </div>
            </div>

            {/* ─── Details sidebar ─── */}
            {selectedNode && (() => {
                const status = getNodeStatus(selectedNode.name);
                const sm = STATUS_META[status];
                const meta = nodeMeta(selectedNode.type);
                const tone = TONE[meta.tone];
                const Icon = meta.Icon;
                const StatusIcon = sm.icon;
                const runs = runData[selectedNode.name] || [];
                const totalMs = runs.reduce((acc: number, r: any) => acc + (r.executionTime || 0), 0);

                const sidebarPayload = sidebarTab === 'output'
                    ? runs.map((r: any) => r.data ?? r.error ?? null)
                    : selectedNode.parameters ?? {};
                const payloadText = JSON.stringify(sidebarPayload, null, 2);

                return (
                    <div className="absolute right-0 top-[72px] bottom-0 w-[480px] z-30
                                    flex flex-col border-l border-ui-border/60
                                    bg-ui-surface/95 backdrop-blur-xl shadow-glass-lg
                                    animate-slide-up">
                        {/* sidebar head */}
                        <div className="shrink-0 px-5 py-5 border-b border-ui-border/50 bg-gradient-surface">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-12 h-12 rounded-xl border border-ui-border/50
                                                     bg-white/[0.05] flex items-center justify-center ${tone.text}`}>
                                        <Icon size={22} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-slate-400 truncate">
                                            {(selectedNode.type || '').split('.').pop()}
                                        </div>
                                        <div className="text-lg font-bold text-white truncate leading-tight">{selectedNode.name}</div>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedNode(null)}
                                        className="w-8 h-8 rounded-full text-slate-300 hover:text-white
                                                   bg-white/[0.04] hover:bg-white/10 border border-ui-border/50
                                                   flex items-center justify-center transition-colors shrink-0">
                                    <X size={15} />
                                </button>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className={`chip ${sm.chip} text-sm font-semibold gap-1.5 px-3 py-1`}>
                                    <StatusIcon size={13} className={status === 'running' ? 'animate-spin' : ''} />
                                    {sm.label}
                                </span>
                                {totalMs > 0 && (
                                    <span className="chip chip-base text-sm font-semibold gap-1.5 px-3 py-1">
                                        <Activity size={13} />
                                        {totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(2)}s`}
                                    </span>
                                )}
                                <span className="chip chip-base text-sm font-semibold gap-1.5 px-3 py-1">
                                    <ChevronRight size={13} /> {runs.length} run{runs.length === 1 ? '' : 's'}
                                </span>
                            </div>

                            {/* tabs */}
                            <div className="mt-4 flex items-center gap-1 p-1 bg-ui-bg/60 rounded-lg border border-ui-border/50 w-fit">
                                {(['output', 'params'] as const).map(tab => (
                                    <button key={tab}
                                            onClick={() => setSidebarTab(tab)}
                                            className={`text-sm font-semibold uppercase tracking-wider px-4 py-1.5 rounded-md transition-colors
                                                ${sidebarTab === tab
                                                    ? 'bg-brand-primary/20 text-brand-primary-bright shadow-sm'
                                                    : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'}`}>
                                        {tab === 'output' ? 'Output' : 'Parameters'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* sidebar body */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-4">
                            {sidebarTab === 'output' && runs.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <Hourglass size={32} className="text-slate-400 mb-3" />
                                    <div className="text-base font-semibold text-slate-200">No execution data</div>
                                    <div className="text-sm text-slate-400 mt-1">
                                        This node didn't run in execution #{executionId}.
                                    </div>
                                </div>
                            )}

                            {sidebarTab === 'output' && runs.map((run: any, i: number) => (
                                <div key={i} className="border border-ui-border/50 rounded-xl overflow-hidden bg-ui-bg/60">
                                    <div className="bg-white/[0.04] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.2em]
                                                    text-slate-200 border-b border-ui-border/40
                                                    flex justify-between items-center">
                                        <span>Run {i + 1}</span>
                                        <span className="font-mono text-slate-300 normal-case tracking-normal text-sm">
                                            {run.executionTime != null && (
                                                <>{run.executionTime < 1000 ? `${run.executionTime}ms` : `${(run.executionTime / 1000).toFixed(2)}s`}</>
                                            )}
                                        </span>
                                    </div>
                                    <div className="p-4">
                                        {run.error ? (
                                            <pre className="text-[13px] leading-relaxed font-mono text-neon-red bg-neon-red/[0.08]
                                                            border border-neon-red/40 rounded-lg p-3 overflow-x-auto
                                                            whitespace-pre-wrap break-words">
                                                {typeof run.error === 'string' ? run.error : JSON.stringify(run.error, null, 2)}
                                            </pre>
                                        ) : (
                                            <pre className="text-[13px] leading-relaxed font-mono text-slate-100 overflow-x-auto
                                                            whitespace-pre-wrap break-words max-h-[420px]">
                                                {JSON.stringify(run.data, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {sidebarTab === 'params' && (
                                <div className="border border-ui-border/50 rounded-xl overflow-hidden bg-ui-bg/60">
                                    <div className="bg-white/[0.04] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.2em]
                                                    text-slate-200 border-b border-ui-border/40">
                                        Node configuration
                                    </div>
                                    <pre className="text-[13px] leading-relaxed font-mono text-slate-100 p-4 overflow-x-auto
                                                    whitespace-pre-wrap break-words">
                                        {JSON.stringify(selectedNode.parameters ?? {}, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>

                        {/* sidebar footer with copy */}
                        <div className="shrink-0 px-5 py-3 border-t border-ui-border/50 bg-ui-bg/40 flex justify-end">
                            <button onClick={() => {
                                navigator.clipboard.writeText(payloadText);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            }}
                                className="chip chip-base text-sm gap-1.5 px-3 py-1.5">
                                {copied ? <><Check size={14} className="text-neon-green" /> Copied</>
                                        : <><Copy size={14} /> Copy JSON</>}
                            </button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

// ── small footer-bar primitives ───────────────────────────────────────────
function Stat({ icon: Icon, label, value, tone }:
              { icon: React.ComponentType<any>; label: string; value: number | string; tone: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
            <Icon size={14} className={tone} />
            <span className={`text-sm font-bold tabular-nums ${tone}`}>{value}</span>
            <span className="text-[12px] uppercase font-semibold tracking-wider text-slate-300">{label}</span>
        </div>
    );
}
function Sep() { return <span className="w-px h-5 bg-ui-border/60 mx-1" />; }
