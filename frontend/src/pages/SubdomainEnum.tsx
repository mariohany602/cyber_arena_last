import React, { useState } from 'react';
import { Search, Globe, Link as LinkIcon, Activity, Network, Server, Shield, Terminal as TerminalIcon, Settings, Zap, Target, Database, ChevronRight, Share2, Info, Download, ExternalLink } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

const SubdomainEnum: React.FC = () => {
    const [domain, setDomain] = useState('');
    const [resolveIps, setResolveIps] = useState(false);
    const [loading, setLoading] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const [results, setResults] = useState<{
        domain: string,
        count: number,
        subdomains: {
            subdomain: string,
            ip: string,
            status: string
        }[]
    } | null>(null);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const downloadCSV = () => {
        if (!results) return;
        
        const headers = ["Subdomain", "IP Address", "Status"];
        const csvContent = [
            headers.join(","),
            ...results.subdomains.map(s => `"${s.subdomain}","${s.ip}","${s.status}"`)
        ].join("\n");
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url_blob = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url_blob);
        link.setAttribute("download", `subdomains_${domain.replace(/[^a-z0-9]/gi, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        addToConsole(`CORE: Generated discovery data export. Report available locally.`);
    };

    const startRecon = async () => {
        if (!domain) {
            addToConsole("CRITICAL ERROR: No target domain specified.");
            return;
        }

        setLoading(true);
        setResults(null);
        setConsoleOutput([]);
        setAssessment(null);

        addToConsole(`CORE: Initializing Asset-Discovery Engine...`);
        addToConsole(`TARGET: ${domain}`);
        addToConsole(`CONFIG: DNSResolution=${resolveIps ? 'ENABLED' : 'DISABLED'}`);
        addToConsole(`UPLINK: Engaging Subfinder discovery engine...`);

        try {
            const response = await api.post('/api/subdomains', {
                domain,
                resolve_ips: resolveIps
            });
            const data = response.data;
            setResults(data);
            setAssessment(data.assessment || null);

            addToConsole(`SYSTEM: Discovery complete. Found ${data.count} assets.`);
            if (resolveIps) addToConsole(`INTEL: DNS resolution applied to discovered assets.`);
        } catch (err: any) {
            const errorMessage = err.response?.data?.detail || "Recon engine timed out or failed.";
            addToConsole(`CRITICAL FAILURE: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="Asset Discovery // Recon" icon={Globe} status={loading ? 'running' : 'idle'}>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-full min-h-0">

                {/* Tactical Config Panel */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto custom-scrollbar pr-2 pb-20">
                    <div className="glass-panel p-6 space-y-6 border-brand-primary/20 relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-brand-primary/50" />

                        <div className="space-y-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Settings size={14} className="text-brand-primary animate-pulse" />
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Tactical Config</h3>
                            </div>

                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">Target Domain</label>
                                <div className="relative group/input">
                                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-ui-muted group-focus-within/input:text-brand-primary transition-colors">
                                        <Globe size={14} />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="e.g. google.com"
                                        value={domain}
                                        onChange={(e) => setDomain(e.target.value)}
                                        className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3 pl-10 pr-4 text-xs font-mono text-white focus:border-brand-primary/50 outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-ui-border/20">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-wider">DNS Resolution</span>
                                    <span className="text-[8px] text-ui-muted opacity-60">Resolve IP Addresses</span>
                                </div>
                                <button
                                    onClick={() => setResolveIps(!resolveIps)}
                                    className={`w-10 h-5 rounded-full transition-all relative ${resolveIps ? 'bg-brand-primary' : 'bg-ui-border/30'}`}
                                >
                                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${resolveIps ? 'right-1' : 'left-1'}`} />
                                </button>
                            </div>

                            <button
                                onClick={startRecon}
                                disabled={loading}
                                className={`cyber-button w-full py-4 text-xs tracking-[0.3em] flex items-center justify-center gap-3 mt-4 ${loading ? 'opacity-50 grayscale cursor-not-allowed' : 'cyber-button-primary'
                                    }`}
                            >
                                {loading ? <Activity className="animate-spin" size={16} /> : <Search size={16} />}
                                {loading ? 'ENGAGING...' : 'START DISCOVERY'}
                            </button>
                        </div>
                    </div>

                    <div className="glass-panel p-5 bg-ui-surface/30 border-ui-border/30">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-brand-primary/10 rounded-lg">
                                <Info size={14} className="text-brand-primary" />
                            </div>
                            <h4 className="text-[10px] font-black uppercase tracking-wider text-white">Intelligence Profile</h4>
                        </div>
                        <p className="text-[10px] leading-relaxed text-ui-muted font-medium italic opacity-80">
                            Discovery mode utilizes the <strong>Subfinder</strong> engine to identify all legitimate subdomains and assets associated with the parent target.
                        </p>
                    </div>
                </div>

                {/* Right Discovery Workspace */}
                <div className="lg:col-span-3 space-y-6 flex flex-col min-h-0">

                    {assessment && <AssessmentPanel assessment={assessment} target={domain} />}

                    {/* Summary Row */}
                    {results && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4">
                                <div className="p-2 bg-brand-primary/10 rounded-lg border border-brand-primary/20 text-brand-primary">
                                    <Globe size={20} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Base Domain</p>
                                    <p className="text-sm font-black text-white truncate">{results.domain}</p>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4">
                                <div className="p-2 bg-neon-magenta/10 rounded-lg border border-neon-magenta/20 text-neon-magenta">
                                    <Database size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Assets Found</p>
                                    <p className="text-sm font-black text-white truncate">{results.count}</p>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4">
                                <div className="p-2 bg-neon-cyan/10 rounded-lg border border-neon-cyan/20 text-neon-cyan">
                                    <Share2 size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">System Status</p>
                                    <p className="text-sm font-black text-neon-green">SYNCED</p>
                                </div>
                            </motion.div>
                        </div>
                    )}

                    {/* Results Table & Console */}
                    <div className="flex-1 min-h-0 flex flex-col gap-6">
                        <div className="flex items-center justify-between px-2">
                            <div className="flex items-center gap-2">
                                <Network size={16} className="text-brand-primary" />
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Asset Inventory</h3>
                            </div>
                            {results && (
                                <button 
                                    onClick={downloadCSV}
                                    className="flex items-center gap-2 px-4 py-2 bg-ui-surface/60 border border-ui-border/40 rounded-xl text-[9px] font-black uppercase tracking-widest text-brand-primary hover:bg-brand-primary/10 hover:border-brand-primary/40 transition-all active:scale-95 group"
                                >
                                    <Download size={12} className="group-hover:translate-y-0.5 transition-transform" />
                                    DOWNLOAD_REPORT.CSV
                                </button>
                            )}
                        </div>

                        <div className="glass-panel border-ui-border/30 bg-ui-surface/40 flex-1 flex flex-col shadow-2xl relative overflow-hidden min-h-[400px]">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/5 blur-3xl pointer-events-none" />

                            <div className="flex-1 overflow-auto relative z-10 custom-scrollbar shadow-inner-glow">
                                {results ? (
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-ui-bg/80 text-ui-muted font-mono text-[9px] uppercase tracking-[0.2em] sticky top-0 backdrop-blur-md z-20">
                                            <tr>
                                                <th className="p-4 border-b border-ui-border/30">Subdomain</th>
                                                <th className="p-4 border-b border-ui-border/30">IP Address</th>
                                                <th className="p-4 border-b border-ui-border/30">Node State</th>
                                                <th className="p-4 border-b border-ui-border/30 text-right">A</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-ui-border/10">
                                            {results.subdomains.map((sub, index) => (
                                                <motion.tr
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: index * 0.015 }}
                                                    key={index}
                                                    className="hover:bg-brand-primary/5 transition-all font-mono group"
                                                >
                                                    <td className="p-4">
                                                        <span className="text-brand-primary text-xs font-black uppercase">{sub.subdomain}</span>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="text-[10px] text-ui-muted">{sub.ip}</span>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${sub.status === 'active' ? 'bg-neon-green/10 text-neon-green border-neon-green/20' :
                                                            sub.status === 'inactive' ? 'bg-neon-red/10 text-neon-red border-neon-red/20' :
                                                                'bg-ui-border/20 text-ui-muted border-ui-border/30'
                                                            }`}>
                                                            {sub.status}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <a href={`http://${sub.subdomain}`} target="_blank" rel="noreferrer" className="text-brand-primary hover:text-white transition-colors">
                                                            <ExternalLink size={12} />
                                                        </a>
                                                    </td>
                                                </motion.tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-ui-muted gap-6 p-20 text-center">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-brand-primary/20 blur-3xl rounded-full" />
                                            <div className="w-24 h-24 rounded-3xl bg-ui-surface/60 border border-ui-border/30 flex items-center justify-center relative z-10">
                                                <Search size={48} className="text-brand-primary opacity-50" />
                                            </div>
                                        </div>
                                        <div className="space-y-2 max-w-xs">
                                            <p className="text-xs font-black uppercase tracking-[0.3em] text-white">Discovery Idle</p>
                                            <p className="text-[10px] font-mono opacity-60">Ready to map certificate assets and identify hidden subdomains.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Industrial Discovery Log */}
                        <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[180px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0 mb-20">
                            <div className="bg-ui-surface p-2 text-ui-muted flex items-center justify-between border-b border-ui-border/30 uppercase tracking-widest font-black">
                                <div className="flex items-center gap-2">
                                    <TerminalIcon size={12} className="text-brand-primary" /> DISCOVERY LOG // ASSET_MAP
                                </div>
                                <div className="text-[8px] opacity-50 font-mono">UPLINK_LIVE</div>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto space-y-1.5 custom-scrollbar text-slate-400 bg-black/20">
                                {consoleOutput.map((log, i) => (
                                    <div key={i} className="opacity-80 border-l border-ui-border/50 pl-2 leading-relaxed hover:bg-white/5 transition-colors">{log}</div>
                                ))}
                                {loading && (
                                    <div className="flex items-center gap-2 text-brand-primary animate-pulse py-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                                        <span className="tracking-widest capitalize">Executing discovery engine...</span>
                                    </div>
                                )}
                                {consoleOutput.length === 0 && !loading && (
                                    <div className="text-ui-muted/20 italic">Awaiting target Acquisition command.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default SubdomainEnum;
