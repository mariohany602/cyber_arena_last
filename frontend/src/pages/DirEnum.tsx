import React, { useState } from 'react';
import { Folder, Search, FileText, Lock, Terminal as TerminalIcon, Activity, Download, CheckCircle } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

const DirEnum: React.FC = () => {
    const [target, setTarget] = useState('');
    const [dirs, setDirs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const downloadResults = () => {
        if (dirs.length === 0) return;
        
        const headers = ["Path", "Status", "Full URL"];
        const csvRows = [
            headers.join(","),
            ...dirs.map(d => `"${d.path}","${d.status}","${d.full_url}"`)
        ].join("\n");
        
        const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `cyberarena_dirs_${target.replace(/[^a-z0-9]/gi, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        addToConsole(`CORE: Generated export archive. File ready for local storage.`);
    };

    const startBrute = async () => {
        if (!target) return;
        setLoading(true);
        setDirs([]);
        setConsoleOutput([]);
        setAssessment(null);

        addToConsole(`CORE: Initializing Directory Discovery Engine...`);
        addToConsole(`TARGET: ${target}`);
        addToConsole(`MODE: Gobuster Enumeration // Wordlist: common.txt`);
        addToConsole(`STATUS: Engaging remote endpoint...`);

        try {
            const response = await api.post('/api/directories', { url: target });
            const data = response.data;
            if (data.status === 'success') {
                setDirs(data.directories);
                setAssessment(data.assessment || null);
                addToConsole(`SYSTEM: Enumeration complete. Identified ${data.count} directory assets.`);
            }
        } catch (error: any) {
            const errorMessage = error.response?.data?.detail || "Uplink failure or timeout during discovery.";
            addToConsole(`CRITICAL FAILURE: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="Directory Brute Force" icon={Folder} status={loading ? 'running' : 'idle'}>
            <div className="flex flex-col h-full gap-8">
                {/* Header Input */}
                <div className="glass-panel border-ui-border/30 p-6 rounded-2xl flex gap-6 items-center shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/20 to-transparent" />
                    
                    <div className="p-4 bg-brand-primary/10 rounded-xl text-brand-primary border border-brand-primary/20 shrink-0">
                        <Folder size={24} />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">Target Acquisition // URL</label>
                        <input
                            type="text"
                            placeholder="https://example.com"
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                            className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white placeholder-ui-muted/30 focus:border-brand-primary/50 outline-none transition-all shadow-inner-glow"
                        />
                    </div>
                    <button
                        onClick={startBrute}
                        disabled={loading}
                        className="bg-brand-primary hover:bg-brand-primary/90 text-white font-black py-4 px-10 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-3 text-[11px] tracking-widest disabled:opacity-50"
                    >
                        {loading ? <Search className="animate-spin" size={18} /> : <Folder size={18} />}
                        {loading ? "SEARCHING..." : "START_BRUTE"}
                    </button>
                </div>

                {assessment && <AssessmentPanel assessment={assessment} target={target} />}

                <div className="flex-1 min-h-0 flex flex-col gap-8">
                    {/* Results Grid with Action Bar */}
                    <div className="flex-1 flex flex-col gap-4 min-h-[300px]">
                        {dirs.length > 0 && (
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-neon-green shadow-glow-green" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-ui-muted">Discovery Result // {dirs.length} Assets Found</span>
                                </div>
                                <button 
                                    onClick={downloadResults}
                                    className="flex items-center gap-2 px-4 py-2 bg-ui-surface/60 border border-ui-border/40 rounded-xl text-[9px] font-black uppercase tracking-widest text-brand-primary hover:bg-brand-primary/10 hover:border-brand-primary/40 transition-all active:scale-95 group"
                                >
                                    <Download size={12} className="group-hover:translate-y-0.5 transition-transform" />
                                    DOWNLOAD_REPORT.CSV
                                </button>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                            {dirs.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {dirs.map((dir, index) => (
                                        <motion.div 
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            key={index} 
                                            className="glass-panel border-ui-border/30 p-5 flex items-center justify-between hover:border-brand-primary/50 hover:bg-ui-surface/80 transition-all group overflow-hidden relative"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/20 to-transparent" />
                                            
                                            <div className="flex items-center gap-4 relative z-10">
                                                <div className={`p-3 rounded-xl border ${
                                                    dir.path.includes('admin') || dir.path.includes('login') || dir.path.includes('config')
                                                    ? 'bg-neon-red/10 border-neon-red/30 text-neon-red' 
                                                    : 'bg-brand-primary/10 border-brand-primary/20 text-brand-primary'
                                                }`}>
                                                    {dir.path.includes('admin') || dir.path.includes('login') ? <Lock size={20} /> : <Folder size={20} />}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-mono text-sm text-white font-bold tracking-tight">{dir.path}</span>
                                                    <span className="text-[10px] text-ui-muted font-mono uppercase tracking-widest mt-0.5">Ref: {dir.full_url.split('//')[1].substring(0, 30)}...</span>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-end gap-1 relative z-10">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${
                                                    dir.status.startsWith('2') ? 'bg-neon-green/10 text-neon-green border-neon-green/30' :
                                                    dir.status.startsWith('3') ? 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30' :
                                                    'bg-neon-red/10 text-neon-red border-neon-red/30'
                                                }`}>
                                                    {dir.status} {dir.status.startsWith('2') ? 'OK' : dir.status.startsWith('3') ? 'REDIRECT' : 'ACCESS'}
                                                </span>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            ) : (
                                !loading && (
                                    <div className="h-full flex flex-col items-center justify-center text-ui-muted/20 gap-6 py-12">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-brand-primary/10 blur-3xl rounded-full" />
                                            <FileText size={120} className="relative z-10" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xl font-black uppercase tracking-widest text-white/20">Archive Standby</p>
                                            <p className="text-sm font-mono mt-2">Initialize brute-force sequence to index remote directory structure.</p>
                                        </div>
                                    </div>
                                )
                            )}
                            {loading && dirs.length === 0 && (
                                 <div className="h-full flex flex-col items-center justify-center text-ui-muted/30 gap-6 py-12">
                                    <Activity size={64} className="animate-spin text-brand-primary opacity-20" />
                                    <p className="text-xs font-black uppercase tracking-[0.3em] animate-pulse">Scanning target archive...</p>
                                 </div>
                            )}
                        </div>
                    </div>

                    {/* Industrial System Log */}
                    <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[180px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0">
                        <div className="bg-ui-surface p-2 text-ui-muted flex items-center justify-between border-b border-ui-border/30 uppercase tracking-widest font-black">
                            <div className="flex items-center gap-2">
                                <TerminalIcon size={12} className="text-brand-primary" /> DISCOVERY LOG // DIR_ENUM
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
                                    <span className="tracking-widest capitalize">Executing brute-force lookup...</span>
                                </div>
                            )}
                            {consoleOutput.length === 0 && !loading && (
                                <div className="text-ui-muted/20 italic">Awaiting target engagement command.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default DirEnum;
