import React, { useMemo, useState } from 'react';
import {
    Radar, Server, Shield, Search, Target, Zap, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../utils/api';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';
import ToolShell, {
    Field, PaneHeader, TerminalCard, FindingCard, EmptyPane,
} from '../components/tools/ToolShell';

const SCAN_TYPES = [
    { id: 'quick',      name: 'Quick',       flags: '-F',            description: 'Top 100 ports — fast' },
    { id: 'regular',    name: 'Regular',     flags: '',              description: 'Standard port discovery' },
    { id: 'aggressive', name: 'Aggressive',  flags: '-A',            description: 'OS + version + scripts' },
    { id: 'vuln',       name: 'Vulnerability', flags: '--script vuln', description: 'NSE vuln category' },
    { id: 'service',    name: 'Service',     flags: '-sV',           description: 'Version probes only' },
];

const NSE_SCRIPTS = [
    { id: '',          name: 'No scripts' },
    { id: 'vuln',      name: 'vuln' },
    { id: 'http-enum', name: 'http-enum' },
    { id: 'auth',      name: 'auth' },
    { id: 'discovery', name: 'discovery' },
];

interface PortResult {
    port: number;
    state: string;
    service: string;
    version?: string;
    scripts?: Record<string, string>;
}

export default function Scanner() {
    const [target, setTarget] = useState('');
    const [scanType, setScanType] = useState('quick');
    const [selectedScript, setSelectedScript] = useState('');
    const [noPing, setNoPing] = useState(false);

    const [results, setResults] = useState<PortResult[]>([]);
    const [hostStatus, setHostStatus] = useState<string | null>(null);
    const [hostScripts, setHostScripts] = useState<Record<string, string>>({});
    const [assessment, setAssessment] = useState<Assessment | null>(null);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [expandedPort, setExpandedPort] = useState<number | null>(null);

    const addToConsole = (msg: string) =>
        setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const status: 'idle' | 'running' | 'completed' | 'error' =
        loading ? 'running' : error ? 'error' : results.length || hostStatus ? 'completed' : 'idle';

    const selectedType = SCAN_TYPES.find(t => t.id === scanType)!;
    const commandPreview = useMemo(
        () => `nmap ${selectedType.flags ? selectedType.flags + ' ' : ''}${selectedScript ? `--script ${selectedScript} ` : ''}${noPing ? '-Pn ' : ''}${target || '<target>'}`.trim(),
        [selectedType, selectedScript, noPing, target],
    );

    const handleScan = async () => {
        if (!target) {
            addToConsole('CRITICAL ERROR: No target acquisition parameter.');
            setError(true);
            return;
        }
        setLoading(true); setError(false);
        setResults([]); setHostStatus(null); setHostScripts({}); setAssessment(null);
        setConsoleOutput([]); setExpandedPort(null);

        addToConsole(`Initializing Nmap engine…`);
        addToConsole(`Target: ${target}`);
        addToConsole(`Mode: ${selectedType.name} (${selectedType.flags || 'default'})`);
        if (selectedScript) addToConsole(`Scripts: --script ${selectedScript}`);
        addToConsole(`Probing perimeter…`);

        try {
            const { data } = await api.get('/api/v1/nmap', {
                params: { target, scan_type: scanType, script: selectedScript, no_ping: noPing },
            });
            setResults(data.data || []);
            setHostStatus(data.host_status || 'down');
            setHostScripts(data.host_scripts || {});
            setAssessment(data.assessment || null);

            addToConsole(`Scan sequence complete.`);
            addToConsole(`Host status: ${data.host_status?.toUpperCase()}`);
            if (Object.keys(data.host_scripts || {}).length) {
                addToConsole(`Host-level findings: ${Object.keys(data.host_scripts).length}`);
            }
            addToConsole(`Accessible ports: ${data.data?.length || 0}`);
        } catch (e: any) {
            setError(true);
            const msg = e.response?.data?.detail || e.message || 'Uplink to engine lost';
            addToConsole(`CRITICAL FAILURE: ${msg}`);
        } finally {
            setLoading(false);
        }
    };

    // ====== LEFT — params =================================================
    const params = (
        <>
            <PaneHeader title="Parameters" />

            <Field label="Target">
                <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted" />
                    <input
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        placeholder="IP or hostname"
                        className="cyber-input pl-9 font-mono text-sm !py-2.5"
                    />
                </div>
            </Field>

            <Field label="Scan profile">
                <div className="space-y-1.5">
                    {SCAN_TYPES.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setScanType(t.id)}
                            className={`w-full text-left p-2.5 rounded-lg border transition ${
                                scanType === t.id
                                    ? 'bg-brand-primary/10 border-brand-primary/40 shadow-glow-primary'
                                    : 'bg-ui-surface-2/50 border-ui-border/40 hover:border-ui-border-bright/60'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className={`text-xs font-bold ${scanType === t.id ? 'text-brand-primary-bright' : 'text-white'}`}>
                                    {t.name}
                                </span>
                                {scanType === t.id && <Zap size={11} className="text-brand-primary" />}
                            </div>
                            <span className="text-[10px] text-ui-muted">{t.description}</span>
                        </button>
                    ))}
                </div>
            </Field>

            <Field label="NSE scripts">
                <select
                    value={selectedScript}
                    onChange={e => setSelectedScript(e.target.value)}
                    className="cyber-input !py-2.5 font-mono text-xs appearance-none"
                >
                    {NSE_SCRIPTS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
            </Field>

            <label className="flex items-center justify-between p-3 rounded-lg bg-ui-surface-2/50 border border-ui-border/40 cursor-pointer">
                <div>
                    <p className="text-xs font-bold text-white">No ping (-Pn)</p>
                    <p className="text-[10px] text-ui-muted">Skip host discovery</p>
                </div>
                <button
                    type="button"
                    onClick={() => setNoPing(!noPing)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${noPing ? 'bg-brand-primary' : 'bg-ui-border'}`}
                >
                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${noPing ? 'left-6' : 'left-1'}`} />
                </button>
            </label>

            <div className="pt-3 border-t border-ui-border/40">
                <p className="text-[10px] font-mono text-ui-muted uppercase tracking-[0.18em] mb-1.5">Command</p>
                <pre className="font-mono text-[11px] p-3 rounded-lg bg-ui-bg border border-ui-border/40 whitespace-pre-wrap break-all text-slate-300">{commandPreview}</pre>
            </div>
        </>
    );

    // ====== CENTER — output ==============================================
    const liveStatusChip = (
        <span className={`chip ${loading ? 'chip-yellow' : status === 'completed' ? 'chip-green' : 'chip-muted'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-neon-yellow animate-pulse' : status === 'completed' ? 'bg-neon-green' : 'bg-ui-muted'}`} />
            {loading ? 'running' : status === 'completed' ? 'done' : 'idle'}
        </span>
    );

    const output = (
        <div className="space-y-4">
            {/* Live terminal */}
            <TerminalCard
                title={`nmap · ${target || '—'}`}
                status={liveStatusChip}
            >
                <div className="text-brand-primary font-bold mb-2">operator@cyber_arena:~$ {commandPreview}</div>
                {consoleOutput.length === 0 && !loading && (
                    <div className="text-ui-muted italic">Waiting for input…</div>
                )}
                {consoleOutput.map((line, i) => (
                    <div key={i} className="opacity-90">{line}</div>
                ))}
                {loading && (
                    <div className="flex items-center gap-2 text-brand-primary animate-pulse pt-1">
                        <span className="w-1.5 h-3 bg-brand-primary" /> Intercepting feedback…
                    </div>
                )}
            </TerminalCard>

            {/* Parsed ports table */}
            <div className="glass-panel p-0 overflow-hidden">
                <div className="px-5 py-3.5 flex items-center justify-between border-b border-ui-border/40">
                    <PaneHeader
                        title="Port inventory"
                        hint={target ? `Live feed · ${target}` : 'Awaiting target'}
                    />
                </div>
                {results.length === 0 ? (
                    <EmptyPane
                        icon={Radar}
                        title="No ports yet"
                        body="Set a target and run a scan — open services will stream in here."
                    />
                ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left">
                            <thead className="text-[10px] uppercase tracking-[0.18em] text-ui-muted bg-ui-surface/40">
                                <tr>
                                    <th className="px-5 py-3 font-semibold">Port</th>
                                    <th className="px-5 py-3 font-semibold">State</th>
                                    <th className="px-5 py-3 font-semibold">Service</th>
                                    <th className="px-5 py-3 font-semibold text-right">Risk</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((r, i) => (
                                    <React.Fragment key={i}>
                                        <motion.tr
                                            initial={{ opacity: 0, x: -6 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.03 }}
                                            onClick={() => setExpandedPort(expandedPort === i ? null : i)}
                                            className={`border-t border-ui-border/30 cursor-pointer hover:bg-white/[0.02] ${expandedPort === i ? 'bg-brand-primary/[0.05]' : ''}`}
                                        >
                                            <td className="px-5 py-3.5 font-mono">
                                                <span className="inline-flex items-center gap-2">
                                                    <span className="w-9 h-9 rounded-lg bg-ui-bg border border-ui-border/50 flex items-center justify-center text-brand-primary-bright font-bold text-xs">
                                                        {r.port}
                                                    </span>
                                                    <span className="text-[9px] uppercase text-ui-muted">tcp</span>
                                                </span>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <span className={`text-[10px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border ${
                                                    r.state === 'open'
                                                        ? 'bg-neon-green/10 text-neon-green border-neon-green/30'
                                                        : 'bg-neon-red/10 text-neon-red border-neon-red/30'
                                                }`}>{r.state}</span>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <div className="font-mono text-sm text-white">{r.service}</div>
                                                <div className="text-[10px] text-ui-muted">{r.version || 'unknown'}</div>
                                            </td>
                                            <td className="px-5 py-3.5 text-right">
                                                <div className="inline-flex items-center justify-end gap-3">
                                                    {Object.keys(r.scripts || {}).length > 0 && (
                                                        <span className="chip chip-yellow">
                                                            {Object.keys(r.scripts!).length} info
                                                        </span>
                                                    )}
                                                    <div className="h-1.5 w-12 rounded-full bg-ui-bg border border-ui-border/40 overflow-hidden">
                                                        <div
                                                            className={`h-full ${
                                                                r.state === 'open'
                                                                    ? (Object.keys(r.scripts || {}).length > 0 ? 'bg-neon-red' : 'bg-neon-yellow')
                                                                    : 'bg-ui-muted opacity-30'
                                                            }`}
                                                            style={{ width: r.state === 'open' ? (Object.keys(r.scripts || {}).length > 0 ? '90%' : '60%') : '0%' }}
                                                        />
                                                    </div>
                                                    <ChevronDown size={13} className={`text-ui-muted transition-transform ${expandedPort === i ? 'rotate-180' : ''}`} />
                                                </div>
                                            </td>
                                        </motion.tr>
                                        <AnimatePresence>
                                            {expandedPort === i && (
                                                <motion.tr
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                    className="bg-ui-bg/60"
                                                >
                                                    <td colSpan={4} className="px-5 py-4 border-t border-ui-border/30">
                                                        {Object.keys(r.scripts || {}).length > 0 ? (
                                                            <div className="space-y-3">
                                                                {Object.entries(r.scripts!).map(([id, output]) => (
                                                                    <div key={id}>
                                                                        <p className="text-[10px] font-bold uppercase text-brand-primary mb-1 flex items-center gap-1.5">
                                                                            <Shield size={11} /> {id}
                                                                        </p>
                                                                        <pre className="font-mono text-[11px] text-slate-300 bg-white/[0.03] p-3 rounded-lg border border-ui-border/40 whitespace-pre-wrap overflow-x-auto">
                                                                            {String(output)}
                                                                        </pre>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-ui-muted italic">No script findings on this port.</p>
                                                        )}
                                                    </td>
                                                </motion.tr>
                                            )}
                                        </AnimatePresence>
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );

    // ====== RIGHT — findings =============================================
    const openPorts = results.filter(r => r.state === 'open');
    const portsWithScripts = openPorts.filter(r => Object.keys(r.scripts || {}).length > 0);

    const findings = (
        <>
            {/* Quick stats */}
            <div className="glass-panel p-4 grid grid-cols-2 gap-2">
                <Stat label="Host" value={hostStatus?.toUpperCase() || '—'} tone={hostStatus === 'up' ? 'good' : hostStatus ? 'bad' : 'muted'} />
                <Stat label="Open" value={String(openPorts.length || 0)} tone="info" />
                <Stat label="Findings" value={String(portsWithScripts.length + Object.keys(hostScripts).length)} tone={portsWithScripts.length ? 'warn' : 'muted'} />
                <Stat label="Mode" value={selectedType.name} tone="muted" />
            </div>

            {/* Assessment (CVSS / remediation if backend produced one) */}
            {assessment && (
                <div className="glass-panel p-4">
                    <PaneHeader title="Assessment" hint="Risk score & remediation" />
                    <AssessmentPanel assessment={assessment} target={target} />
                </div>
            )}

            {/* Host-level scripts */}
            {Object.keys(hostScripts).length > 0 && (
                <div className="glass-panel p-4">
                    <PaneHeader title="Host findings" hint={`${Object.keys(hostScripts).length} signal(s)`} />
                    <div className="space-y-2">
                        {Object.entries(hostScripts).map(([id, out]) => (
                            <div key={id} className="bg-ui-bg/60 rounded-lg p-3 border border-ui-border/40">
                                <p className="text-[10px] font-bold text-brand-primary uppercase tracking-widest mb-1">{id}</p>
                                <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">{out}</pre>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Per-port findings */}
            {portsWithScripts.length > 0 && (
                <div className="glass-panel p-4">
                    <PaneHeader title="Port findings" />
                    <div className="space-y-2">
                        {portsWithScripts.map(r => (
                            <FindingCard
                                key={r.port}
                                severity={Object.keys(r.scripts || {}).some(k => /vuln|cve/i.test(k)) ? 'high' : 'medium'}
                                title={r.service || `port ${r.port}`}
                                location={`${target}:${r.port}`}
                                hint={Object.keys(r.scripts || {}).join(', ').slice(0, 28)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {!assessment && portsWithScripts.length === 0 && Object.keys(hostScripts).length === 0 && (
                <div className="glass-panel p-4">
                    <EmptyPane
                        icon={Target}
                        title="No findings yet"
                        body="Run a scan with NSE scripts (vuln / discovery) to surface findings here."
                    />
                </div>
            )}
        </>
    );

    // ====== Summary row (above three panes) ==============================
    const summary = (results.length || hostStatus) ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard icon={Target} label="Target" value={target} />
            <SummaryCard
                icon={Server}
                label="Host status"
                value={hostStatus?.toUpperCase() || 'UNKNOWN'}
                tone={hostStatus === 'up' ? 'good' : hostStatus === 'down' ? 'bad' : 'muted'}
            />
            <SummaryCard icon={Radar} label="Open ports" value={String(openPorts.length)} tone="info" />
            <SummaryCard icon={Zap} label="Profile" value={selectedType.name} tone="muted" />
        </div>
    ) : null;

    return (
        <ToolShell
            title="Nmap"
            icon={Radar}
            subtitle="Network discovery & service fingerprinting"
            status={status}
            runLabel="Execute scan"
            onRun={handleScan}
            runDisabled={loading || !target}
            summary={summary}
            params={params}
            output={output}
            findings={findings}
        />
    );
}

// ============================================================================
//  Local presentational helpers
// ============================================================================

function SummaryCard({
    icon: Icon, label, value, tone = 'info',
}: { icon: any; label: string; value: string; tone?: 'good' | 'bad' | 'info' | 'muted' }) {
    const map: Record<string, { bg: string; border: string; fg: string }> = {
        good:  { bg: 'bg-neon-green/10',   border: 'border-neon-green/30',   fg: 'text-neon-green' },
        bad:   { bg: 'bg-neon-red/10',     border: 'border-neon-red/30',     fg: 'text-neon-red' },
        info:  { bg: 'bg-brand-primary/10', border: 'border-brand-primary/30', fg: 'text-brand-primary-bright' },
        muted: { bg: 'bg-white/5',         border: 'border-ui-border/40',    fg: 'text-ui-muted' },
    };
    const t = map[tone];
    return (
        <div className="glass-panel p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${t.bg} ${t.border} ${t.fg}`}>
                <Icon size={18} />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-mono text-ui-muted uppercase tracking-[0.18em]">{label}</p>
                <p className={`text-sm font-bold truncate ${tone === 'good' ? 'text-neon-green' : tone === 'bad' ? 'text-neon-red' : 'text-white'}`}>
                    {value || '—'}
                </p>
            </div>
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'info' | 'warn' | 'muted' }) {
    const c: Record<string, string> = {
        good:  'text-neon-green',
        bad:   'text-neon-red',
        info:  'text-brand-primary-bright',
        warn:  'text-neon-yellow',
        muted: 'text-ui-muted',
    };
    return (
        <div className="bg-ui-surface-2/50 border border-ui-border/40 rounded-lg p-2.5">
            <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-ui-muted">{label}</p>
            <p className={`text-base font-bold ${c[tone]} tabular-nums`}>{value}</p>
        </div>
    );
}
