import React, { useState } from 'react';
import { Globe, Search, Link as LinkIcon, ExternalLink, Activity, Network, Server, Shield, Terminal as TerminalIcon, Settings, Zap, Target, Database, ChevronRight, Download } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';

const WebCrawler: React.FC = () => {
    const [url, setUrl] = useState('');
    const [depth, setDepth] = useState(1);
    const [userAgent, setUserAgent] = useState('CyberArena-SecurityScanner/1.0');
    const [extractAssets, setExtractAssets] = useState(false);
    const [searchPattern, setSearchPattern] = useState('');
    const [delay, setDelay] = useState(0);
    const [activeTab, setActiveTab] = useState<'links' | 'assets' | 'findings'>('links');

    const [results, setResults] = useState<{
        links_found: number,
        links: { url: string, text: string, type: string, depth: number }[],
        assets_found?: number,
        assets?: { url: string, type: string }[],
        findings_found?: number,
        findings?: { match: string, url: string, context: string }[],
        url: string,
        metadata: {
            title: string,
            server: string,
            status_code: number
        }
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const downloadCSV = () => {
        if (!results) return;
        
        let csvContent = "";
        let fileName = "";
        
        if (activeTab === 'links') {
            const headers = ["Text", "Type", "Depth", "URL"];
            csvContent = [
                headers.join(","),
                ...results.links.map(l => `"${l.text}","${l.type}","${l.depth}","${l.url}"`)
            ].join("\n");
            fileName = "endpoints_map";
        } else if (activeTab === 'assets') {
            const headers = ["Type", "URL"];
            csvContent = [
                headers.join(","),
                ...(results.assets || []).map(a => `"${a.type}","${a.url}"`)
            ].join("\n");
            fileName = "resource_assets";
        } else if (activeTab === 'findings') {
            const headers = ["Match", "Context", "Source URL"];
            csvContent = [
                headers.join(","),
                ...(results.findings || []).map(f => `"${f.match}","${f.context}","${f.url}"`)
            ].join("\n");
            fileName = "pattern_findings";
        }
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", blobUrl);
        link.setAttribute("download", `crawler_${fileName}_${url.replace(/[^a-z0-9]/gi, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        addToConsole(`CORE: Generated ${activeTab} data export. Report available locally.`);
    };

    const startCrawl = async () => {
        if (!url) {
            addToConsole("CRITICAL ERROR: No target URL specified.");
            return;
        }

        setLoading(true);
        setResults(null);
        setConsoleOutput([]);

        addToConsole(`CORE: Initializing Pro-Mapper Engine...`);
        addToConsole(`TARGET: ${url}`);
        addToConsole(`CONFIG: Depth=${depth}, AssetDetection=${extractAssets ? 'ON' : 'OFF'}`);
        addToConsole(`UA: ${userAgent}`);
        if (searchPattern) addToConsole(`Deep Search: Pattern "${searchPattern}" active.`);
        if (delay > 0) addToConsole(`Stealth: ${delay}s request throttling enabled.`);

        try {
            const response = await api.post('/api/crawl', {
                url,
                depth,
                user_agent: userAgent,
                extract_assets: extractAssets,
                search_pattern: searchPattern,
                delay: delay
            });
            const data = response.data;
            setResults(data);

            addToConsole(`SYSTEM: Multi-level mapping complete.`);
            addToConsole(`DATA: ${data.links_found} links mapped across ${depth} level(s).`);
            if (extractAssets) addToConsole(`ASSETS: ${data.assets_found} resources discovered.`);
            if (data.findings_found > 0) {
                addToConsole(`ALERT: Found ${data.findings_found} pattern matches! Check Findings tab.`);
                setActiveTab('findings');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.detail || "Could not connect to crawler engine.";
            addToConsole(`CRITICAL FAILURE: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="Advanced Web Mapper" icon={Globe} status={loading ? 'running' : 'idle'}>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-full">

                {/* Left Control Panel */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto custom-scrollbar pr-2 pb-20">
                    <div className="glass-panel p-6 border-ui-border/30 shadow-inner-glow relative overflow-hidden scanlines">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                <Settings size={14} className="text-brand-primary" />
                                Tactical Config
                            </h3>
                            <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" />
                            </div>
                        </div>

                        <div className="space-y-5">
                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">Target URL</label>
                                <input
                                    type="text"
                                    placeholder="https://example.com"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3 px-4 text-sm font-mono text-white focus:border-brand-primary/50 outline-none transition-all"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block flex justify-between">
                                    Crawl Depth <span>{depth}</span>
                                </label>
                                <input
                                    type="range" min="1" max="3" step="1"
                                    value={depth} onChange={(e) => setDepth(parseInt(e.target.value))}
                                    className="w-full h-1 bg-ui-border/30 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                />
                                <div className="flex justify-between text-[8px] text-ui-muted mt-1 font-mono">
                                    <span>LEVEL 1</span>
                                    <span>LEVEL 3</span>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">User-Agent Profile</label>
                                <select
                                    value={userAgent}
                                    onChange={(e) => setUserAgent(e.target.value)}
                                    className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-2 px-3 text-[10px] font-mono text-white outline-none focus:border-brand-primary/50"
                                >
                                    <option value="CyberArena-SecurityScanner/1.0">CyberArena Default</option>
                                    <option value="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36">Chrome / Windows</option>
                                    <option value="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1">Mobile / Safari</option>
                                    <option value="Googlebot/2.1 (+http://www.google.com/bot.html)">Googlebot</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">Deep Search (Regex)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. [a-zA-Z0-9.-]+@[a-z]+"
                                    value={searchPattern}
                                    onChange={(e) => setSearchPattern(e.target.value)}
                                    className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-2 px-3 text-[10px] font-mono text-white focus:border-brand-primary/50 outline-none transition-all"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block flex justify-between">
                                    Stealth Delay <span>{delay}s</span>
                                </label>
                                <input
                                    type="range" min="0" max="5" step="0.5"
                                    value={delay} onChange={(e) => setDelay(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-ui-border/30 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                />
                            </div>

                            <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-ui-border/20">
                                <span className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-wider">Map Resources</span>
                                <button
                                    onClick={() => setExtractAssets(!extractAssets)}
                                    className={`w-10 h-5 rounded-full transition-all relative ${extractAssets ? 'bg-brand-primary' : 'bg-ui-border/30'}`}
                                >
                                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${extractAssets ? 'right-1' : 'left-1'}`} />
                                </button>
                            </div>

                            <button
                                onClick={startCrawl}
                                disabled={loading}
                                className={`cyber-button w-full py-4 text-xs tracking-[0.3em] flex items-center justify-center gap-3 mt-4 ${loading ? 'opacity-50 grayscale cursor-not-allowed' : 'cyber-button-primary'
                                    }`}
                            >
                                {loading ? <Activity className="animate-spin" size={16} /> : <Network size={16} />}
                                {loading ? 'ENGAGING...' : 'START MAPPING'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Results Panel */}
                <div className="lg:col-span-3 space-y-6 flex flex-col min-h-0">

                    {/* Summary Row */}
                    {results && (
                        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${results.findings_found !== undefined ? '5' : '4'} gap-4`}>
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4 shadow-lg">
                                <div className="p-2 bg-brand-primary/10 rounded-lg border border-brand-primary/20 text-brand-primary">
                                    <Target size={20} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Site Title</p>
                                    <p className="text-sm font-black text-white truncate">{results.metadata.title}</p>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4 shadow-lg">
                                <div className="p-2 bg-neon-cyan/10 rounded-lg border border-neon-cyan/20 text-neon-cyan">
                                    <Server size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Server Type</p>
                                    <p className="text-sm font-black text-white truncate">{results.metadata.server}</p>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4 shadow-lg">
                                <div className={`p-2 rounded-lg border ${results.metadata.status_code < 400 ? 'bg-neon-green/10 border-neon-green/20 text-neon-green' : 'bg-neon-red/10 border-neon-red/20 text-neon-red'}`}>
                                    <Shield size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Status Code</p>
                                    <p className={`text-sm font-black ${results.metadata.status_code < 400 ? 'text-neon-green' : 'text-neon-red'}`}>{results.metadata.status_code}</p>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel p-4 border-ui-border/30 bg-ui-surface/40 flex items-center gap-4 shadow-lg">
                                <div className="p-2 bg-neon-magenta/10 rounded-lg border border-neon-magenta/20 text-neon-magenta">
                                    <Database size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Endpoints</p>
                                    <p className="text-sm font-black text-white">{results.links_found}</p>
                                </div>
                            </motion.div>

                            {results.findings_found !== undefined && (
                                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }} className="glass-panel p-4 border-neon-yellow/30 bg-neon-yellow/5 flex items-center gap-4 shadow-lg">
                                    <div className="p-2 bg-neon-yellow/10 rounded-lg border border-neon-yellow/20 text-neon-yellow">
                                        <Search size={20} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-mono text-neon-yellow uppercase tracking-widest">Findings</p>
                                        <p className="text-sm font-black text-white">{results.findings_found}</p>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    )}

                    {/* Results Table & Console */}
                    <div className="flex-1 min-h-0 flex flex-col gap-6">
                        <div className="flex-1 flex flex-col gap-4">
                             {/* Tabs/Actions Header */}
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-6">
                                    <button
                                        onClick={() => setActiveTab('links')}
                                        className={`pb-1 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === 'links' ? 'text-brand-primary border-brand-primary' : 'text-ui-muted border-transparent hover:text-white'}`}
                                    >
                                        Endpoints Map
                                    </button>
                                    {extractAssets && (
                                        <button
                                            onClick={() => setActiveTab('assets')}
                                            className={`pb-1 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === 'assets' ? 'text-brand-primary border-brand-primary' : 'text-ui-muted border-transparent hover:text-white'}`}
                                        >
                                            Resource Assets
                                        </button>
                                    )}
                                    {results?.findings && results.findings.length > 0 && (
                                        <button
                                            onClick={() => setActiveTab('findings')}
                                            className={`pb-1 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === 'findings' ? 'text-neon-yellow border-neon-yellow' : 'text-ui-muted border-transparent hover:text-white'}`}
                                        >
                                            Pattern Findings
                                        </button>
                                    )}
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
                                        activeTab === 'links' ? (
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-ui-bg/80 text-ui-muted font-mono text-[9px] uppercase tracking-[0.2em] sticky top-0 backdrop-blur-md z-20">
                                                    <tr>
                                                        <th className="p-4 border-b border-ui-border/30">Identifier</th>
                                                        <th className="p-4 border-b border-ui-border/30">Node Type</th>
                                                        <th className="p-4 border-b border-ui-border/30">Depth</th>
                                                        <th className="p-4 border-b border-ui-border/30">Resource URL</th>
                                                        <th className="p-4 border-b border-ui-border/30 text-right">A</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-ui-border/10">
                                                    {results.links.map((link, index) => (
                                                        <motion.tr
                                                            initial={{ opacity: 0, x: -10 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            transition={{ delay: index * 0.015 }}
                                                            key={index}
                                                            className="hover:bg-brand-primary/5 transition-all font-mono group"
                                                        >
                                                            <td className="p-4">
                                                                <span className="text-slate-200 text-xs font-black uppercase truncate block max-w-[150px]">{link.text}</span>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${link.type === 'internal' ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20' : 'bg-neon-magenta/10 text-neon-magenta border-neon-magenta/20'
                                                                    }`}>
                                                                    {link.type}
                                                                </span>
                                                            </td>
                                                            <td className="p-4">
                                                                <div className="flex gap-1">
                                                                    {[...Array(link.depth)].map((_, i) => (
                                                                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className="text-[9px] text-ui-muted truncate block max-w-[250px] group-hover:text-white">
                                                                    {link.url}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-right">
                                                                <a href={link.url} target="_blank" rel="noreferrer" className="text-brand-primary hover:text-white">
                                                                    <ExternalLink size={12} />
                                                                </a>
                                                            </td>
                                                        </motion.tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : activeTab === 'assets' ? (
                                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                                {results.assets?.map((asset, index) => (
                                                    <div key={index} className="bg-white/5 border border-ui-border/20 p-3 rounded-xl flex items-center gap-3 hover:border-brand-primary/30 transition-all">
                                                        <div className={`p-2 rounded-lg ${asset.type === 'image' ? 'bg-neon-cyan/10 text-neon-cyan' : asset.type === 'script' ? 'bg-neon-yellow/10 text-neon-yellow' : 'bg-neon-magenta/10 text-neon-magenta'}`}>
                                                            {asset.type === 'image' ? <Zap size={14} /> : <TerminalIcon size={14} />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[8px] font-mono text-ui-muted uppercase">{asset.type}</p>
                                                            <p className="text-[10px] font-mono text-white truncate">{asset.url}</p>
                                                        </div>
                                                        <a href={asset.url} target="_blank" rel="noreferrer" className="text-ui-muted hover:text-white">
                                                            <ExternalLink size={12} />
                                                        </a>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-ui-bg/80 text-ui-muted font-mono text-[9px] uppercase tracking-[0.2em] sticky top-0 backdrop-blur-md z-20">
                                                    <tr>
                                                        <th className="p-4 border-b border-ui-border/30">Match</th>
                                                        <th className="p-4 border-b border-ui-border/30">Context</th>
                                                        <th className="p-4 border-b border-ui-border/30">Source URL</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-ui-border/10">
                                                    {results.findings?.map((finding, index) => (
                                                        <motion.tr
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            key={index}
                                                            className="hover:bg-neon-yellow/5 transition-all font-mono group"
                                                        >
                                                            <td className="p-4">
                                                                <span className="text-neon-yellow text-xs font-black px-2 py-0.5 bg-neon-yellow/10 rounded">{finding.match}</span>
                                                            </td>
                                                            <td className="p-4 text-[10px] text-ui-muted uppercase font-bold">{finding.context}</td>
                                                            <td className="p-4">
                                                                <span className="text-[9px] text-ui-muted truncate block max-w-[400px] group-hover:text-white">
                                                                    {finding.url}
                                                                </span>
                                                            </td>
                                                        </motion.tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-ui-muted gap-6 p-20 text-center">
                                            <div className="relative">
                                                <div className="absolute inset-0 bg-brand-primary/20 blur-3xl rounded-full" />
                                                <div className="w-24 h-24 rounded-3xl bg-ui-surface/60 border border-ui-border/30 flex items-center justify-center relative z-10">
                                                    <Globe size={48} className="text-brand-primary opacity-50" />
                                                </div>
                                            </div>
                                            <div className="space-y-2 max-w-xs">
                                                <p className="text-xs font-black uppercase tracking-[0.3em] text-white">Engines Idle</p>
                                                <p className="text-[10px] font-mono opacity-60">Ready for automated reconnaissance through target infrastructure.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Industrial Discovery Log */}
                        <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[180px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0 mb-20">
                            <div className="bg-ui-surface p-2 text-ui-muted flex items-center justify-between border-b border-ui-border/30 uppercase tracking-widest font-black">
                                <div className="flex items-center gap-2">
                                    <TerminalIcon size={12} className="text-brand-primary" /> DISCOVERY LOG // WEB_MAPPER
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
                                        <span className="tracking-widest capitalize">Executing mapper engine...</span>
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

export default WebCrawler;
