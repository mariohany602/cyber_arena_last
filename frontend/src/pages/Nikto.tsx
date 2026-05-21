import React, { useState } from 'react';
import { Terminal, Shield, Play, Download, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import AssessmentPanel from '../components/AssessmentPanel';
import type { Assessment } from '../components/AssessmentPanel';

interface NiktoFinding {
    id: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    msg: string;
    path: string;
}

const Nikto: React.FC = () => {
    const [target, setTarget] = useState('');
    const [findings, setFindings] = useState<NiktoFinding[]>([]);
    const [rawOutput, setRawOutput] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [scanId, setScanId] = useState<string | null>(null);
    const [assessment, setAssessment] = useState<Assessment | null>(null);

    const startScan = async () => {
        if (!target) return;

        setLoading(true);
        setFindings([]);
        setAssessment(null);
        setRawOutput(">$ Initializing Nikto Engine...\n>$ Target: " + target + "\n>$ Engaging vulnerability modules...\n");

        try {
            const response = await api.get(`/api/v1/nikto`, {
                params: { target }
            });
            const data = response.data;

            if (data.status === "success") {
                setFindings(data.findings || []);
                setRawOutput(data.raw_output);
                setScanId(`NIKTO-${Math.floor(Math.random() * 9000) + 1000}`);
                setAssessment(data.assessment || null);
            } else {
                setRawOutput(`[ERROR]: ${data.detail || "Something went wrong"}`);
            }
        } catch (error: any) {
            const errorMessage = error.response?.data?.detail || "Could not connect to Backend API.";
            setRawOutput(`[FATAL ERROR]: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = () => {
        if (!target) return;
        window.open(`${api.defaults.baseURL}/api/v1/download/report?tool=nikto&target=${target}`, '_blank');
    };

    return (
        <ToolLayout title="Nikto Web Scanner" icon={Shield} status={loading ? 'running' : 'idle'}>
            <div className="flex flex-col h-full gap-6">
                {/* Header */}
                <div className="flex gap-4 p-4 glass-panel border-ui-border/30 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/20 to-transparent" />

                    <input
                        type="text"
                        placeholder="Target IP / Hostname (e.g. 127.0.0.1)"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        className="flex-1 bg-ui-surface/40 border border-ui-border/40 rounded-xl p-4 font-mono text-sm text-white placeholder:text-ui-muted/30 focus:border-brand-primary/50 transition-all outline-none"
                    />
                    <button
                        onClick={startScan}
                        disabled={loading}
                        className="bg-brand-primary hover:bg-brand-primary/90 text-white font-black px-8 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-3 text-[11px] tracking-widest disabled:opacity-50"
                    >
                        <Play size={16} fill="currentColor" /> {loading ? "INTERROGATING..." : "EXECUTE_SCAN"}
                    </button>
                </div>

                {assessment && <AssessmentPanel assessment={assessment} target={target} />}

                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Results Area */}
                    <div className="lg:col-span-2 flex flex-col gap-4 overflow-hidden">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">
                                {findings.length > 0 ? `Vulnerabilities Detected: ${findings.length}` : 'Report Visualization'}
                            </h3>
                            {findings.length > 0 && (
                                <button
                                    onClick={handleDownload}
                                    className="text-[9px] font-black text-brand-primary flex items-center gap-2 hover:brightness-125 transition-all"
                                >
                                    <Download size={12} /> EXPORT_RAW.LOG
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            <AnimatePresence mode="wait">
                                {findings.length > 0 ? (
                                    <div className="space-y-3">
                                        {findings.map((f, i) => (
                                            <motion.div
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: i * 0.05 }}
                                                key={i}
                                                className="glass-panel border-white/5 p-4 rounded-xl flex gap-4 items-center group hover:border-brand-primary/30 transition-all"
                                            >
                                                <div className={`p-2 rounded-lg ${f.severity === 'HIGH' ? 'bg-red-500/20 text-red-500' :
                                                        f.severity === 'MEDIUM' ? 'bg-orange-500/20 text-orange-500' :
                                                            f.severity === 'LOW' ? 'bg-yellow-500/20 text-yellow-500' :
                                                                'bg-blue-500/20 text-blue-400'
                                                    }`}>
                                                    {f.severity === 'HIGH' ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-[8px] font-mono text-ui-muted">{f.id}</span>
                                                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${f.severity === 'HIGH' ? 'bg-red-500/10 text-red-500' : 'bg-white/5 text-ui-muted'
                                                            }`}>{f.severity}</span>
                                                    </div>
                                                    <p className="text-[11px] text-white/90 font-medium">{f.msg}</p>
                                                    <div className="text-[9px] text-brand-primary/60 font-mono mt-1">Path: {f.path}</div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center opacity-20 border-2 border-dashed border-white/10 rounded-3xl">
                                        <Shield size={48} strokeWidth={1} />
                                        <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-center">
                                            {loading ? "Engaging Simulation Engine..." : "Waiting for scan targets..."}
                                        </p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Raw Terminal View */}
                    <div className="bg-ui-bg/80 backdrop-blur-sm rounded-2xl border border-ui-border/30 overflow-hidden flex flex-col font-mono text-[10px]">
                        <div className="px-4 py-2 border-b border-ui-border/10 bg-black/20 flex items-center gap-2">
                            <Terminal size={12} className="text-brand-primary" />
                            <span className="text-ui-muted/60 uppercase tracking-widest text-[9px]">Raw_Console_Buffer</span>
                        </div>
                        <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                            <pre className="text-brand-primary/80 whitespace-pre-wrap leading-relaxed">
                                {rawOutput || '> Engine ready...'}
                            </pre>
                        </div>
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default Nikto;