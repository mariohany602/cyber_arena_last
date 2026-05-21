/**
 * Three-pane scaffold for tool pages — Midnight Ops design.
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  ToolLayout chrome (breadcrumb + title + status)                     │
 *  ├──────────┬────────────────────────────────────┬──────────────────────┤
 *  │ params   │ output (live terminal / table)     │ findings (parsed)    │
 *  │ (left)   │ (center)                           │ (right)              │
 *  └──────────┴────────────────────────────────────┴──────────────────────┘
 *
 * Wraps the existing `ToolLayout` so per-tool pages get a consistent shell
 * without duplicating chrome. Slots are plain ReactNodes — each tool page
 * fills the three panes with its own content.
 */

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Play, Square, Loader2, ChevronRight, type LucideIcon } from 'lucide-react';
import ToolLayout from '../layout/ToolLayout';

export interface ToolShellProps {
    /** Page title (e.g. "Nmap"). */
    title: string;
    /** Icon shown in the header chrome. */
    icon?: LucideIcon;
    /** One-line subtitle under the title (engine name, version, etc). */
    subtitle?: string;
    /** Status drives the header chip and run-button affordance. */
    status?: 'idle' | 'running' | 'completed' | 'error';

    /** Optional row of small cards above the three panes (KPIs / summary). */
    summary?: ReactNode;

    /** Left pane — parameter form. */
    params: ReactNode;
    /** Center pane — output area (live terminal, results table, …). */
    output: ReactNode;
    /** Right pane — parsed findings, AssessmentPanel, etc. */
    findings?: ReactNode;

    /** Primary action — usually "Run scan". */
    runLabel?: string;
    onRun?: () => void;
    runDisabled?: boolean;

    /** Secondary action (e.g. "Stop"). Shown only when provided. */
    onStop?: () => void;
}

export default function ToolShell({
    title, icon, subtitle, status = 'idle',
    summary, params, output, findings,
    runLabel = 'Run', onRun, runDisabled, onStop,
}: ToolShellProps) {
    const isRunning = status === 'running';

    return (
        <ToolLayout title={title} icon={icon} status={status}>
            <div className="space-y-5">
                {/* ----- Subtitle + primary actions ----- */}
                <div className="flex flex-wrap items-end justify-between gap-3">
                    {subtitle && (
                        <p className="text-xs text-ui-muted font-mono uppercase tracking-[0.18em]">
                            {subtitle}
                        </p>
                    )}
                    {onRun && (
                        <div className="ml-auto flex items-center gap-2">
                            {onStop && isRunning && (
                                <button
                                    onClick={onStop}
                                    className="cyber-button cyber-button-outline !py-2 !px-4 !text-xs"
                                >
                                    <Square size={12} strokeWidth={3} /> Stop
                                </button>
                            )}
                            <button
                                onClick={onRun}
                                disabled={runDisabled || isRunning}
                                className="cyber-button cyber-button-primary !py-2 !px-4 !text-xs"
                            >
                                {isRunning
                                    ? <><Loader2 size={14} className="animate-spin" /> Running…</>
                                    : <><Play size={12} strokeWidth={3} className="fill-current" /> {runLabel}</>}
                            </button>
                        </div>
                    )}
                </div>

                {/* ----- Optional summary row ----- */}
                {summary && <div>{summary}</div>}

                {/* ----- Three-pane grid ----- */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Left: params */}
                    <motion.aside
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className={`lg:col-span-3 self-start glass-panel p-5 space-y-4`}
                    >
                        {params}
                    </motion.aside>

                    {/* Center: output */}
                    <motion.section
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 }}
                        className={`${findings ? 'lg:col-span-6' : 'lg:col-span-9'} min-w-0`}
                    >
                        {output}
                    </motion.section>

                    {/* Right: findings */}
                    {findings && (
                        <motion.aside
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="lg:col-span-3 space-y-3 self-start"
                        >
                            {findings}
                        </motion.aside>
                    )}
                </div>
            </div>
        </ToolLayout>
    );
}

// ============================================================================
//  Small primitives that go inside the panes — keep tool pages DRY
// ============================================================================

