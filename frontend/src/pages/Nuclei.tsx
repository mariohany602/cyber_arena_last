import React, { useState } from 'react';
import { Shield, Play, Terminal, AlertTriangle, Activity, BarChart3, Search, Download, Info, ExternalLink } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

interface NucleiFinding {
    template_id: string;
    name: string;
    severity: string;          // CRITICAL | HIGH | MEDIUM | LOW | INFO | UNKNOWN
    description: string;
    tags: string[];
    reference: string[];
    url: string;
    matcher: string | null;
    type: string;
    evidence: string;
}

const SEV_OPTIONS = [
    { id: 'critical,high,medium,low', label: 'Critical → Low (default)' },
    { id: 'critical,high',            label: 'Critical + High only' },
    { id: 'medium,low,info',          label: 'Informational' },
    { id: 'critical,high,medium,low,info', label: 'Everything (slow)' },
];

const sevColor = (s: string) => {
    const k = (s || '').toUpperCase();
    if (k === 'CRITICAL') return 'text-neon-red border-neon-red/30 bg-neon-red/10';
    if (k === 'HIGH')     return 'text-orange-500 border-orange-500/30 bg-orange-500/10';
    if (k === 'MEDIUM')   return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
    if (k === 'LOW')      return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
    return 'text-slate-400 border-slate-500/30 bg-slate-500/10';
};

const sevBar = (s: string) => {
    const k = (s || '').toUpperCase();
    if (k === 'CRITICAL') return 'bg-neon-red shadow-glow-red';
    if (k === 'HIGH')     return 'bg-orange-500 shadow-lg';
    if (k === 'MEDIUM')   return 'bg-yellow-500 shadow-md';
    if (k === 'LOW')      return 'bg-blue-400';
    return 'bg-slate-500';
};

