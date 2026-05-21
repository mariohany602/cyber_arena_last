import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
    Home,
    Shield,
    ShieldAlert,
    MessageSquare,
    User,
    Info,
    LogOut,
    Zap,
    History as HistoryIcon,
    Activity,
    Cpu,
    Radar,
    ChevronDown,
    AlertTriangle,
    Briefcase,
    GitBranch,
    Crosshair,
    Bug,
    Workflow,
    Server,
    BarChart3,
    Radio,
    Bot,
    Layers,
    Building2,
    Network,
    Globe,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { orgAPI, type CurrentOrg } from "../../utils/api";

export default function Sidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const { logout, user } = useAuth();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <aside className="w-64 flex-shrink-0 flex flex-col glass-panel-dark border-r border-ui-border/30 relative overflow-hidden">
            {/* Ambient glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-brand-primary/5 via-transparent to-brand-secondary/5 pointer-events-none" />
            <div className="absolute -top-20 -left-20 w-60 h-60 bg-brand-primary/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-brand-secondary/15 rounded-full blur-3xl pointer-events-none" />

            {/* Brand */}
            <button
                onClick={() => navigate('/')}
                className="relative z-10 flex items-center gap-3 px-5 pt-6 pb-5 border-b border-ui-border/30 group"
            >
                <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow-primary group-hover:shadow-glow-secondary transition-shadow relative">
                    <Shield size={20} className="text-white" strokeWidth={2.4} />
                    <div className="absolute inset-0 rounded-xl border border-white/20" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-black text-white tracking-tight leading-none">
                        CYBER<span className="text-brand-primary-bright"> ARENA</span>
                    </div>
                    <div className="text-[9px] font-mono text-ui-muted uppercase tracking-[0.25em] mt-1.5">
                        Operator Console
                    </div>
                </div>
            </button>

            <div className="flex-1 flex flex-col px-3 py-5 space-y-1 relative z-10 overflow-y-auto custom-scrollbar">
                <nav className="space-y-0.5">
                    <NavItem
                        icon={<Home size={17} />}
                        label="Dashboard"
                        onClick={() => navigate('/')}
                        active={location.pathname === '/' || location.pathname === '/dashboard'}
                        color="primary"
                    />

                    <SectionLabel>Operations</SectionLabel>

                    <PentestGroup
                        pathname={location.pathname}
                        onNavigate={navigate}
                    />
                    <SocGroup
                        pathname={location.pathname}
                        onNavigate={navigate}
                    />
                    <ToolsGroup
                        pathname={location.pathname}
                        onNavigate={navigate}
                    />
                    <NavItem
                        icon={<HistoryIcon size={17} />}
                        label="Scan History"
                        onClick={() => navigate('/history')}
                        active={location.pathname === '/history' || location.pathname === '/reports'}
                        color="green"
                    />

                    <SectionLabel>System</SectionLabel>

                    <NavItem
                        icon={<MessageSquare size={17} />}
                        label="Encrypted Chat"
                        onClick={() => navigate('/chat')}
                        active={location.pathname === '/chat'}
                        color="blue"
                    />
                    <NavItem icon={<Info size={17} />} label="Documentation" />
                </nav>

                <div className="mt-auto pt-4 space-y-1">
                    <div className="divider-shine my-3" />
                    {user ? (
                        <>
                            <OrgBadge />
                            <button
                                onClick={() => navigate('/profile')}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 group
                                    ${location.pathname === '/profile'
                                        ? 'bg-ui-surface-2/70 border-ui-border-bright/60 shadow-inner-glow'
                                        : 'bg-ui-surface/40 border-ui-border/40 hover:bg-ui-surface-2/60 hover:border-ui-border-bright/50'}`}
                            >
                                <div className="w-9 h-9 rounded-lg bg-gradient-brand flex items-center justify-center shadow-glow-primary flex-shrink-0">
                                    <User size={16} className="text-white" />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-xs font-bold text-white truncate">{user.username}</p>
                                    <p className="text-[10px] text-ui-muted truncate">{user.email}</p>
                                </div>
                            </button>
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-xs font-bold text-neon-red/80 hover:text-neon-red hover:bg-neon-red/10 group"
                            >
                                <LogOut size={17} className="transition-transform group-hover:translate-x-0.5" />
                                <span>Disconnect</span>
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={() => navigate('/login')}
                            className="cyber-button cyber-button-outline w-full text-xs"
                        >
                            <LogOut size={16} className="rotate-180" />
                            <span>Login to Console</span>
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}

function PentestGroup({
    pathname, onNavigate,
}: {
    pathname: string;
    onNavigate: (to: string) => void;
}) {
    const inPentest = pathname === '/tools/network' ||
                      pathname === '/tools/web-tools' ||
                      pathname === '/tools/web-security' ||
                      pathname === '/tools/vulnerability-assessment';
    const [open, setOpen] = useState(inPentest);

    const isNetwork = pathname === '/tools/network';
    const isWebTools = pathname === '/tools/web-tools';
    const isWebSecurity = pathname === '/tools/web-security';
    const isVulnAssessment = pathname === '/tools/vulnerability-assessment';

    return (
        <div>
            <button
                onClick={() => setOpen(o => !o)}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-xs font-bold group
                    ${inPentest ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-ui-muted hover:text-white hover:bg-white/5'}`}
            >
                {inPentest && (
                    <motion.div
                        layoutId="activePill"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-neon-cyan shadow-[0_0_12px_currentColor]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                )}
                <span className={`transition-transform duration-200 ${inPentest ? 'scale-105' : 'group-hover:scale-105 group-hover:text-neon-cyan'}`}>
                    <Shield size={17} />
                </span>
                <span className="tracking-wide flex-1 text-left">Pentest Suite</span>
                <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'} opacity-70`}
                />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                    >
                        <div className="ml-3 mt-1 pl-3 border-l border-ui-border/40 space-y-0.5 py-1">
                            <SubNavItem
                                icon={<Network size={14} />}
                                label="Network"
                                hint="Nmap · Traffic"
                                active={isNetwork}
                                onClick={() => onNavigate('/tools/network')}
                            />
                            <SubNavItem
                                icon={<Globe size={14} />}
                                label="Web Tools"
                                hint="Crawl · Recon"
                                active={isWebTools}
                                onClick={() => onNavigate('/tools/web-tools')}
                            />
                            <SubNavItem
                                icon={<Crosshair size={14} />}
                                label="Web Security"
                                hint="FFUF · SQLmap"
                                active={isWebSecurity}
                                onClick={() => onNavigate('/tools/web-security')}
                            />
                            <SubNavItem
                                icon={<ShieldAlert size={14} />}
                                label="Vuln Assessment"
                                hint="Nikto · Nuclei"
                                active={isVulnAssessment}
                                onClick={() => onNavigate('/tools/vulnerability-assessment')}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ToolsGroup({
    pathname, onNavigate,
}: {
    pathname: string;
    onNavigate: (to: string) => void;
}) {
    const inTools = pathname.startsWith('/tools');
    const [open, setOpen] = useState(inTools);

    const isAll = pathname === '/tools' || pathname === '/tools/all';
    const isWebTools = pathname === '/tools/web-tools';
    const isNetwork = pathname === '/tools/network';
    const isWebSecurity = pathname === '/tools/web-security';
    const isVulnAssessment = pathname === '/tools/vulnerability-assessment';
    const isBlueTeam = pathname === '/tools/blue-team';

    return (
        <div>
            <button
                onClick={() => setOpen(o => !o)}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-xs font-bold group
                    ${inTools ? 'bg-neon-yellow/10 text-neon-yellow' : 'text-ui-muted hover:text-white hover:bg-white/5'}`}
            >
                {inTools && (
                    <motion.div
                        layoutId="activePill"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-neon-yellow shadow-[0_0_12px_currentColor]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                )}
                <span className={`transition-transform duration-200 ${inTools ? 'scale-105' : 'group-hover:scale-105 group-hover:text-neon-yellow'}`}>
                    <Zap size={17} />
                </span>
                <span className="tracking-wide flex-1 text-left">Active Tools</span>
                <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'} opacity-70`}
                />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                    >
                        <div className="ml-3 mt-1 pl-3 border-l border-ui-border/40 space-y-0.5 py-1">
                            <SubNavItem
                                icon={<Layers size={14} />}
                                label="All Tools"
                                hint="Overview"
                                active={isAll}
                                onClick={() => onNavigate('/tools')}
                            />
                            <SubNavItem
                                icon={<Globe size={14} />}
                                label="Web Tools"
                                hint="HTTP · Crawl"
                                active={isWebTools}
                                onClick={() => onNavigate('/tools/web-tools')}
                            />
                            <SubNavItem
                                icon={<Network size={14} />}
                                label="Network"
                                hint="Nmap · Traffic"
                                active={isNetwork}
                                onClick={() => onNavigate('/tools/network')}
                            />
                            <SubNavItem
                                icon={<Shield size={14} />}
                                label="Web Security"
                                hint="FFUF · SQLmap"
                                active={isWebSecurity}
                                onClick={() => onNavigate('/tools/web-security')}
                            />
                            <SubNavItem
                                icon={<ShieldAlert size={14} />}
                                label="Vuln Assessment"
                                hint="Nikto · Nuclei"
                                active={isVulnAssessment}
                                onClick={() => onNavigate('/tools/vulnerability-assessment')}
                            />
                            <SubNavItem
                                icon={<Shield size={14} />}
                                label="Blue Team"
                                hint="Defense"
                                active={isBlueTeam}
                                onClick={() => onNavigate('/tools/blue-team')}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function SocGroup({
    pathname, onNavigate,
}: {
    pathname: string;
    onNavigate: (to: string) => void;
}) {
    const inSoc = pathname.startsWith('/soc') ||
                  pathname === '/siem' || pathname === '/xdr' ||
                  pathname === '/edr'  || pathname === '/soar' ||
                  pathname === '/ti'   ||
                  pathname === '/soar-center' ||
                  pathname === '/soc/soar' ||
                  pathname === '/ai' ||
                  pathname === '/soc/ai';
    const [open, setOpen] = useState(inSoc);

    const isSiem = pathname === '/soc' || pathname === '/soc/siem' ||
                   pathname === '/siem' || pathname === '/soar';
    const isXdr  = pathname === '/soc/xdr' || pathname === '/xdr' || pathname === '/edr';
    const isTi   = pathname === '/soc/ti'  || pathname === '/ti';
    const isSoarCC    = pathname === '/soc/soar' || pathname === '/soar-center';
    const isAi        = pathname === '/ai'   || pathname === '/soc/ai';

    return (
        <div>
            <button
                onClick={() => setOpen(o => !o)}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-xs font-bold group
                    ${inSoc ? 'bg-neon-magenta/10 text-neon-magenta' : 'text-ui-muted hover:text-white hover:bg-white/5'}`}
            >
                {inSoc && (
                    <motion.div
                        layoutId="activePill"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-neon-magenta shadow-[0_0_12px_currentColor]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                )}
                <span className={`transition-transform duration-200 ${inSoc ? 'scale-105' : 'group-hover:scale-105 group-hover:text-neon-magenta'}`}>
                    <ShieldAlert size={17} />
                </span>
                <span className="tracking-wide flex-1 text-left">SOC Services</span>
                <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'} opacity-70`}
                />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                    >
                        <div className="ml-3 mt-1 pl-3 border-l border-ui-border/40 space-y-0.5 py-1">
                            <SubNavItem
                                icon={<Activity size={14} />}
                                label="SIEM"
                                hint="Alerts · MITRE · CVEs"
                                active={isSiem}
                                onClick={() => onNavigate('/soc/siem')}
                            />
                            <SubNavItem
                                icon={<Cpu size={14} />}
                                label="XDR"
                                hint="Endpoints · FIM · SCA"
                                active={isXdr}
                                onClick={() => onNavigate('/soc/xdr')}
                            />
                            <SubNavItem
                                icon={<Radar size={14} />}
                                label="Threat Intel"
                                hint="VT · AbuseIPDB"
                                active={isTi}
                                onClick={() => onNavigate('/soc/ti')}
                            />
                            {/* Phase 4 SOC extension — SOAR */}
                            <SubNavItem
                                icon={<Workflow size={14} />}
                                label="SOAR Center"
                                hint="Block · Isolate · PB"
                                active={isSoarCC}
                                onClick={() => onNavigate('/soc/soar')}
                            />
                            {/* Phase 5 SOC extension — realtime stream & AI assistant */}
                            <SubNavItem
                                icon={<Bot size={14} />}
                                label="AI Assistant"
                                hint="Sentinel · GPT"
                                active={isAi}
                                onClick={() => onNavigate('/ai')}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function SubNavItem({
    icon, label, hint, active, onClick,
}: {
    icon: React.ReactNode;
    label: string;
    hint?: string;
    active?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200 text-xs font-semibold group
                ${active
                    ? 'bg-neon-magenta/10 text-neon-magenta'
                    : 'text-ui-muted hover:text-white hover:bg-white/5'}`}
        >
            <span className={`transition-transform ${active ? 'scale-105' : 'group-hover:scale-105 group-hover:text-neon-magenta'}`}>
                {icon}
            </span>
            <span className="flex-1 text-left">{label}</span>
            {hint && <span className="text-[9px] font-mono text-ui-subtle uppercase tracking-wider truncate max-w-[90px]">{hint}</span>}
        </button>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="pt-5 pb-1.5 px-3 text-[9px] font-mono text-ui-subtle uppercase tracking-[0.25em] font-bold">
            {children}
        </div>
    );
}

// ---------------------------------------------------------------------------
// SaaS tenant badge — shows the user's active Organization + plan chip. The
// most visible "this is multi-tenant" cue in the UI.
// ---------------------------------------------------------------------------
const PLAN_STYLES: Record<string, string> = {
    free:       'bg-ui-surface-2/60 text-ui-muted border border-ui-border/50',
    starter:    'bg-neon-blue/15 text-neon-blue border border-neon-blue/30',
    pro:        'bg-neon-magenta/15 text-neon-magenta border border-neon-magenta/30',
    enterprise: 'bg-neon-yellow/15 text-neon-yellow border border-neon-yellow/30',
};

function OrgBadge() {
    const [org, setOrg] = useState<CurrentOrg | null>(null);
    const [orgs, setOrgs] = useState<CurrentOrg[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        let alive = true;
        Promise.all([orgAPI.current(), orgAPI.mine().catch(() => [] as CurrentOrg[])])
            .then(([cur, all]) => {
                if (!alive) return;
                setOrg(cur);
                setOrgs(all);
            })
            .catch(() => { /* legacy user without an org — silently hide */ })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    if (loading || !org) return null;

    const planClass = PLAN_STYLES[org.plan] || PLAN_STYLES.free;
    const hasMany = orgs.length > 1;

    const switchTo = (o: CurrentOrg) => {
        if (o.id === org.id) { setOpen(false); return; }
        // Persist + hard reload so every page re-fetches with the new
        // X-Org-Id header (cleanest way to invalidate caches everywhere).
        localStorage.setItem('active_org_id', String(o.id));
        window.location.reload();
    };

    return (
        <div className="relative">
            <button
                onClick={() => hasMany ? setOpen(v => !v) : navigate('/settings/organization')}
                title={hasMany ? "Switch organization" : "Organization settings"}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-ui-border/40 bg-ui-surface/40 mb-1 hover:border-brand-primary/40 hover:bg-ui-surface/70 transition-colors text-left">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-primary/40 to-brand-secondary/40 flex items-center justify-center flex-shrink-0 border border-ui-border/40">
                    <Building2 size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-bold text-white truncate" title={org.name}>{org.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${planClass}`}>
                            {org.plan}
                        </span>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-ui-subtle truncate">
                            {org.my_role}
                        </span>
                    </div>
                </div>
                {hasMany && (
                    <span className="text-ui-subtle text-xs flex-shrink-0">▾</span>
                )}
            </button>
            {open && hasMany && (
                <div className="absolute left-0 right-0 mt-1 z-50 rounded-xl border border-ui-border/60 bg-ui-surface/95 backdrop-blur-md shadow-2xl overflow-hidden">
                    <p className="text-[9px] font-black uppercase tracking-widest text-ui-subtle px-3 pt-2 pb-1">
                        Your organizations
                    </p>
                    {orgs.map((o) => (
                        <button
                            key={o.id}
                            onClick={() => switchTo(o)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ui-bg/60 transition-colors ${o.id === org.id ? 'bg-brand-primary/10' : ''}`}
                        >
                            <Building2 size={14} className="text-ui-muted flex-shrink-0" />
                            <span className="flex-1 truncate text-xs text-white">{o.name}</span>
                            <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${PLAN_STYLES[o.plan] || PLAN_STYLES.free}`}>
                                {o.plan}
                            </span>
                        </button>
                    ))}
                    <button
                        onClick={() => { setOpen(false); navigate('/settings/organization'); }}
                        className="w-full px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-brand-primary hover:bg-ui-bg/60 border-t border-ui-border/40"
                    >
                        Manage organization →
                    </button>
                </div>
            )}
        </div>
    );
}

type NavColor = 'primary' | 'cyan' | 'magenta' | 'yellow' | 'blue' | 'green';

function NavItem({
    icon, label, active = false, onClick, color = 'primary',
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    onClick?: () => void;
    color?: NavColor;
}) {
    const colorMap: Record<NavColor, { active: string; pill: string; hoverIcon: string }> = {
        primary: { active: 'bg-brand-primary/10 text-brand-primary-bright', pill: 'bg-brand-primary', hoverIcon: 'group-hover:text-brand-primary-bright' },
        cyan:    { active: 'bg-neon-cyan/10 text-neon-cyan',    pill: 'bg-neon-cyan',    hoverIcon: 'group-hover:text-neon-cyan' },
        magenta: { active: 'bg-neon-magenta/10 text-neon-magenta', pill: 'bg-neon-magenta', hoverIcon: 'group-hover:text-neon-magenta' },
        yellow:  { active: 'bg-neon-yellow/10 text-neon-yellow', pill: 'bg-neon-yellow', hoverIcon: 'group-hover:text-neon-yellow' },
        blue:    { active: 'bg-neon-blue/10 text-neon-blue',    pill: 'bg-neon-blue',    hoverIcon: 'group-hover:text-neon-blue' },
        green:   { active: 'bg-neon-green/10 text-neon-green',  pill: 'bg-neon-green',  hoverIcon: 'group-hover:text-neon-green' },
    };
    const c = colorMap[color];

    return (
        <button
            onClick={onClick}
            className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-xs font-bold group
                ${active ? c.active : 'text-ui-muted hover:text-white hover:bg-white/5'}`}
        >
            {active && (
                <motion.div
                    layoutId="activePill"
                    className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full ${c.pill} shadow-[0_0_12px_currentColor]`}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
            )}
            <span className={`transition-transform duration-200 ${active ? 'scale-105' : `group-hover:scale-105 ${c.hoverIcon}`}`}>
                {icon}
            </span>
            <span className="tracking-wide">{label}</span>
        </button>
    );
}
