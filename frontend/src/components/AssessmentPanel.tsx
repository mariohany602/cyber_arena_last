import { useState } from 'react';
import { FileDown, ShieldAlert, AlertTriangle, AlertCircle, Info, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { scansAPI } from '../utils/api';

export interface Assessment {
    scan_id?: number | null;
    tool: string;
    tool_label: string;
    risk_score: number;
    risk_label: string;
    severity_counts: Record<string, number>;
    total_findings: number;
    findings: Array<{
        severity: string;
        title: string;
        description?: string;
        location?: string;
        evidence?: string;
    }>;
}

interface Props {
    assessment: Assessment | undefined | null;
    target?: string;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: any; border: string }> = {
    CRITICAL: { bg: 'bg-red-500/10', text: 'text-red-400', icon: ShieldAlert, border: 'border-red-500/30' },
    HIGH:     { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: AlertTriangle, border: 'border-orange-500/30' },
    MEDIUM:   { bg: 'bg-amber-500/10', text: 'text-amber-400', icon: AlertTriangle, border: 'border-amber-500/30' },
    LOW:      { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: AlertCircle, border: 'border-blue-500/30' },
    INFO:     { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: Info, border: 'border-slate-500/30' },
};

const RISK_GRADIENT: Record<string, string> = {
    CRITICAL: 'from-red-500 to-red-600',
    HIGH: 'from-orange-500 to-red-500',
    MEDIUM: 'from-amber-500 to-orange-500',
    LOW: 'from-blue-500 to-cyan-500',
    INFO: 'from-slate-500 to-slate-600',
};

export default function AssessmentPanel({ assessment, target }: Props) {
    const [expanded, setExpanded] = useState<number | null>(null);
    const [downloading, setDownloading] = useState(false);

    if (!assessment) return null;

    const handleDownload = async () => {
        if (!assessment.scan_id) {
            toast.error('Scan not persisted; cannot download report.');
            return;
        }
        setDownloading(true);
        try {
            await scansAPI.downloadReport(assessment.scan_id);
            toast.success('Report downloaded');
        } catch (e: any) {
            toast.error(`Download failed: ${e?.message || e}`);
        } finally {
            setDownloading(false);
        }
    };

    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    const sortedFindings = [...assessment.findings].sort(
        (a, b) => order.indexOf((a.severity || 'INFO').toUpperCase()) - order.indexOf((b.severity || 'INFO').toUpperCase())
    );

    const riskPct = Math.min(assessment.risk_score, 100);
    const gradient = RISK_GRADIENT[assessment.risk_label] || RISK_GRADIENT.INFO;

    return (
        <div className="space-y-4 mt-3">
            {/* Risk Score */}
            <div className="rounded-lg border border-ui-border/40 bg-ui-surface/60 p-3 overflow-hidden">
                <div className="text-[9px] font-mono text-ui-muted uppercase tracking-[0.15em] mb-2">Risk Score</div>
                <div className="flex items-center gap-3">
                    <span className={`text-2xl font-black bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
                        {assessment.risk_score.toFixed(0)}
                    </span>
                    <span className="text-[10px] text-ui-subtle font-medium">/ 100</span>
                    <div className={`text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r ${gradient} bg-clip-text text-transparent ml-auto`}>
                        {assessment.risk_label}
                    </div>
                </div>
                <div className="w-full h-1.5 bg-ui-bg/80 rounded-full overflow-hidden border border-ui-border/30 mt-2">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${riskPct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
                    />
                </div>
            </div>

            {/* Severity Counts - horizontal row */}
            <div className="grid grid-cols-5 gap-1.5">
                {order.map((sev) => {
                    const style = SEVERITY_STYLES[sev];
                    const count = assessment.severity_counts?.[sev] ?? 0;
                    return (
                        <div key={sev} className={`rounded-lg p-2 border ${style.border} ${style.bg} text-center`}>
                            <div className={`text-[7px] font-bold uppercase tracking-wider ${style.text} mb-0.5`}>
                                {sev.length > 4 ? sev.slice(0, 4) : sev}
                            </div>
                            <div className="text-base font-black text-white">{count}</div>
                        </div>
                    );
                })}
            </div>

            {/* Download Button */}
            <button
                onClick={handleDownload}
                disabled={downloading || !assessment.scan_id}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-brand-primary to-brand-secondary hover:from-brand-primary-bright hover:to-brand-secondary text-white text-[11px] font-bold px-3 py-2.5 rounded-lg transition-all duration-200 disabled:from-ui-surface-2 disabled:to-ui-surface-2 disabled:text-ui-subtle disabled:cursor-not-allowed"
            >
                <FileDown size={14} />
                {downloading ? 'Generating...' : 'Download PDF Report'}
            </button>

            {/* Findings List */}
            {sortedFindings.length > 0 && (
                <div>
                    <div className="text-[9px] font-mono text-ui-muted uppercase tracking-[0.2em] mb-2">
                        Findings ({assessment.total_findings})
                    </div>
                    <div className="space-y-1.5 max-h-[350px] overflow-y-auto custom-scrollbar">
                        {sortedFindings.map((f, idx) => {
                            const sev = (f.severity || 'INFO').toUpperCase();
                            const style = SEVERITY_STYLES[sev] || SEVERITY_STYLES.INFO;
                            const Icon = style.icon;
                            const isOpen = expanded === idx;
                            const hasDetail = !!(f.description || f.evidence);
                            return (
                                <div
                                    key={idx}
                                    className={`rounded-lg border ${style.border} ${style.bg} overflow-hidden`}
                                >
                                    <button
                                        onClick={() => hasDetail && setExpanded(isOpen ? null : idx)}
                                        className={`w-full flex items-start gap-2 p-2.5 text-left ${hasDetail ? 'cursor-pointer hover:bg-white/[0.03]' : 'cursor-default'}`}
                                    >
                                        <Icon className={`${style.text} flex-shrink-0 mt-0.5`} size={13} />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-[11px] font-semibold text-white/90 line-clamp-2">{f.title}</span>
                                            {f.location && (
                                                <div className="text-[10px] text-ui-muted mt-0.5 font-mono truncate">{f.location}</div>
                                            )}
                                        </div>
                                        {hasDetail && (
                                            <ChevronDown size={12} className={`text-ui-subtle flex-shrink-0 transition-transform duration-200 mt-0.5 ${isOpen ? 'rotate-180' : ''}`} />
                                        )}
                                    </button>
                                    <AnimatePresence>
                                        {isOpen && hasDetail && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-2.5 pb-2.5 text-[10px] text-ui-muted space-y-2 border-t border-ui-border/20 pt-2 mx-2.5">
                                                    {f.description && <p className="whitespace-pre-wrap leading-relaxed">{f.description}</p>}
                                                    {f.evidence && (
                                                        <pre className="bg-ui-bg/80 border border-ui-border/30 rounded p-2 overflow-x-auto text-[9px] font-mono text-ui-muted custom-scrollbar">{f.evidence}</pre>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
