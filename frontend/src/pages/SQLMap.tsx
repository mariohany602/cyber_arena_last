import React, { useState } from 'react';
import { Database, Search, Download, Terminal as TerminalIcon, Activity, FileText, AlertTriangle, ShieldCheck } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

interface SqlVuln {
    parameter: string;
    type: string;
    technique: string;
    payload: string;
}

const SQLMap: React.FC = () => {
    const [target, setTarget] = useState('');
    const [postData, setPostData] = useState('');
    const [level, setLevel] = useState(1);
    const [risk, setRisk] = useState(1);
    const [dbms, setDbms] = useState('');
    const [vulns, setVulns] = useState<SqlVuln[]>([]);
    const [isVulnerable, setIsVulnerable] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [rawOutput, setRawOutput] = useState('');
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const addToConsole = (msg: string) => {
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const downloadResults = () => {
        if (vulns.length === 0 && !rawOutput) return;
        const content = [
            `SQLMap Scan Report — ${target}`,
            `Date: ${new Date().toISOString()}`,
            `Vulnerable: ${isVulnerable ? 'YES' : 'NO'}`,
            '',
            '--- VULNERABILITIES ---',
            ...vulns.map(v => `Parameter: ${v.parameter} | Type: ${v.type} | Payload: ${v.payload}`),
            '',
            '--- RAW OUTPUT ---',
            rawOutput,
        ].join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `cyberarena_sqlmap_${Date.now()}.txt`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        addToConsole('CORE: Export generated.');
    };

    const startScan = async () => {
        if (!target) return;
        setLoading(true);
        setVulns([]);
        setIsVulnerable(null);
        setConsoleOutput([]);
        setRawOutput('');
        setAssessment(null);

        addToConsole('CORE: Initializing SQLMap Injection Engine...');
        addToConsole(`TARGET: ${target}`);
        addToConsole(`CONFIG: Level=${level} | Risk=${risk}${dbms ? ` | DBMS=${dbms}` : ''}`);
        addToConsole('STATUS: Probing for SQL injection vectors...');

        try {
            const response = await api.post('/api/sqlmap', {
                url: target,
                data: postData,
                level,
                risk,
                dbms,
            });
            const data = response.data;
            if (data.status === 'success') {
                setVulns(data.vulnerabilities);
                setIsVulnerable(data.vulnerable);
                setRawOutput(data.raw_output || '');
                setAssessment(data.assessment || null);

                if (data.vulnerable) {
                    addToConsole(`ALERT: Target is VULNERABLE. ${data.vulnerabilities_found} injection point(s) identified.`);
                } else {
                    addToConsole('INFO: No SQL injection vulnerabilities detected. Target may be patched or protected.');
                }
            }
        } catch (error: any) {
            const msg = error.response?.data?.detail || 'Uplink failure during injection scan.';
            addToConsole(`CRITICAL FAILURE: ${msg}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ToolLayout title="SQLMap Injection Scanner" icon={Database} status={loading ? 'running' : 'idle'}>
            <div className="flex flex-col h-full gap-6">

                {/* Config Panel */}
                <div className="glass-panel border-ui-border/30 p-6 rounded-2xl shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-secondary/20 to-transparent" />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Target URL */}
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">Target URL</label>
                            <div className="flex gap-4">
                                <input
                                    type="text"
                                    placeholder="http://target.com/page.php?id=1"
                                    value={target}
                                    onChange={e => setTarget(e.target.value)}
                                    className="flex-1 bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white placeholder-ui-muted/30 focus:border-brand-secondary/50 outline-none transition-all shadow-inner-glow"
                                />
                                <button
                                    onClick={startScan}
                                    disabled={loading || !target}
                                    className="bg-brand-secondary hover:bg-brand-secondary/90 text-white font-black py-4 px-10 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-3 text-[11px] tracking-widest disabled:opacity-50 shrink-0"
                                >
                                    {loading ? <Search className="animate-spin" size={18} /> : <Database size={18} />}
                                    {loading ? 'SCANNING...' : 'START_SCAN'}
                                </button>
                            </div>
                        </div>

                        {/* POST Data */}
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                POST Data <span className="text-ui-muted/50 normal-case">(optional, for POST requests)</span>
                            </label>
                            <input
                                type="text"
                                value={postData}
                                onChange={e => setPostData(e.target.value)}
                                placeholder="username=admin&password=test"
                                className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white placeholder-ui-muted/30 focus:border-brand-secondary/50 outline-none transition-all"
                            />
                        </div>

                        {/* Level */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                Level: <span className="text-brand-secondary">{level}</span> / 5
                            </label>
                            <input
                                type="range"
                                min={1}
                                max={5}
                                value={level}
                                onChange={e => setLevel(Number(e.target.value))}
                                className="w-full accent-brand-secondary mt-3"
                            />
                            <p className="text-[9px] text-ui-muted/50 mt-1 font-mono">Higher = more thorough, slower</p>
                        </div>

                        {/* Risk */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                Risk: <span className="text-neon-red">{risk}</span> / 3
                            </label>
                            <input
                                type="range"
                                min={1}
                                max={3}
                                value={risk}
                                onChange={e => setRisk(Number(e.target.value))}
                                className="w-full accent-neon-red mt-3"
                            />
                            <p className="text-[9px] text-ui-muted/50 mt-1 font-mono">Higher = more aggressive payloads</p>
                        </div>

                        {/* DBMS */}
                        <div>
                            <label className="text-[10px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mb-2 block">
                                Target DBMS <span className="text-ui-muted/50">(optional)</span>
                            </label>
                            <select
                                value={dbms}
                                onChange={e => setDbms(e.target.value)}
                                className="w-full bg-ui-surface/40 border border-ui-border/40 p-4 rounded-xl font-mono text-white focus:border-brand-secondary/50 outline-none transition-all appearance-none"
                            >
                                <option value="">Auto-detect</option>
                                <option value="MySQL">MySQL</option>
                                <option value="PostgreSQL">PostgreSQL</option>
                                <option value="MSSQL">MSSQL</option>
                                <option value="Oracle">Oracle</option>
                                <option value="SQLite">SQLite</option>
                                <option value="MariaDB">MariaDB</option>
                            </select>
                        </div>
                    </div>
                </div>

                {assessment && <AssessmentPanel assessment={assessment} target={target} />}

                {/* Vulnerability Status Banner */}
                {isVulnerable !== null && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`glass-panel p-5 rounded-2xl border flex items-center gap-5 ${isVulnerable
                                ? 'border-neon-red/40 bg-neon-red/5'
                                : 'border-neon-green/40 bg-neon-green/5'
                            }`}
                    >
                        {isVulnerable ? (
                            <AlertTriangle size={32} className="text-neon-red shrink-0" />
                        ) : (
                            <ShieldCheck size={32} className="text-neon-green shrink-0" />
                        )}
                        <div>
                            <p className={`font-black uppercase tracking-widest text-sm ${isVulnerable ? 'text-neon-red' : 'text-neon-green'}`}>
                                {isVulnerable ? '⚠ VULNERABLE — SQL Injection Detected' : '✓ Target Appears Secure'}
                            </p>
                            <p className="text-[11px] text-ui-muted mt-1 font-mono">
                                {isVulnerable
                                    ? `${vulns.length} injection point(s) found. Review results below.`
                                    : 'No SQL injection vectors found with current level/risk settings.'
                                }
                            </p>
                        </div>
                    </motion.div>
                )}

                {/* Results */}
                <div className="flex-1 min-h-0 flex flex-col gap-6">
                    <div className="flex-1 flex flex-col gap-4 min-h-[200px]">
                        {vulns.length > 0 && (
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-neon-red shadow-[0_0_8px_#ef4444]" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-ui-muted">
                                        Injection Points // {vulns.length} Found
                                    </span>
                                </div>
                                <button
                                    onClick={downloadResults}
                                    className="flex items-center gap-2 px-4 py-2 bg-ui-surface/60 border border-ui-border/40 rounded-xl text-[9px] font-black uppercase tracking-widest text-brand-secondary hover:bg-brand-secondary/10 hover:border-brand-secondary/40 transition-all active:scale-95 group"
                                >
                                    <Download size={12} className="group-hover:translate-y-0.5 transition-transform" />
                                    DOWNLOAD_REPORT
                                </button>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                            {vulns.length > 0 ? (
                                <div className="flex flex-col gap-4">
                                    {vulns.map((v, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.08 }}
                                            className="glass-panel border-neon-red/20 p-5 rounded-2xl relative overflow-hidden hover:border-neon-red/40 transition-all"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-neon-red/30 to-transparent" />
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div>
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-ui-muted mb-1">Parameter</p>
                                                    <p className="font-mono text-sm text-neon-red font-bold">{v.parameter}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-ui-muted mb-1">Injection Type</p>
                                                    <p className="font-mono text-sm text-white">{v.type}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-ui-muted mb-1">Technique</p>
                                                    <p className="font-mono text-sm text-brand-secondary">{v.technique}</p>
                                                </div>
                                                {v.payload && (
                                                    <div className="md:col-span-3">
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-ui-muted mb-1">Payload</p>
                                                        <p className="font-mono text-xs text-neon-yellow bg-black/30 p-2 rounded-lg break-all">{v.payload}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            ) : (
                                !loading && isVulnerable === null && (
                                    <div className="h-full flex flex-col items-center justify-center text-ui-muted/20 gap-6 py-12">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-brand-secondary/10 blur-3xl rounded-full" />
                                            <FileText size={100} className="relative z-10" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xl font-black uppercase tracking-widest text-white/20">Scanner Standby</p>
                                            <p className="text-sm font-mono mt-2">Enter a target URL to probe for SQL injection vulnerabilities.</p>
                                        </div>
                                    </div>
                                )
                            )}
                            {loading && (
                                <div className="h-full flex flex-col items-center justify-center text-ui-muted/30 gap-6 py-12">
                                    <Activity size={64} className="animate-spin text-brand-secondary opacity-20" />
                                    <p className="text-xs font-black uppercase tracking-[0.3em] animate-pulse">Probing injection vectors...</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Console Log */}
                    <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[180px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0">
                        <div className="bg-ui-surface p-2 text-ui-muted flex items-center justify-between border-b border-ui-border/30 uppercase tracking-widest font-black">
                            <div className="flex items-center gap-2">
                                <TerminalIcon size={12} className="text-brand-secondary" /> SQLMAP LOG // INJECTION_ENGINE
                            </div>
                            <div className="text-[8px] opacity-50 font-mono">UPLINK_LIVE</div>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto space-y-1.5 custom-scrollbar text-slate-400 bg-black/20">
                            {consoleOutput.map((log, i) => (
                                <div key={i} className="opacity-80 border-l border-ui-border/50 pl-2 leading-relaxed hover:bg-white/5 transition-colors">{log}</div>
                            ))}
                            {loading && (
                                <div className="flex items-center gap-2 text-brand-secondary animate-pulse py-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-brand-secondary" />
                                    <span className="tracking-widest capitalize">Running injection detection...</span>
                                </div>
                            )}
                            {consoleOutput.length === 0 && !loading && (
                                <div className="text-ui-muted/20 italic">Awaiting scan command.</div>
                            )}
                        </div>
                    </div>

                    {/* Raw Output Terminal */}
                    {rawOutput && (
                        <div className="glass-panel border-ui-border/30 bg-ui-bg/80 h-[220px] flex flex-col font-mono text-[10px] overflow-hidden shadow-2xl shrink-0">
                            <div className="bg-ui-surface p-2 text-ui-muted flex items-center gap-2 border-b border-ui-border/30 uppercase tracking-widest font-black">
                                <TerminalIcon size={12} className="text-neon-red" /> RAW SQLMAP OUTPUT
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

export default SQLMap;
