import React, { useState } from 'react';
import { Zap, Search, Download, Terminal as TerminalIcon, Activity, FileText } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

interface FfufResult {
    input: string;
    url: string;
    status: number;
    length: number;
    words: number;
    lines: number;
    duration: number;
}

const FFUF: React.FC = () => {
    const [target, setTarget] = useState('');
    const [wordlist, setWordlist] = useState('common');
    const [method, setMethod] = useState('GET');
    const [filterStatus, setFilterStatus] = useState('404');
    const [threads, setThreads] = useState(40);
    const [postData, setPostData] = useState('');
    const [results, setResults] = useState<FfufResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [rawOutput, setRawOutput] = useState('');
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const getStatusColor = (status: number) => {
        if (status >= 200 && status < 300) return 'bg-neon-green/10 text-neon-green border-neon-green/30';
        if (status >= 300 && status < 400) return 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30';
        if (status >= 400 && status < 500) return 'bg-neon-red/10 text-neon-red border-neon-red/30';
        return 'bg-brand-secondary/10 text-brand-secondary border-brand-secondary/30';
    };

    const downloadResults = () => {
        if (results.length === 0) return;
        const header = ['Input', 'URL', 'Status', 'Length', 'Words', 'Lines'].join(',');
        const csvRows = [
            header,
            ...results.map(r => `"${r.input}","${r.url}","${r.status}","${r.length}","${r.words}","${r.lines}"`)
        ].join('\n');
        const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `cyberarena_ffuf_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        addToConsole('CORE: Export archive generated. File ready.');
    };

    const startFuzz = async () => {
        if (!target) return;
        setLoading(true);
        setResults([]);
        setConsoleOutput([]);
        setRawOutput('');
        setAssessment(null);

        addToConsole('CORE: Initializing FFUF Fuzzing Engine...');
        addToConsole(`TARGET: ${target}`);
        addToConsole(`CONFIG: Wordlist=${wordlist} | Method=${method} | Threads=${threads} | Filter=${filterStatus}`);
        addToConsole('STATUS: Engaging remote endpoint...');

        try {
            const response = await api.post('/api/v1/ffuf', {
                url: target,
                wordlist,
                method,
                filter_status: filterStatus,
                threads,
                data: postData,
            });
            const data = response.data;
            if (data.status === 'success') {
                setResults(data.results);
                setRawOutput(data.raw_output || '');
                setAssessment(data.assessment || null);
                addToConsole(`SYSTEM: Fuzzing complete. ${data.count} results identified.`);
                if (data.count === 0) {
                    addToConsole('INFO: No results found. Try a different wordlist or adjust the filter.');
                }
            }
        } catch (error: any) {
            const msg = error.response?.data?.detail || 'Uplink failure during fuzzing.';
            addToConsole(`CRITICAL FAILURE: ${msg}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="FFUF Web Fuzzer" icon={Zap} status={loading ? 'running' : 'idle'}>
            <div className="flex flex-col h-full gap-6">

                {/* Config Panel */}
                <div className="glass-panel border-ui-border/30 p-6 rounded-2xl shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/20 to-transparent" />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* URL */}
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                Target URL <span className="text-brand-secondary">(use FUZZ keyword)</span>
                            </label>
                            <div className="flex gap-4">
                                <input
                                    type="text"
                                    placeholder="http://target.com/FUZZ"
                                    value={target}
                                    onChange={e => setTarget(e.target.value)}
                                    className="flex-1 bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white placeholder-ui-muted/30 focus:border-brand-primary/50 outline-none transition-all shadow-inner-glow"
                                />
                                <button
                                    onClick={startFuzz}
                                    disabled={loading || !target}
                                    className="bg-brand-primary hover:bg-brand-primary/90 text-white font-black py-4 px-10 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-3 text-[11px] tracking-widest disabled:opacity-50 shrink-0"
                                >
                                    {loading ? <Search className="animate-spin" size={18} /> : <Zap size={18} />}
                                    {loading ? 'FUZZING...' : 'START_FUZZ'}
                                </button>
                            </div>
                        </div>

                        {/* Wordlist */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">Wordlist</label>
                            <select
                                value={wordlist}
                                onChange={e => setWordlist(e.target.value)}
                                className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white focus:border-brand-primary/50 outline-none transition-all appearance-none"
                            >
                                <option value="common">Common (common.txt)</option>
                                <option value="directories">Directories</option>
                                <option value="passwords">Passwords</option>
                            </select>
                        </div>

                        {/* Method */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">HTTP Method</label>
                            <select
                                value={method}
                                onChange={e => setMethod(e.target.value)}
                                className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white focus:border-brand-primary/50 outline-none transition-all appearance-none"
                            >
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="DELETE">DELETE</option>
                            </select>
                        </div>

                        {/* Filter Status */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                Filter Status Codes <span className="text-ui-muted/50">(comma-separated)</span>
                            </label>
                            <input
                                type="text"
                                value={filterStatus}
                                onChange={e => setFilterStatus(e.target.value)}
                                placeholder="404,403"
                                className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white placeholder-ui-muted/30 focus:border-brand-primary/50 outline-none transition-all"
                            />
                        </div>

                        {/* Threads */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                Threads: <span className="text-brand-primary">{threads}</span>
                            </label>
                            <input
                                type="range"
                                min={1}
                                max={100}
                                value={threads}
                                onChange={e => setThreads(Number(e.target.value))}
                                className="w-full accent-brand-primary mt-3"
                            />
                        </div>

                        {/* POST Data */}
                        {method === 'POST' && (
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">POST Data</label>
                                <input
                                    type="text"
                                    value={postData}
                                    onChange={e => setPostData(e.target.value)}
                                    placeholder="username=FUZZ&password=admin"
                                    className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white placeholder-ui-muted/30 focus:border-brand-primary/50 outline-none transition-all"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {assessment && <AssessmentPanel assessment={assessment} target={target} />}

                {/* Results */}
                <div className="flex-1 min-h-0 flex flex-col gap-6">
                    <div className="flex-1 flex flex-col gap-4 min-h-[250px]">
                        {results.length > 0 && (
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-neon-green shadow-glow-green" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-ui-muted">
                                        Fuzzing Result // {results.length} Hits Found
                                    </span>
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
                            {results.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs font-mono">
                                        <thead>
                                            <tr className="text-[9px] font-black uppercase tracking-widest text-ui-muted border-b border-ui-border/20">
                                                <th className="text-left py-3 px-4">Input / Path</th>
                                                <th className="text-left py-3 px-4">Status</th>
                                                <th className="text-right py-3 px-4">Size</th>
                                                <th className="text-right py-3 px-4">Words</th>
                                                <th className="text-right py-3 px-4">Lines</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {results.map((r, i) => (
                                                <motion.tr
                                                    key={i}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: i * 0.03 }}
                                                    className="border-b border-ui-border/10 hover:bg-white/5 transition-colors group"
                                                >
                                                    <td className="py-3 px-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-white font-bold">{r.input || '/'}</span>
                                                            <span className="text-ui-muted/50 text-[9px] truncate max-w-[300px]">{r.url}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${getStatusColor(r.status)}`}>
                                                            {r.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-right text-ui-muted">{r.length}</td>
                                                    <td className="py-3 px-4 text-right text-ui-muted">{r.words}</td>
                                                    <td className="py-3 px-4 text-right text-ui-muted">{r.lines}</td>
                                                </motion.tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                !loading && (
                                    <div className="h-full flex flex-col items-center justify-center text-ui-muted/20 gap-6 py-12">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-brand-primary/10 blur-3xl rounded-full" />
                                            <FileText size={100} className="relative z-10" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xl font-black uppercase tracking-widest text-white/20">Fuzzer Standby</p>
                                            <p className="text-sm font-mono mt-2">Enter a target URL with the FUZZ keyword and start the scan.</p>
                                        </div>
                                    </div>
                                )
                            )}
                            {loading && results.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-ui-muted/30 gap-6 py-12">
                                    <Activity size={64} className="animate-spin text-brand-primary opacity-20" />
                                    <p className="text-xs font-black uppercase tracking-[0.3em] animate-pulse">Fuzzing target...</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Console Log */}
                    <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[180px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0">
                        <div className="bg-ui-surface p-2 text-ui-muted flex items-center justify-between border-b border-ui-border/30 uppercase tracking-widest font-black">
                            <div className="flex items-center gap-2">
                                <TerminalIcon size={12} className="text-brand-primary" /> FFUF LOG // WEB_FUZZER
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
                                    <span className="tracking-widest capitalize">Executing fuzzing sequence...</span>
                                </div>
                            )}
                            {consoleOutput.length === 0 && !loading && (
                                <div className="text-ui-muted/20 italic">Awaiting fuzzing command.</div>
                            )}
                        </div>
                    </div>

                    {/* Raw Output */}
                    {rawOutput && (
                        <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[200px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0">
                            <div className="bg-ui-surface p-2 text-ui-muted flex items-center gap-2 border-b border-ui-border/30 uppercase tracking-widest font-black">
                                <TerminalIcon size={12} className="text-brand-secondary" /> RAW OUTPUT
                            </div>
                            <pre className="p-4 flex-1 overflow-y-auto text-slate-400 bg-black/20 whitespace-pre-wrap text-[9px] leading-relaxed custom-scrollbar">
                                {rawOutput}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </ToolLayout>
    );
};

export default FFUF;
