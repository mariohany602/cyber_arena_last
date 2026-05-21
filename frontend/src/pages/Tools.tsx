import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
    Shield, Home, Globe, Network, ShieldAlert, Search, ChevronRight,
    Play, Crosshair, Plus, Zap, ChevronDown,
} from "lucide-react";
import Sidebar from "../components/layout/Sidebar";
import { useAuth } from "../context/AuthContext";
import { tools as ALL_TOOLS } from "../data/tools";
import type { Tool } from "../data/tools";
import { scansAPI, toolsAPI } from "../utils/api";
import type { ScanSummary, ToolHealthEntry } from "../utils/api";

// Maps a frontend Tool.id → the backend health-probe key (matches the
// `tool` value persisted by record_scan / used in TOOL_REGISTRY).
const TOOL_KEY_MAP: Record<string, string> = {
    "nmap-scanner":     "nmap",
    "nikto-scanner":    "nikto",
    "vuln-scanner":     "vuln-scan",
    "nuclei-scanner":   "nuclei",
    "dir-enum":         "directories",
    "subdomain-enum":   "subdomains",
    "web-crawler":      "crawl",
    "traffic-analyzer": "traffic",
    "ffuf":             "ffuf",
    "sqlmap":           "sqlmap",
};

interface ToolsProps { team?: "Red" | "Blue"; }

const CATEGORY_ICON: Record<string, any> = {
    All: Home,
    "Web Tools": Globe,
    Network: Network,
    "Web Security": Shield,
    "Vulnerability Assessment": ShieldAlert,
    "Blue Team": Shield,
};

// Map URL slug to display category name
const CATEGORY_SLUG_MAP: Record<string, string> = {
    'all': 'All',
    'web-tools': 'Web Tools',
    'network': 'Network',
    'web-security': 'Web Security',
    'vulnerability-assessment': 'Vulnerability Assessment',
    'blue-team': 'Blue Team',
};

const CATEGORY_TO_SLUG: Record<string, string> = {
    'All': 'all',
    'Web Tools': 'web-tools',
    'Network': 'network',
    'Web Security': 'web-security',
    'Vulnerability Assessment': 'vulnerability-assessment',
    'Blue Team': 'blue-team',
};

