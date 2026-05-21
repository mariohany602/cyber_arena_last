/**
 * Shared layout + primitives for the SOC platform extension (Phase 2).
 *
 * Wraps the existing `Sidebar` so all new SOC pages (Incidents, Cases,
 * Alert Triage, IOC, Hunts, Assets, SOAR, Exec) share the same look and
 * feel as the pre-existing `/soc` page. No global styles are touched.
 */
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import Sidebar from '../layout/Sidebar';
import type {
    IncidentSeverity, IncidentStatus, AlertClassification, CaseStatus, Tlp,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------
export function SocPage({
    eyebrow, title, subtitle, actions, children,
}: {
    eyebrow: string;
    title: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex h-screen bg-ui-bg text-slate-200 font-sans overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col relative overflow-hidden bg-ui-bg">
                <div className="absolute inset-0 bg-grid-white bg-[length:32px_32px] opacity-[0.025] pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-[480px] bg-gradient-glow pointer-events-none" />
                <main className="flex-1 overflow-y-auto p-8 relative z-10 custom-scrollbar">
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-7xl mx-auto space-y-6"
                    >
                        <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
                            <div>
                                <div className="section-eyebrow mb-2">
                                    <span className="w-6 h-px bg-brand-primary/60" />
                                    {eyebrow}
                                </div>
                                <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none">
                                    {title}
                                </h1>
                                {subtitle && (
                                    <p className="text-ui-muted text-sm mt-3">{subtitle}</p>
                                )}
                            </div>
                            {actions && <div className="flex items-center gap-2">{actions}</div>}
                        </div>
                        {children}
                    </motion.div>
                </main>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
export function SocCard({
    children, className = '', padding = 'p-5',
}: { children: ReactNode; className?: string; padding?: string }) {
    return (
        <div className={`glass-panel-dark border border-ui-border/40 rounded-2xl ${padding} ${className}`}>
            {children}
        </div>
    );
}

export function StatCard({
    label, value, hint, tone = 'default',
}: {
    label: string;
    value: ReactNode;
    hint?: string;
    tone?: 'default' | 'positive' | 'warn' | 'danger' | 'info';
}) {
    const toneMap: Record<string, string> = {
        default: 'text-white',
        positive: 'text-neon-green',
        warn: 'text-neon-yellow',
        danger: 'text-neon-red',
        info: 'text-neon-cyan',
    };
    return (
        <SocCard>
            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle">{label}</div>
            <div className={`text-3xl font-black mt-2 ${toneMap[tone]}`}>{value}</div>
            {hint && <div className="text-xs text-ui-muted mt-1">{hint}</div>}
        </SocCard>
    );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------
const SEV_CHIP: Record<IncidentSeverity, string> = {
    critical: 'bg-neon-red/10 text-neon-red border-neon-red/30',
    high:     'bg-neon-magenta/10 text-neon-magenta border-neon-magenta/30',
    medium:   'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
    low:      'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
    info:     'bg-white/5 text-ui-muted border-ui-border/40',
};

const INC_STATUS_CHIP: Record<IncidentStatus, string> = {
    open:          'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
    investigating: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
    escalated:     'bg-neon-red/10 text-neon-red border-neon-red/30',
    resolved:      'bg-neon-green/10 text-neon-green border-neon-green/30',
    closed:        'bg-white/5 text-ui-muted border-ui-border/40',
};

const CASE_STATUS_CHIP: Record<CaseStatus, string> = {
    open:        'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
    in_progress: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
    closed:      'bg-white/5 text-ui-muted border-ui-border/40',
};

const CLASSIFICATION_CHIP: Record<AlertClassification, string> = {
    true_positive:  'bg-neon-red/10 text-neon-red border-neon-red/30',
    false_positive: 'bg-neon-green/10 text-neon-green border-neon-green/30',
    benign:         'bg-white/5 text-ui-muted border-ui-border/40',
    escalated:      'bg-neon-magenta/10 text-neon-magenta border-neon-magenta/30',
    resolved:       'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
};

const TLP_CHIP: Record<Tlp, string> = {
    white: 'bg-white/10 text-white border-white/20',
    green: 'bg-neon-green/10 text-neon-green border-neon-green/30',
    amber: 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30',
    red:   'bg-neon-red/10 text-neon-red border-neon-red/30',
};

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider ${className}`}>
            {children}
        </span>
    );
}

export const SeverityChip = ({ severity }: { severity: IncidentSeverity | string | null | undefined }) => {
    const s = (severity || 'info') as IncidentSeverity;
    return <Chip className={SEV_CHIP[s] || SEV_CHIP.info}>{s}</Chip>;
};

export const IncidentStatusChip = ({ status }: { status: IncidentStatus | string }) => (
    <Chip className={INC_STATUS_CHIP[status as IncidentStatus] || INC_STATUS_CHIP.open}>{String(status).replace('_', ' ')}</Chip>
);

export const CaseStatusChip = ({ status }: { status: CaseStatus | string }) => (
    <Chip className={CASE_STATUS_CHIP[status as CaseStatus] || CASE_STATUS_CHIP.open}>{String(status).replace('_', ' ')}</Chip>
);

export const ClassificationChip = ({ value }: { value: AlertClassification | string | null | undefined }) =>
    value
        ? <Chip className={CLASSIFICATION_CHIP[value as AlertClassification] || ''}>{String(value).replace('_', ' ')}</Chip>
        : <Chip className="bg-white/5 text-ui-subtle border-ui-border/30">untriaged</Chip>;

export const TlpChip = ({ tlp }: { tlp: Tlp | string }) => (
    <Chip className={TLP_CHIP[tlp as Tlp] || TLP_CHIP.amber}>TLP:{String(tlp).toUpperCase()}</Chip>
);

// ---------------------------------------------------------------------------
// Permission gate
// ---------------------------------------------------------------------------
export function PermissionGate({
    permission, fallback = null, children,
}: { permission: string; fallback?: ReactNode; children: ReactNode }) {
    const { hasPermission } = useAuth();
    return hasPermission(permission) ? <>{children}</> : <>{fallback}</>;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
export function timeAgo(iso: string | null | undefined): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.max(1, Math.floor(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export function fmtDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export function fmtBytes(n: number | null | undefined): string {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
