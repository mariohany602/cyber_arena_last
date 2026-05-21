import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
    Shield, Activity, ChevronRight, ArrowUpRight, ArrowDownRight,
    Crosshair, Search, Bug, Target, AlertTriangle, FileText, Plus,
    Globe, Lock, User as UserIcon,
} from "lucide-react";
import Sidebar from "../components/layout/Sidebar";
import { ServiceStatus } from "../components/dashboard/DashboardWidgets";
import { useAuth } from "../context/AuthContext";
import { scansAPI } from "../utils/api";
import type { ScanSummary } from "../utils/api";

// ============================================================================
//  Severity / tool palette helpers
// ============================================================================

type SevKey = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

const SEV_META: Record<SevKey, { label: string; chip: string; hex: string }> = {
    CRITICAL: { label: "Critical", chip: "bg-neon-red/10 text-neon-red border-neon-red/30",          hex: "#FF3B6B" },
    HIGH:     { label: "High",     chip: "bg-neon-magenta/10 text-neon-magenta border-neon-magenta/30", hex: "#FF8A3D" },
    MEDIUM:   { label: "Medium",   chip: "bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30", hex: "#F5C84B" },
    LOW:      { label: "Low",      chip: "bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30",        hex: "#5BC0EB" },
    INFO:     { label: "Info",     chip: "bg-white/5 text-ui-muted border-ui-border/50",              hex: "#8A93A6" },
};

const TOOL_ICONS: Record<string, any> = {
    nmap: Search, nikto: Bug, sqlmap: Crosshair, ffuf: Target,
    nuclei: Shield, vuln: AlertTriangle, dirs: FileText, subdomain: Globe,
};

function toolIcon(tool: string) {
    const key = tool.toLowerCase();
    for (const k of Object.keys(TOOL_ICONS)) if (key.includes(k)) return TOOL_ICONS[k];
    return Crosshair;
}

