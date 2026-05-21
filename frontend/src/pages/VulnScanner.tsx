import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle, Info, Play, Search, AlertOctagon, Activity } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

const VulnScanner: React.FC = () => {
    const [target, setTarget] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [noPing, setNoPing] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const startScan = async () => {
        if (!target) return alert("Please enter a target URL");
        setLoading(true);
        setResults([]);
        setConsoleOutput([]);
        setAssessment(null);

        addToConsole(`AUDIT: Initializing Vulnerability Discovery Engine...`);
        addToConsole(`TARGET: ${target}`);
        addToConsole(`PARAMS: no_ping=${noPing}`);
        addToConsole(`STATUS: Engaging heuristic analysis modules...`);

        try {
            const response = await api.post('/api/vuln-scan', { url: target }, { params: { no_ping: noPing } });
            const data = response.data;
            if (data.status === 'success') {
                setResults(data.vulnerabilities);
                setAssessment(data.assessment || null);
                addToConsole(`SUCCESS: Audit complete. Identified ${data.vulnerabilities.length} potential vulnerabilities.`);
            }
        } catch (error: any) {
            const errorMessage = error.response?.data?.detail || "Audit uplink failure. Remote host may be blocking requests.";
            addToConsole(`CRITICAL FAILURE: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="Vulnerability Assessor" icon={ShieldAlert} status={loading ? 'running' : 'idle'}>
            <div className="max-w-5xl mx-auto flex flex-col gap-8 h-full">

                {/* Search Header */}
                <div className="flex gap-4 items-center p-4 glass-panel border-ui-border/30 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-secondary/20 to-transparent" />
                    
                    <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ui-muted/50" size={18} />
                        <input
                            type="text"
                            placeholder="https://vulnerable-app.com"
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                            className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 pl-12 rounded-xl text-sm text-white font-mono placeholder:text-ui-muted/30 focus:border-brand-secondary/50 outline-none transition-all shadow-inner-glow"
                        />
                    </div>
                    <button
                        onClick={startScan}
                        disabled={loading}
                        className="bg-brand-secondary hover:bg-brand-secondary/90 text-white font-black py-4 px-10 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-3 text-[11px] tracking-widest disabled:opacity-50"
                    >
                        {loading ? <AlertOctagon className="animate-pulse" size={18} /> : <Play fill="currentColor" size={18} />}
                        {loading ? "AUDITING..." : "START_AUDIT"}
                    </button>
                </div>

                <div className="flex items-center justify-between p-4 glass-panel border-ui-border/30 rounded-2xl max-w-md relative overflow-hidden">
                     <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-ui-muted/10 to-transparent" />
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">HOST DISCOVERY BYPASS</span>
                        <span className="text-[9px] text-ui-muted mt-1 font-medium italic opacity-70">Forces scan even if host blocks ICMP/Ping</span>
                    </div>
                    <button
                        onClick={() => setNoPing(!noPing)}
                        className={`w-12 h-6 rounded-full relative transition-all ${noPing ? 'bg-brand-secondary' : 'bg-ui-border/30'}`}
                    >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${noPing ? 'left-7' : 'left-1'} shadow-sm`} />
                    </button>
                </div>

                {assessment && <AssessmentPanel assessment={assessment} target={target} />}

                <div className="flex-1 min-h-0 flex flex-col gap-8">
                    {/* Results Grid */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 min-h-[300px]">
                        {results.length > 0 ? (
                            <div className="grid grid-cols-1 gap-6 pb-12">
                                {results.map((vuln, index) => (
                                    <motion.div
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.1 }}
                                        key={index}
                                        className="glass-panel border-ui-border/30 p-8 rounded-2xl hover:border-brand-secondary/40 transition-all group relative overflow-hidden shadow-xl"
                                    >
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${vuln.severity === 'High' ? 'bg-neon-red shadow-glow-red' :
                                            vuln.severity === 'Medium' ? 'bg-neon-yellow shadow-glow-yellow' :
                                                'bg-brand-primary shadow-glow-primary'
                                            }`} />

                                        <div className="flex justify-between items-start mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-3 rounded-xl border ${
                                                    vuln.severity === 'High' ? 'bg-neon-red/10 border-neon-red/20 text-neon-red' :
                                                    vuln.severity === 'Medium' ? 'bg-neon-yellow/10 border-neon-yellow/20 text-neon-yellow' :
                                                    'bg-brand-primary/10 border-brand-primary/20 text-brand-primary'
                                                }`}>
                                                    {vuln.severity === 'High' ? <AlertTriangle size={24} /> :
                                                        vuln.severity === 'Medium' ? <AlertOctagon size={24} /> :
                                                            <Info size={24} />}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-black text-white italic tracking-tight group-hover:text-brand-secondary transition-colors uppercase">{vuln.name}</h3>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[9px] font-black font-mono text-ui-muted uppercase tracking-widest">Target Path:</span>
                                                        <code className="text-[10px] font-mono text-brand-secondary opacity-80">{vuln.path}</code>
                                                    </div>
                                                </div>
                                            </div>
                                            <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] border ${vuln.severity === 'High' ? 'bg-neon-red/10 text-neon-red border-neon-red/30' :
                                                vuln.severity === 'Medium' ? 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30' :
                                                    'bg-brand-primary/10 text-brand-primary border-brand-primary/30'
                                                }`}>
                                                {vuln.severity} Priority
                                            </span>
                                        </div>

                                        <div className="bg-black/40 rounded-2xl border border-ui-border/20 relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-full h-full bg-grid-white bg-[length:20px_20px] opacity-[0.02] pointer-events-none" />
                                            <div className="p-6 text-slate-300 text-[11px] whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto custom-scrollbar relative z-10 selection:bg-brand-secondary/30">
                                                {vuln.description}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            !loading && (
                                <div className="text-center py-20 group">
                                    <div className="relative inline-block mb-10">
                                        <div className="absolute inset-0 bg-brand-secondary/20 blur-3xl rounded-full scale-150 group-hover:scale-200 transition-transform duration-1000" />
                                        <div className="w-28 h-28 rounded-3xl bg-ui-surface/60 border border-ui-border/30 flex items-center justify-center relative z-10">
                                            <ShieldAlert size={56} className="text-brand-secondary opacity-40 animate-pulse" />
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <p className="text-xs font-black uppercase tracking-[0.4em] text-white italic">Assessor Idle</p>
                                        <p className="text-[10px] font-mono text-ui-muted opacity-60 uppercase tracking-widest leading-loose">Awaiting target Acquisition... Initializing heuristic analysis modules.</p>
                                    </div>
                                </div>
                            )
                        )}
                        {loading && results.length === 0 && (
                             <div className="h-full flex flex-col items-center justify-center text-ui-muted/30 gap-6 py-12">
                                <Activity className="animate-spin text-brand-secondary opacity-20" size={64} />
                                <p className="text-xs font-black uppercase tracking-[0.3em] animate-pulse">Running heuristic audit modules...</p>
                             </div>
                        )}
                    </div>

                    {/* Industrial System Log */}
                    <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[180px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0 mb-20">
                        <div className="bg-ui-surface p-2 text-ui-muted flex items-center justify-between border-b border-ui-border/30 uppercase tracking-widest font-black">
                            <div className="flex items-center gap-2">
                                <Activity size={12} className="text-brand-secondary" /> AUDIT LOG // VULN_SCAN
                            </div>
                            <div className="text-[8px] opacity-50 font-mono">THREAT_INTEL_LIVE</div>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto space-y-1.5 custom-scrollbar text-slate-400 bg-black/20">
                            {consoleOutput.map((log, i) => (
                                <div key={i} className="opacity-80 border-l border-ui-border/50 pl-2 leading-relaxed hover:bg-white/5 transition-colors">{log}</div>
                            ))}
                            {loading && (
                                <div className="flex items-center gap-2 text-brand-secondary animate-pulse py-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-brand-secondary" />
                                    <span className="tracking-widest capitalize">Scanning for vulnerabilities...</span>
                                </div>
                            )}
                            {consoleOutput.length === 0 && !loading && (
                                <div className="text-ui-muted/20 italic">Awaiting target Acquisition command.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default VulnScanner;
