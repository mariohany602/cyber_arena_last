import { motion } from "framer-motion";
import { Terminal, Globe } from "lucide-react";

// --- Stat Card: Technical Readout Style ---
export function StatCard({ label, value, trend, icon: Icon, color }: { label: string, value: string, trend?: string, icon: any, color: "blue" | "red" | "green" | "purple" | "cyan" | "emerald" | "yellow" | "magenta" | "orange" }) {
    const colorMap = {
        blue: "text-neon-blue border-neon-blue/20 bg-neon-blue/5 shadow-glow-blue/20",
        red: "text-neon-red border-neon-red/20 bg-neon-red/5 shadow-glow-red/20",
        green: "text-neon-green border-neon-green/20 bg-neon-green/5 shadow-glow-green/20",
        purple: "text-brand-secondary border-brand-secondary/20 bg-brand-secondary/5 shadow-glow-secondary/20",
        cyan: "text-neon-cyan border-neon-cyan/20 bg-neon-cyan/5 shadow-glow-cyan/20",
        emerald: "text-neon-green border-neon-green/20 bg-neon-green/5 shadow-glow-green/20",
        yellow: "text-neon-yellow border-neon-yellow/20 bg-neon-yellow/5 shadow-glow-yellow/20",
        magenta: "text-neon-magenta border-neon-magenta/20 bg-neon-magenta/5 shadow-glow-magenta/20",
        orange: "text-neon-magenta border-neon-magenta/20 bg-neon-magenta/5",
    };

    const activeColor = colorMap[color] || colorMap.cyan;

    return (
        <motion.div
            whileHover={{ y: -4, backgroundColor: "rgba(30, 41, 59, 0.4)" }}
            className={`relative p-5 rounded-2xl border ${activeColor} group overflow-hidden bg-ui-surface/40 backdrop-blur-sm transition-all duration-300`}
        >
            <div className="flex items-start justify-between relative z-10">
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-lg bg-white/5 border border-white/10 group-hover:scale-110 transition-transform duration-300`}>
                            <Icon size={16} className={activeColor.split(" ")[0]} />
                        </div>
                        <h3 className="text-ui-muted text-[10px] font-mono uppercase tracking-[0.2em] font-bold">{label}</h3>
                    </div>
                    <div className="text-3xl font-black font-mono text-white tracking-tighter group-hover:text-glow-primary transition-all">
                        {value}
                    </div>
                </div>
                {trend && (
                    <div className={`text-[10px] font-mono px-2 py-1 rounded-full bg-black/40 border border-white/5 ${activeColor.split(" ")[0]} font-bold`}>
                        {trend}
                    </div>
                )}
            </div>

            {/* Decoration */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-brand opacity-[0.03] blur-2xl pointer-events-none group-hover:opacity-10 transition-opacity" />
            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-current to-transparent opacity-20" />
        </motion.div>
    );
}

// --- Service Status: Platform Health for Clients ---
export function ServiceStatus() {
    return (
        <div className="glass-panel p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-ui-border/30">
                <h3 className="text-white font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2">
                    <Globe size={14} className="text-brand-primary" /> System Core
                </h3>
                <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-neon-green"></span>
                </span>
            </div>
            <div className="space-y-5">
                <StatusItem label="Detection Engine" value={100} color="bg-neon-cyan" status="ACTIVE" />
                <StatusItem label="Neural Heuristics" value={85} color="bg-brand-secondary" status="OPTIMIZING" />
                <StatusItem label="Network Mesh" value={99} color="bg-neon-yellow" status="SYNCED" />
                <StatusItem label="Database Layer" value={72} color="bg-neon-magenta" status="HIGH LOAD" warning />
            </div>
        </div>
    );
}

function StatusItem({ label, value, color, status, warning }: { label: string, value: number, color: string, status?: string, warning?: boolean }) {
    return (
        <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-mono uppercase font-bold">
                <span className="text-ui-muted">{label}</span>
                <span className={warning ? "text-neon-yellow" : "text-neon-cyan"}>{status}</span>
            </div>
            <div className="h-1.5 w-full bg-ui-bg rounded-full overflow-hidden flex gap-0.5 border border-ui-border/20 p-[1px]">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${value}%` }}
                    className={`h-full rounded-full transition-all duration-500 ${color} shadow-[0_0_10px_currentColor] opacity-80`}
                />
            </div>
        </div>
    );
}

// --- Quick Actions / Support ---
export function SupportContact() {
    return (
        <div className="glass-panel p-8 h-full flex flex-col justify-center items-center text-center group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-brand opacity-[0.02] pointer-events-none" />
            <div className="relative z-10 space-y-6">
                <div className="w-16 h-16 bg-brand-primary/10 rounded-2xl border border-brand-primary/20 flex items-center justify-center shadow-glow-primary group-hover:scale-110 transition-transform duration-500 mx-auto">
                    <Terminal size={32} className="text-brand-primary" />
                </div>
                <div className="space-y-2">
                    <h3 className="text-white font-black text-xl tracking-tight">Direct Uplink</h3>
                    <p className="text-ui-muted text-xs leading-relaxed max-w-[200px]">Connect to level-3 security engineers instantly.</p>
                </div>
                <button className="cyber-button cyber-button-primary w-full text-xs uppercase tracking-widest">
                    Request Support
                </button>
            </div>
        </div>
    );
}