export default function Tools({ team }: ToolsProps) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { categorySlug } = useParams<{ categorySlug?: string }>();

    // Derive category from URL or default to "All"
    const initialCategory = categorySlug ? (CATEGORY_SLUG_MAP[categorySlug] || "All") : "All";
    const [category, setCategory] = useState(initialCategory);
    const [query, setQuery] = useState("");
    const [scans, setScans] = useState<ScanSummary[]>([]);
    const [health, setHealth] = useState<Record<string, ToolHealthEntry>>({});
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // Update category when URL changes
    useEffect(() => {
        if (categorySlug) {
            setCategory(CATEGORY_SLUG_MAP[categorySlug] || "All");
        } else {
            setCategory("All");
        }
    }, [categorySlug]);

    useEffect(() => { setCategory("All"); }, [team]);

    useEffect(() => {
        (async () => { try { setScans(await scansAPI.list(undefined, 50)); } catch { /* ignore */ } })();
        (async () => {
            try {
                const h = await toolsAPI.health();
                setHealth(h.tools || {});
            } catch { /* ignore — tile defaults to "available" */ }
        })();
    }, []);

    const pageTitle = team === "Red" ? "Red Team Arsenal"
                   : team === "Blue" ? "Blue Team Defenses"
                   : "Unified Toolkit";

    const subtitle = team === "Red"
        ? "Offensive modules — recon, exploitation, post-exploitation."
        : team === "Blue"
            ? "Defensive modules — detection, hardening, monitoring."
            : "Every module across recon, exploitation and defense.";

    const teamTools = useMemo(
        () => team ? ALL_TOOLS.filter(t => t.team === team) : ALL_TOOLS,
        [team],
    );

    const availableCategories = useMemo(
        () => ["All", ...Array.from(new Set(teamTools.map(t => t.category)))],
        [teamTools],
    );

    const filtered = useMemo(() => teamTools.filter(t => {
        const matchCat = category === "All" || t.category === category;
        const q = query.trim().toLowerCase();
        const matchSearch = !q || t.name.toLowerCase().includes(q)
                              || t.description.toLowerCase().includes(q)
                              || t.category.toLowerCase().includes(q);
        return matchCat && matchSearch;
    }), [teamTools, category, query]);

    // ----- KPI metrics --------------------------------------------------------
    const categoryCount: Record<string, number> = useMemo(() => {
        const m: Record<string, number> = {};
        teamTools.forEach(t => { m[t.category] = (m[t.category] || 0) + 1; });
        return m;
    }, [teamTools]);

    const runsByTool: Record<string, number> = useMemo(() => {
        const m: Record<string, number> = {};
        scans.forEach(s => { const k = (s.tool || "").toLowerCase(); m[k] = (m[k] || 0) + 1; });
        return m;
    }, [scans]);

    const totalRuns = scans.length;
    const redCount = ALL_TOOLS.filter(t => t.team === "Red").length;
    const blueCount = ALL_TOOLS.filter(t => t.team === "Blue").length;

    return (
        <div className="flex h-screen bg-ui-bg text-slate-200 font-sans overflow-hidden">
            <Sidebar />

            <div className="flex-1 flex flex-col relative overflow-hidden bg-ui-bg">
                {/* Ambient background — identical to Dashboard */}
                <div className="absolute inset-0 bg-grid-white bg-[length:32px_32px] opacity-[0.025] pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-[480px] bg-gradient-glow pointer-events-none" />

                <main className="flex-1 overflow-y-auto p-8 relative z-10 custom-scrollbar">
                    <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="max-w-7xl mx-auto space-y-6"
                    >
                        {/* ----- Header (Dashboard pattern) ----- */}
                        <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
                            <div>
                                <div className="section-eyebrow mb-2">
                                    <span className="w-6 h-px bg-brand-primary/60" />
                                    {team ? `${team} team console` : "Operations console"}
                                </div>
                                <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none">
                                    {team
                                        ? <>Welcome back, <span className="text-gradient-brand">{user?.username || "operator"}</span></>
                                        : <span className="text-gradient-brand">{pageTitle}</span>}
                                </h1>
                                <p className="text-ui-muted text-sm mt-3">
                                    {teamTools.length} modules available · {totalRuns} total runs · {subtitle}
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
                                    <Plus size={14} strokeWidth={3} /> Quick scan
                                </button>
                            </div>
                        </div>

                        {/* ----- KPI tiles (Dashboard pattern) ----- */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <KpiTile
                                label="Available modules"
                                value={teamTools.length}
                                hint={`across ${availableCategories.length - 1} categories`}
                                color="#00E5A8"
                            />
                            <KpiTile
                                label="Total runs (50 latest)"
                                value={totalRuns}
                                hint={totalRuns ? "last 50 logged" : "no runs yet"}
                                color="#7C8CFF"
                            />
                            <KpiTile
                                label="Red team modules"
                                value={redCount}
                                hint="offensive"
                                color="#FF8A3D"
                            />
                            <KpiTile
                                label="Blue team modules"
                                value={blueCount}
                                hint="defensive"
                                color="#5BC0EB"
                            />
                        </div>

                        {/* ----- Filter row ----- */}
                        <div className="glass-panel p-3 flex flex-wrap items-center gap-3">
                            {/* Search Input */}
                            <div className="relative flex-1 min-w-[200px]">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted" />
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="Search modules (Nmap, Nikto, Subdomains…)"
                                    className="w-full bg-ui-bg/60 border border-ui-border/40 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-ui-subtle focus:outline-none focus:border-brand-primary/50"
                                />
                            </div>

                            {/* Category Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setDropdownOpen(!dropdownOpen)}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-ui-surface-2/60 border-ui-border/40 text-sm font-semibold text-white hover:border-brand-primary/40 transition min-w-[180px] justify-between"
                                >
                                    <div className="flex items-center gap-2">
                                        {(() => {
                                            const Icon = CATEGORY_ICON[category] || Shield;
                                            return <Icon size={14} strokeWidth={2.5} className="text-brand-primary" />;
                                        })()}
                                        <span>{category}</span>
                                        <span className="text-xs text-ui-muted tabular-nums">
                                            ({category === "All" ? teamTools.length : (categoryCount[category] || 0)})
                                        </span>
                                    </div>
                                    <ChevronDown size={14} className={`text-ui-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Dropdown Menu */}
                                {dropdownOpen && (
                                    <>
                                        {/* Backdrop to close dropdown */}
                                        <div
                                            className="fixed inset-0 z-10"
                                            onClick={() => setDropdownOpen(false)}
                                        />

                                        {/* Dropdown Panel */}
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="absolute right-0 mt-2 w-72 glass-panel border border-ui-border/40 rounded-lg shadow-2xl z-20 overflow-hidden"
                                        >
                                            <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto custom-scrollbar">
                                                {availableCategories.map(cat => {
                                                    const Icon = CATEGORY_ICON[cat] || Shield;
                                                    const active = category === cat;
                                                    const count = cat === "All" ? teamTools.length : (categoryCount[cat] || 0);

                                                    return (
                                                        <button
                                                            key={cat}
                                                            onClick={() => {
                                                                if (cat === 'All') {
                                                                    navigate('/tools');
                                                                } else {
                                                                    const slug = CATEGORY_TO_SLUG[cat];
                                                                    navigate(`/tools/${slug}`);
                                                                }
                                                                setDropdownOpen(false);
                                                            }}
                                                            className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                                                                active
                                                                    ? "bg-brand-primary/15 text-brand-primary-bright border border-brand-primary/30"
                                                                    : "bg-transparent text-ui-muted hover:bg-ui-surface-2/60 hover:text-white"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2.5">
                                                                <Icon size={16} strokeWidth={2} className={active ? "text-brand-primary" : "text-ui-subtle"} />
                                                                <span>{cat}</span>
                                                            </div>
                                                            <span className={`text-xs tabular-nums font-semibold px-2 py-0.5 rounded ${
                                                                active
                                                                    ? "bg-brand-primary/20 text-brand-primary-bright"
                                                                    : "bg-ui-surface-2/60 text-ui-muted"
                                                            }`}>
                                                                {count}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </motion.div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ----- Section eyebrow ----- */}
                        <div className="flex items-center justify-between">
                            <h2 className="section-eyebrow">
                                <span className="w-6 h-px bg-brand-primary/60" />
                                Modules{category === "All" ? "" : ` · ${category}`}
                            </h2>
                            <span className="text-xs text-ui-muted tabular-nums">{filtered.length} showing</span>
                        </div>

                        {/* ----- Tools grid ----- */}
                        {filtered.length === 0 ? (
                            <div className="glass-panel p-12 text-center">
                                <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-bright flex items-center justify-center mb-4">
                                    <Crosshair size={22} />
                                </div>
                                <p className="text-white font-bold">No modules match</p>
                                <p className="text-ui-muted text-sm mt-1">Try clearing the search or selecting a different category.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filtered.map((t, i) => {
                                    const backendKey = TOOL_KEY_MAP[t.id];
                                    const hEntry = backendKey ? health[backendKey] : undefined;
                                    // Default to "available" until the probe answers; only
                                    // mark as missing when we have a definite negative response.
                                    const available = hEntry ? hEntry.available : true;
                                    return (
                                        <ToolTile
                                            key={t.id} tool={t} idx={i}
                                            runs={runsByTool[t.id.toLowerCase()] || 0}
                                            available={available}
                                            missingBins={hEntry?.missing || []}
                                            onOpen={() => t.path && navigate(t.path)}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                </main>
            </div>
        </div>
    );
}

// ============================================================================
//  Sub-components — Dashboard visual language
// ============================================================================

function KpiTile({
    label, value, hint, color,
}: { label: string; value: number | string; hint: string; color: string }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-5 lift-card"
        >
            <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-[0.22em]">{label}</p>
            <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black tabular-nums text-white">{value}</span>
                <span className="text-[11px] font-semibold text-ui-muted">{hint}</span>
            </div>
            <div className="mt-4 h-1.5 w-full rounded-full overflow-hidden bg-white/5">
                <div
                    className="h-full rounded-full"
                    style={{ width: "70%", background: `linear-gradient(90deg, ${color}, ${color}80)`, boxShadow: `0 0 14px ${color}66` }}
                />
            </div>
        </motion.div>
    );
}

function ToolTile({
    tool, idx, runs, available, missingBins, onOpen,
}: {
    tool: Tool;
    idx: number;
    runs: number;
    available: boolean;
    missingBins: string[];
    onOpen: () => void;
}) {
    const isRed = tool.team === "Red";
    const accent = isRed ? {
        fg: "text-brand-secondary-bright",
        bg: "bg-brand-secondary/10",
        border: "border-brand-secondary/30",
        chip: "chip-magenta",
    } : {
        fg: "text-brand-primary-bright",
        bg: "bg-brand-primary/10",
        border: "border-brand-primary/30",
        chip: "chip-primary",
    };

    return (
        <motion.button
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
            whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}
            onClick={onOpen}
            title={available ? undefined : `Backend binary missing: ${missingBins.join(", ")}`}
            className={`glass-panel p-5 lift-card text-left group flex flex-col h-full ${
                available ? "" : "opacity-60 grayscale-[40%]"
            }`}
        >
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition group-hover:scale-110 ${accent.fg} ${accent.bg} ${accent.border}`}>
                    <Zap size={18} strokeWidth={2.4} />
                </div>
                <div className="flex items-center gap-1.5">
                    {!available && (
                        <span className="chip" style={{ background: "rgba(255,138,61,0.12)", color: "#FFB37C", borderColor: "rgba(255,138,61,0.35)" }}>
                            Missing
                        </span>
                    )}
                    <span className={`chip ${accent.chip}`}>{tool.team}</span>
                </div>
            </div>

            {/* Title & desc */}
            <h4 className="text-white font-bold truncate">{tool.name}</h4>
            <p className="text-[10px] font-mono text-ui-subtle uppercase tracking-[0.18em] mt-1">{tool.category}</p>
            <p className="text-ui-muted text-xs mt-2 leading-relaxed line-clamp-2 min-h-[2.2em]">
                {tool.description}
            </p>

            {/* Footer row */}
            <div className="mt-4 pt-3 border-t border-ui-border/30 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[10px] text-ui-muted">
                    <span className="flex items-center gap-1"><Shield size={10} /> {tool.level}</span>
                    {runs > 0 && (
                        <span className="flex items-center gap-1 text-brand-primary-bright">
                            <Play size={10} className="fill-current" /> {runs} runs
                        </span>
                    )}
                </div>
                <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.22em] transition group-hover:translate-x-1 ${accent.fg}`}>
                    Open <ChevronRight size={11} strokeWidth={3} />
                </span>
            </div>
        </motion.button>
    );
}