function timeAgo(iso: string | null): string {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.max(1, Math.floor(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// ============================================================================
//  Dashboard
// ============================================================================

export default function Dashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [scans, setScans] = useState<ScanSummary[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await scansAPI.list(undefined, 100);
                if (!cancelled) setScans(data);
            } catch {
                /* unauthenticated or empty — leave scans = [] */
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // ---- KPIs (derived) -----------------------------------------------------
    const kpis = useMemo(() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayCount = scans.filter(s => s.created_at && new Date(s.created_at) >= today).length;

        const sevTotals = scans.reduce<Record<SevKey, number>>(
            (acc, s) => {
                (Object.keys(acc) as SevKey[]).forEach(k => acc[k] += s.severity_counts?.[k] ?? 0);
                return acc;
            },
            { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
        );

        const targets = new Set(scans.map(s => s.target).filter(Boolean)).size;
        const avgRisk = scans.length
            ? scans.reduce((a, s) => a + (s.risk_score || 0), 0) / scans.length
            : 0;

        // Build 14-day spark series for the "scans" KPI
        const buckets = Array(14).fill(0);
        const now = new Date(); now.setHours(0, 0, 0, 0);
        scans.forEach(s => {
            if (!s.created_at) return;
            const d = new Date(s.created_at); d.setHours(0, 0, 0, 0);
            const idx = 13 - Math.floor((now.getTime() - d.getTime()) / 86400000);
            if (idx >= 0 && idx < 14) buckets[idx]++;
        });

        return { todayCount, sevTotals, targets, avgRisk, spark: buckets };
    }, [scans]);

    const recent = scans.slice(0, 6);
    const topFindings = [...scans]
        .sort((a, b) => (b.severity_counts.CRITICAL + b.severity_counts.HIGH * 0.5)
                      - (a.severity_counts.CRITICAL + a.severity_counts.HIGH * 0.5))
        .slice(0, 5);

    return (
        <div className="flex h-screen bg-ui-bg text-slate-200 font-sans overflow-hidden">
            <Sidebar />

            <div className="flex-1 flex flex-col relative overflow-hidden bg-ui-bg">
                {/* Ambient background */}
                <div className="absolute inset-0 bg-grid-white bg-[length:32px_32px] opacity-[0.025] pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-[480px] bg-gradient-glow pointer-events-none" />

                <main className="flex-1 overflow-y-auto p-8 relative z-10 custom-scrollbar">
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-7xl mx-auto space-y-6"
                    >
                        {/* ----- Header ----- */}
                        <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
                            <div>
                                <div className="section-eyebrow mb-2">
                                    <span className="w-6 h-px bg-brand-primary/60" />
                                    Operations console
                                </div>
                                <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none">
                                    Welcome back, <span className="text-gradient-brand">{user?.username || "operator"}</span>
                                </h1>
                                <p className="text-ui-muted text-sm mt-3">
                                    {scans.length} scans tracked · {kpis.sevTotals.CRITICAL + kpis.sevTotals.HIGH} unresolved high-risk findings
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="chip chip-green">
                                    <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon-green" />
                                    </span>
                                    Uplink stable
                                </span>
                                <button onClick={() => navigate("/history")} className="cyber-button cyber-button-outline !py-2 !px-4 !text-xs">
                                    History
                                </button>
                                <button onClick={() => navigate("/pentest")} className="cyber-button cyber-button-primary !py-2 !px-4 !text-xs">
                                    <Plus size={14} strokeWidth={3} /> New scan
                                </button>
                            </div>
                        </div>

                        {/* ----- KPI tiles ----- */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <KpiTile
                                label="Scans (14d)"
                                value={scans.length}
                                delta={`+${kpis.todayCount} today`}
                                deltaTone="up"
                                spark={kpis.spark}
                                color="#00E5A8"
                            />
                            <KpiTile
                                label="Critical findings"
                                value={kpis.sevTotals.CRITICAL}
                                delta={kpis.sevTotals.HIGH > 0 ? `${kpis.sevTotals.HIGH} high` : "all clear"}
                                deltaTone={kpis.sevTotals.CRITICAL > 0 ? "down" : "up"}
                                spark={null}
                                bars={[kpis.sevTotals.CRITICAL, kpis.sevTotals.HIGH, kpis.sevTotals.MEDIUM, kpis.sevTotals.LOW]}
                                color="#FF3B6B"
                            />
                            <KpiTile
                                label="Targets seen"
                                value={kpis.targets}
                                delta="unique assets"
                                deltaTone="up"
                                spark={null}
                                bars={[2, 5, 4, 6, 5, 7, 6, 8, 7, 9].map(x => Math.max(1, x * Math.max(1, kpis.targets / 10)))}
                                color="#7C8CFF"
                            />
                            <KpiTile
                                label="Avg risk score"
                                value={kpis.avgRisk.toFixed(1)}
                                delta={kpis.avgRisk > 50 ? "elevated" : "low pressure"}
                                deltaTone={kpis.avgRisk > 50 ? "down" : "up"}
                                spark={Array(14).fill(0).map((_, i) => Math.round(kpis.avgRisk * (0.6 + 0.6 * Math.abs(Math.sin(i)))) )}
                                color="#F5C84B"
                            />
                        </div>

                        {/* ----- Recent scans + Severity donut ----- */}
                        <div className="grid lg:grid-cols-3 gap-4">
                            <div className="glass-panel p-5 lg:col-span-2">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h3 className="font-bold text-white">Recent scans</h3>
                                        <p className="text-ui-muted text-xs mt-0.5">Live engine activity</p>
                                    </div>
                                    <button onClick={() => navigate("/history")} className="chip chip-muted hover:!text-white">
                                        View all <ChevronRight size={11} />
                                    </button>
                                </div>

                                {loading ? (
                                    <SkeletonRows />
                                ) : recent.length === 0 ? (
                                    <EmptyState
                                        icon={Crosshair}
                                        title="No scans yet"
                                        body="Kick off a scan to populate the dashboard."
                                        cta="Open scanner"
                                        onClick={() => navigate("/pentest")}
                                    />
                                ) : (
                                    <div className="space-y-2">
                                        {recent.map((s, i) => <ScanRow key={s.id} s={s} i={i} onOpen={() => navigate("/history")} />)}
                                    </div>
                                )}
                            </div>

                            <div className="glass-panel p-5">
                                <h3 className="font-bold text-white">Findings by severity</h3>
                                <p className="text-ui-muted text-xs mb-4">
                                    {Object.values(kpis.sevTotals).reduce((a, b) => a + b, 0)} total
                                </p>
                                <SeverityDonut totals={kpis.sevTotals} />
                            </div>
                        </div>

                        {/* ----- Top findings + Activity ----- */}
                        <div className="grid lg:grid-cols-3 gap-4">
                            <div className="glass-panel p-5 lg:col-span-2">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-white">Top open findings</h3>
                                    <span className="chip chip-muted">By severity weight</span>
                                </div>
                                {topFindings.length === 0 ? (
                                    <p className="text-ui-muted text-sm text-center py-8">No findings yet.</p>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-[10px] uppercase tracking-widest text-ui-muted">
                                                <th className="py-2 font-semibold">Risk</th>
                                                <th className="font-semibold">Scan</th>
                                                <th className="font-semibold">Target</th>
                                                <th className="font-semibold">Severities</th>
                                                <th className="font-semibold text-right">Age</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {topFindings.map(s => (
                                                <tr
                                                    key={s.id}
                                                    onClick={() => navigate("/history")}
                                                    className="border-t border-ui-border/40 cursor-pointer hover:bg-white/[0.02]"
                                                >
                                                    <td className="py-3 pr-3">
                                                        <span className={`chip ${riskChip(s.risk_score)}`}>{s.risk_label || "—"}</span>
                                                    </td>
                                                    <td className="pr-3 font-medium text-white">{s.tool_label}</td>
                                                    <td className="pr-3 font-mono text-xs text-ui-muted truncate max-w-[180px]">{s.target}</td>
                                                    <td className="pr-3">
                                                        <div className="flex gap-1.5">
                                                            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as SevKey[]).map(k =>
                                                                (s.severity_counts[k] > 0) && (
                                                                    <span key={k} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEV_META[k].chip} border`}>
                                                                        {s.severity_counts[k]} {k[0]}
                                                                    </span>
                                                                )
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="text-right text-xs text-ui-muted">{timeAgo(s.created_at)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            <div className="space-y-4">
                                <ServiceStatus />
                                <ActivityFeed scans={scans.slice(0, 5)} />
                            </div>
                        </div>

                        {/* ----- Quick actions ----- */}
                        <div>
                            <h2 className="section-eyebrow mb-4">
                                <span className="w-6 h-px bg-brand-primary/60" /> Quick actions
                            </h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <QuickTile icon={Crosshair}  title="Pentest"  desc="Launch a new scan"          color="brand-primary"   onClick={() => navigate("/pentest")} />
                                <QuickTile icon={Shield}     title="SOC"      desc="Live SIEM & alerts"         color="brand-secondary" onClick={() => navigate("/soc")} />
                                <QuickTile icon={Lock}       title="Chat"     desc="Encrypted comms"            color="neon-magenta"    onClick={() => navigate("/chat")} />
                                <QuickTile icon={UserIcon}   title="Profile"  desc="Identity & clearance"       color="neon-cyan"       onClick={() => navigate("/profile")} />
                            </div>
                        </div>
                    </motion.div>
                </main>
            </div>
        </div>
    );
}

// ============================================================================
//  Sub-components
// ============================================================================

function riskChip(score: number): string {
    if (score >= 75) return SEV_META.CRITICAL.chip + " border";
    if (score >= 50) return SEV_META.HIGH.chip + " border";
    if (score >= 25) return SEV_META.MEDIUM.chip + " border";
    if (score > 0)   return SEV_META.LOW.chip + " border";
    return SEV_META.INFO.chip + " border";
}

function KpiTile({
    label, value, delta, deltaTone, spark, bars, color,
}: {
    label: string; value: number | string; delta: string;
    deltaTone: "up" | "down"; spark: number[] | null; bars?: number[]; color: string;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-5 lift-card"
        >
            <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-[0.22em]">{label}</p>
            <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black tabular-nums text-white">{value}</span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${deltaTone === "up" ? "text-neon-green" : "text-neon-red"}`}>
                    {deltaTone === "up" ? <ArrowUpRight size={12} strokeWidth={3} /> : <ArrowDownRight size={12} strokeWidth={3} />}
                    {delta}
                </span>
            </div>
            <div className="mt-4 h-[38px]">
                {spark
                    ? <Sparkline values={spark} color={color} />
                    : <Bars values={bars || []} color={color} />}
            </div>
        </motion.div>
    );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
    if (!values.length) return null;
    const max = Math.max(1, ...values);
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`).join(" ");
    const area = `0,30 ${pts} 100,30`;
    return (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-full">
            <polygon points={area} fill={color} opacity="0.12" />
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function Bars({ values, color }: { values: number[]; color: string }) {
    if (!values.length) return null;
    const max = Math.max(1, ...values);
    return (
        <div className="flex items-end gap-1 h-full">
            {values.map((v, i) => (
                <span key={i} className="flex-1 rounded-sm"
                      style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color, opacity: 0.55 + 0.45 * (v / max) }} />
            ))}
        </div>
    );
}

function ScanRow({ s, i, onOpen }: { s: ScanSummary; i: number; onOpen: () => void }) {
    const Icon = toolIcon(s.tool);
    const top: SevKey | null = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as SevKey[])
        .find(k => s.severity_counts[k] > 0) ?? null;
    const isRunning = s.status?.toLowerCase() === "running";

    return (
        <motion.button
            initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={onOpen}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-ui-surface-2/60 hover:bg-ui-surface-2 border border-ui-border/40 hover:border-ui-border-bright/60 transition text-left"
        >
            <span className={`inline-flex h-2 w-2 rounded-full ${isRunning ? "bg-neon-green animate-pulse" : top ? `bg-[${SEV_META[top].hex}]` : "bg-ui-border"}`}
                  style={top ? { backgroundColor: SEV_META[top].hex } : undefined} />
            <span className="chip chip-muted">
                <Icon size={11} strokeWidth={2.5} />
                {s.tool_label}
            </span>
            <span className="font-mono text-sm text-white truncate flex-1">{s.target}</span>
            {top && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEV_META[top].chip}`}>
                    {s.severity_counts[top]} {SEV_META[top].label.toLowerCase()}
                </span>
            )}
            <span className="text-xs text-ui-muted w-20 text-right">{isRunning ? "running" : timeAgo(s.created_at)}</span>
        </motion.button>
    );
}

function SeverityDonut({ totals }: { totals: Record<SevKey, number> }) {
    const order: SevKey[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
    const total = order.reduce((a, k) => a + totals[k], 0);
    if (total === 0) {
        return <p className="text-center text-ui-muted text-sm py-12">No findings recorded.</p>;
    }
    const C = 2 * Math.PI * 15.91;
    let offset = 0;
    return (
        <div className="flex items-center gap-5">
            <svg viewBox="0 0 42 42" width="148" height="148">
                <circle cx="21" cy="21" r="15.91" fill="transparent" stroke="#1F2430" strokeWidth="6" />
                {order.map(k => {
                    const pct = totals[k] / total;
                    if (pct === 0) return null;
                    const dash = pct * C;
                    const el = (
                        <circle key={k} cx="21" cy="21" r="15.91" fill="transparent"
                                stroke={SEV_META[k].hex} strokeWidth="6"
                                strokeDasharray={`${dash} ${C - dash}`}
                                strokeDashoffset={-offset}
                                transform="rotate(-90 21 21)" />
                    );
                    offset += dash;
                    return el;
                })}
                <text x="21" y="20" textAnchor="middle" fill="#fff" fontSize="6" fontWeight="700">{total}</text>
                <text x="21" y="26" textAnchor="middle" fill="#8A93A6" fontSize="3">findings</text>
            </svg>
            <div className="space-y-1.5 text-xs flex-1">
                {order.map(k => (
                    <div key={k} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEV_META[k].hex }} />
                        <span className="text-ui-muted">{SEV_META[k].label}</span>
                        <span className="ml-auto text-white tabular-nums">{totals[k]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ActivityFeed({ scans }: { scans: ScanSummary[] }) {
    return (
        <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white">Activity</h3>
                <span className="chip chip-green">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" /> live
                </span>
            </div>
            {scans.length === 0 ? (
                <p className="text-ui-muted text-sm text-center py-6">Nothing yet.</p>
            ) : (
                <div className="space-y-3 text-sm">
                    {scans.map(s => {
                        const Icon = toolIcon(s.tool);
                        return (
                            <div key={s.id} className="flex gap-3">
                                <div className="w-7 h-7 shrink-0 rounded-full bg-gradient-brand flex items-center justify-center text-ui-bg">
                                    <Icon size={13} strokeWidth={2.5} />
                                </div>
                                <div className="min-w-0">
                                    <p className="leading-snug truncate">
                                        <span className="text-white font-medium">{s.tool_label}</span>
                                        <span className="text-ui-muted"> on </span>
                                        <span className="font-mono text-xs">{s.target}</span>
                                    </p>
                                    <p className="text-[11px] text-ui-muted">{timeAgo(s.created_at)} · {s.status}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function QuickTile({
    icon: Icon, title, desc, color, onClick,
}: { icon: any; title: string; desc: string; color: string; onClick: () => void }) {
    const map: Record<string, { fg: string; bg: string; border: string }> = {
        "brand-primary":   { fg: "text-brand-primary-bright",   bg: "bg-brand-primary/10",   border: "border-brand-primary/30"   },
        "brand-secondary": { fg: "text-brand-secondary-bright", bg: "bg-brand-secondary/10", border: "border-brand-secondary/30" },
        "neon-cyan":       { fg: "text-neon-cyan",              bg: "bg-neon-cyan/10",       border: "border-neon-cyan/30"       },
        "neon-magenta":    { fg: "text-neon-magenta",           bg: "bg-neon-magenta/10",    border: "border-neon-magenta/30"    },
    };
    const c = map[color];
    return (
        <motion.button
            whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className="glass-panel p-5 lift-card text-left group"
        >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border mb-3 transition group-hover:scale-110 ${c.fg} ${c.bg} ${c.border}`}>
                <Icon size={18} strokeWidth={2.2} />
            </div>
            <h4 className="text-white font-bold">{title}</h4>
            <p className="text-ui-muted text-xs mt-0.5">{desc}</p>
            <div className={`mt-3 text-[10px] font-bold uppercase tracking-[0.22em] flex items-center gap-1 ${c.fg} transition group-hover:translate-x-1`}>
                Open <ChevronRight size={11} strokeWidth={3} />
            </div>
        </motion.button>
    );
}

function SkeletonRows() {
    return (
        <div className="space-y-2">
            {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-12 rounded-xl bg-ui-surface-2/40 animate-pulse" />
            ))}
        </div>
    );
}

function EmptyState({
    icon: Icon, title, body, cta, onClick,
}: { icon: any; title: string; body: string; cta: string; onClick: () => void }) {
    return (
        <div className="text-center py-10">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-brand-primary/10 text-brand-primary-bright border border-brand-primary/20 flex items-center justify-center mb-4">
                <Icon size={20} />
            </div>
            <p className="text-white font-bold">{title}</p>
            <p className="text-ui-muted text-sm mt-1">{body}</p>
            <button onClick={onClick} className="cyber-button cyber-button-primary !py-2 !px-4 !text-xs mt-4">{cta}</button>
        </div>
    );
}