const Nuclei: React.FC = () => {
    const [target, setTarget] = useState('');
    const [severity, setSeverity] = useState(SEV_OPTIONS[0].id);
    const [tags, setTags] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<any>(null);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const runScan = async () => {
        if (!target) return;
        setLoading(true);
        setResults(null);
        setConsoleOutput([]);
        setAssessment(null);

        addToConsole(`NUCLEI: Initializing template scanner...`);
        addToConsole(`TARGET: ${target}`);
        addToConsole(`SEVERITY: ${severity}`);
        if (tags) addToConsole(`TAGS: ${tags}`);
        addToConsole(`STATUS: Loading 9000+ community templates...`);

        try {
            const response = await api.post('/api/v1/nuclei', { target, severity, tags, timeout: 240 });
            const data = response.data;
            setResults(data);
            setAssessment(data.assessment || null);
            if (data.error) {
                addToConsole(`WARN: ${data.error}`);
            }
            addToConsole(`SUCCESS: Scan complete. ${data.count ?? 0} templates matched.`);
        } catch (error: any) {
            addToConsole(`ERROR: ${error.response?.data?.detail || "Nuclei engine unreachable"}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="Nuclei Vulnerability Scanner" icon={Shield} status={loading ? 'running' : 'idle'}>
            <div className="flex flex-col h-full gap-6">

                {/* Configuration Panel */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 glass-panel border-ui-border/30 p-6 rounded-2xl relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-secondary/20 to-transparent" />

                        <label className="block text-[10px] font-black text-ui-muted uppercase tracking-[0.2em] mb-3">Target URL / Hostname</label>
                        <div className="flex gap-4">
                            <div className="flex-1 relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ui-muted/40" size={18} />
                                <input
                                    type="text"
                                    placeholder="https://target.example or 192.168.1.10"
                                    value={target}
                                    onChange={(e) => setTarget(e.target.value)}
                                    className="w-full bg-ui-bg/50 border border-ui-border/30 rounded-xl pl-12 pr-4 py-4 text-white font-mono text-sm placeholder:text-ui-muted/20 focus:border-brand-secondary/50 outline-none transition-all"
                                />
                            </div>
                            <button
                                onClick={runScan}
                                disabled={loading || !target}
                                className="bg-brand-secondary hover:brightness-110 text-white font-black px-8 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-3 text-[11px] tracking-widest disabled:opacity-50"
                            >
                                <Play size={16} fill="currentColor" /> {loading ? "SCANNING..." : "RUN_TEMPLATES"}
                            </button>
                        </div>

                        <div className="mt-4">
                            <label className="block text-[10px] font-black text-ui-muted uppercase tracking-[0.2em] mb-2">Tags filter (optional)</label>
                            <input
                                type="text"
                                placeholder="cve,exposure,sqli  (comma-separated)"
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                                className="w-full bg-ui-bg/50 border border-ui-border/30 rounded-xl px-4 py-3 text-white font-mono text-xs placeholder:text-ui-muted/20 focus:border-brand-secondary/50 outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="glass-panel border-ui-border/30 p-6 rounded-2xl relative overflow-hidden">
                        <label className="block text-[10px] font-black text-ui-muted uppercase tracking-[0.2em] mb-3">Severity profile</label>
                        <select
                            value={severity}
                            onChange={(e) => setSeverity(e.target.value)}
                            className="w-full bg-ui-bg/50 border border-ui-border/30 rounded-xl p-4 text-white text-sm outline-none focus:border-brand-secondary/50 transition-all appearance-none"
                        >
                            {SEV_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        <p className="text-[10px] text-ui-muted/60 mt-3 leading-relaxed">
                            Engine: <span className="text-brand-secondary font-bold">nuclei</span> with default community templates.
                        </p>
                    </div>
                </div>

                {assessment && <AssessmentPanel assessment={assessment} target={target} />}

                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Findings Feed */}
                    <div className="lg:col-span-3 flex flex-col gap-6 overflow-hidden">
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-10">
                            <AnimatePresence mode="wait">
                                {results ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <BarChart3 className="text-brand-secondary" size={16} />
                                                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">
                                                    Nuclei Scan Report — {results.count ?? 0} matches
                                                </h3>
                                            </div>
                                            <span className="text-[10px] font-mono text-ui-muted">{results.timestamp}</span>
                                        </div>

                                        {(results.findings as NucleiFinding[]).length === 0 && (
                                            <div className="glass-panel border-ui-border/20 p-6 rounded-2xl text-center">
                                                <Info className="mx-auto text-ui-muted/50 mb-2" size={24} />
                                                <p className="text-[11px] text-ui-muted">No templates matched at this severity. Try widening the severity filter.</p>
                                            </div>
                                        )}

                                        {(results.findings as NucleiFinding[]).map((vuln, idx) => (
                                            <motion.div
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: Math.min(idx * 0.05, 0.6) }}
                                                key={idx}
                                                className="glass-panel border-ui-border/20 p-6 rounded-2xl hover:border-brand-secondary/30 transition-all"
                                            >
                                                <div className="flex justify-between items-start mb-4 gap-4">
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className={`w-1.5 h-12 rounded-full ${sevBar(vuln.severity)}`} />
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${sevColor(vuln.severity)}`}>
                                                                    {vuln.severity}
                                                                </span>
                                                                <span className="text-[9px] font-mono text-brand-secondary">{vuln.template_id}</span>
                                                                {vuln.type && <span className="text-[9px] font-mono text-ui-muted">{vuln.type}</span>}
                                                            </div>
                                                            <h4 className="text-white font-black mt-2 text-sm tracking-tight truncate">{vuln.name}</h4>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="bg-black/20 p-5 rounded-xl border border-ui-border/10 space-y-4">
                                                    {vuln.description && (
                                                        <div>
                                                            <span className="text-[9px] font-black text-ui-muted uppercase tracking-widest block mb-1.5">Description</span>
                                                            <p className="text-[11px] text-slate-400 font-mono leading-relaxed">{vuln.description}</p>
                                                        </div>
                                                    )}
                                                    {vuln.url && (
                                                        <div>
                                                            <span className="text-[9px] font-black text-ui-muted uppercase tracking-widest block mb-1.5">Matched at</span>
                                                            <p className="text-[11px] text-brand-secondary font-mono break-all">{vuln.url}</p>
                                                        </div>
                                                    )}
                                                    {vuln.tags && vuln.tags.length > 0 && (
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {vuln.tags.map((t, i) => (
                                                                <span key={i} className="text-[9px] font-mono px-2 py-0.5 rounded bg-ui-border/10 text-ui-muted">#{t}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {vuln.reference && vuln.reference.length > 0 && (
                                                        <div className="pt-2 border-t border-ui-border/5 space-y-1">
                                                            {vuln.reference.slice(0, 3).map((r, i) => (
                                                                <a key={i} href={r} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] text-brand-secondary hover:underline truncate">
                                                                    <ExternalLink size={10} /> {r}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center py-20">
                                        <div className="relative">
                                            <Activity className="text-brand-secondary/20 animate-pulse" size={80} strokeWidth={1} />
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <Shield className="text-brand-secondary/40" size={32} />
                                            </div>
                                        </div>
                                        <p className="mt-6 text-[10px] font-black uppercase tracking-[0.5em] text-ui-muted/60">Nuclei engine idle</p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="flex flex-col gap-6">
                        <div className="glass-panel border-ui-border/30 p-5 rounded-2xl relative overflow-hidden bg-ui-bg/40">
                            <div className="absolute top-0 right-0 p-2 opacity-5">
                                <BarChart3 size={40} />
                            </div>
                            <h5 className="text-[10px] font-black text-white uppercase tracking-[0.2em] mb-4">Scan Status</h5>
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] font-black text-ui-muted uppercase">Progress</div>
                                    <div className="w-full h-1 bg-ui-border/20 rounded-full overflow-hidden">
                                        <div className={`h-full bg-brand-secondary ${loading ? 'w-1/2 animate-shimmer' : results ? 'w-full' : 'w-0'}`} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                    <div className="p-3 bg-black/30 rounded-lg border border-ui-border/10 text-center">
                                        <div className="text-[18px] font-black text-white">{results?.count ?? 0}</div>
                                        <div className="text-[8px] font-black text-ui-muted uppercase tracking-tighter">Matches</div>
                                    </div>
                                    <div className="p-3 bg-black/30 rounded-lg border border-ui-border/10 text-center">
                                        <div className="text-[14px] font-black text-brand-secondary italic">nuclei</div>
                                        <div className="text-[8px] font-black text-ui-muted uppercase tracking-tighter">Engine</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Terminal Feed */}
                        <div className="flex-1 bg-black/60 border border-ui-border/20 rounded-2xl p-4 font-mono text-[9px] flex flex-col overflow-hidden min-h-[250px]">
                            <div className="flex items-center justify-between text-ui-muted mb-3 pb-2 border-b border-ui-border/10 uppercase tracking-widest font-black">
                                <div className="flex items-center gap-2">
                                    <Terminal size={12} className="text-brand-secondary" /> NUCLEI_LOG_STREAM
                                </div>
                                <Activity size={10} className={loading ? "text-brand-secondary animate-pulse" : ""} />
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 scroll-smooth">
                                {consoleOutput.map((line, i) => (
                                    <div key={i} className="text-slate-400 opacity-80 border-l border-ui-border/20 pl-2 py-0.5 hover:bg-white/5 transition-colors">{line}</div>
                                ))}
                                {loading && (
                                    <div className="text-brand-secondary iterate-flicker py-1">
                                        &gt; Running templates against target...
                                    </div>
                                )}
                                {consoleOutput.length === 0 && !loading && (
                                    <div className="italic text-ui-muted/10 py-10 text-center">Awaiting scan initialization...</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default Nuclei;