/** Field label + content wrapper for the left "params" pane. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div>
            <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.18em] mb-2 block">
                {label}
            </label>
            {children}
            {hint && <p className="text-[10px] text-ui-subtle mt-1.5">{hint}</p>}
        </div>
    );
}

/** Section heading inside any pane. */
export function PaneHeader({
    title, hint, right,
}: { title: string; hint?: string; right?: ReactNode }) {
    return (
        <div className="flex items-center justify-between mb-3">
            <div>
                <h3 className="text-white font-bold">{title}</h3>
                {hint && <p className="text-[11px] text-ui-muted mt-0.5">{hint}</p>}
            </div>
            {right}
        </div>
    );
}

/** macOS-style window chrome used for the live terminal block. */
export function TerminalCard({
    title, status, children, footer,
}: { title?: string; status?: ReactNode; children: ReactNode; footer?: ReactNode }) {
    return (
        <div className="glass-panel p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ui-border/40 bg-ui-surface/60">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FEBC2E' }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
                {title && (
                    <span className="ml-3 text-[11px] font-mono text-ui-muted truncate">{title}</span>
                )}
                {status && <span className="ml-auto">{status}</span>}
            </div>
            <div className="bg-ui-bg p-4 font-mono text-[12.5px] leading-relaxed text-slate-300 max-h-[460px] overflow-y-auto custom-scrollbar">
                {children}
            </div>
            {footer && (
                <div className="border-t border-ui-border/40 bg-ui-surface/60 px-4 py-2">
                    {footer}
                </div>
            )}
        </div>
    );
}

/** Compact finding card for the right rail. */
export function FindingCard({
    severity, title, location, hint, onClick,
}: {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    location?: string;
    hint?: string;
    onClick?: () => void;
}) {
    const sev: Record<typeof severity, { chip: string; dot: string }> = {
        critical: { chip: 'bg-neon-red/10 text-neon-red border-neon-red/30',     dot: 'bg-neon-red' },
        high:     { chip: 'bg-neon-magenta/10 text-neon-magenta border-neon-magenta/30', dot: 'bg-neon-magenta' },
        medium:   { chip: 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30', dot: 'bg-neon-yellow' },
        low:      { chip: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',   dot: 'bg-neon-cyan' },
        info:     { chip: 'bg-white/5 text-ui-muted border-ui-border/50',         dot: 'bg-ui-muted' },
    };
    const s = sev[severity];
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full text-left p-3 rounded-xl bg-ui-surface-2/50 hover:bg-ui-surface-2 border border-ui-border/40 hover:border-ui-border-bright/60 transition"
        >
            <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border ${s.chip}`}>
                    {severity}
                </span>
                {hint && <span className="ml-auto text-[10px] font-mono text-ui-muted truncate max-w-[140px]">{hint}</span>}
            </div>
            <div className="text-sm font-medium text-white truncate">{title}</div>
            {location && <div className="text-[11px] font-mono text-ui-muted mt-0.5 truncate">{location}</div>}
        </button>
    );
}

/** Empty placeholder for any pane. */
export function EmptyPane({
    icon: Icon, title, body,
}: { icon: LucideIcon; title: string; body?: string }) {
    return (
        <div className="text-center py-12 px-6">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-bright flex items-center justify-center mb-4">
                <Icon size={22} />
            </div>
            <p className="text-white font-bold text-sm">{title}</p>
            {body && <p className="text-ui-muted text-xs mt-1.5 max-w-[24ch] mx-auto">{body}</p>}
        </div>
    );
}

/** Right-rail "Pipe to" toggle block — used by most tools. */
export function PipeTo({
    items, value, onChange,
}: { items: { key: string; label: string; hint?: string }[]; value: Record<string, boolean>; onChange: (key: string, v: boolean) => void; }) {
    return (
        <div className="glass-panel p-4">
            <h3 className="text-white font-bold mb-3 text-sm">Pipe to</h3>
            <div className="space-y-2 text-sm">
                {items.map(it => (
                    <label key={it.key} className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!value[it.key]}
                            onChange={e => onChange(it.key, e.target.checked)}
                            className="accent-brand-primary"
                        />
                        <span>{it.label}</span>
                        {it.hint && <span className="ml-auto text-[11px] text-ui-muted font-mono">{it.hint}</span>}
                    </label>
                ))}
            </div>
        </div>
    );
}

/** Small "→ View" chevron used in card headers. */
export function ChevronCta({ label, onClick }: { label: string; onClick?: () => void }) {
    return (
        <button onClick={onClick} className="chip chip-muted hover:!text-white">
            {label} <ChevronRight size={11} />
        </button>
    );
}
