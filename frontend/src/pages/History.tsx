import { useEffect, useState } from 'react';
import { FileDown, Trash2, RefreshCw, History as HistoryIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { scansAPI } from '../utils/api';
import type { ScanSummary } from '../utils/api';
import Header from '../components/Header';

const TOOL_FILTERS = [
    { id: '', label: 'All tools' },
    { id: 'nmap', label: 'Nmap' },
    { id: 'nikto', label: 'Nikto' },
    { id: 'vuln-scan', label: 'Vuln Scan' },
    { id: 'nuclei', label: 'Nuclei' },
    { id: 'directories', label: 'Directories' },
    { id: 'ffuf', label: 'FFUF' },
    { id: 'sqlmap', label: 'SQLMap' },
    { id: 'subdomains', label: 'Subdomains' },
];

const RISK_COLOR: Record<string, string> = {
    CRITICAL: 'text-red-400 bg-red-900/30 border-red-700',
    HIGH: 'text-red-400 bg-red-800/30 border-red-600',
    MEDIUM: 'text-amber-300 bg-amber-700/30 border-amber-600',
    LOW: 'text-blue-300 bg-blue-800/30 border-blue-600',
    INFO: 'text-slate-300 bg-slate-700/40 border-slate-600',
};

export default function History() {
    const [scans, setScans] = useState<ScanSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [downloading, setDownloading] = useState<number | null>(null);

    const load = async (tool?: string) => {
        setLoading(true);
        try {
            const data = await scansAPI.list(tool || undefined);
            setScans(data);
        } catch (e: any) {
            toast.error(`Failed to load history: ${e?.response?.data?.detail || e.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(filter); }, [filter]);

    const handleDownload = async (s: ScanSummary) => {
        setDownloading(s.id);
        try {
            await scansAPI.downloadReport(s.id, `cyber_arena_${s.tool}_${s.id}.pdf`);
            toast.success('Report downloaded');
        } catch (e: any) {
            toast.error(`Download failed: ${e?.message || e}`);
        } finally {
            setDownloading(null);
        }
    };

    const handleDelete = async (s: ScanSummary) => {
        if (!confirm(`Delete scan #${s.id} (${s.tool} on ${s.target})?`)) return;
        try {
            await scansAPI.delete(s.id);
            setScans(prev => prev.filter(x => x.id !== s.id));
            toast.success('Scan deleted');
        } catch (e: any) {
            toast.error(`Delete failed: ${e?.message || e}`);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <Header />
            <main className="max-w-7xl mx-auto px-4 py-6">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <HistoryIcon className="text-cyan-400" size={28} />
                        <div>
                            <h1 className="text-2xl font-bold">Scan History</h1>
                            <p className="text-sm text-slate-400">All scans you've run, with risk assessment and PDF reports.</p>
                        </div>
                    </div>
                    <button
                        onClick={() => load(filter)}
                        disabled={loading}
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded text-sm border border-slate-700"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>

                {/* Tool filter */}
                <div className="flex flex-wrap gap-2 mb-4">
                    {TOOL_FILTERS.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setFilter(t.id)}
                            className={`px-3 py-1.5 rounded text-xs border ${
                                filter === t.id
                                    ? 'bg-cyan-600 border-cyan-500 text-white'
                                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Table */}
                <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-3">When</th>
                                <th className="text-left px-4 py-3">Tool</th>
                                <th className="text-left px-4 py-3">Target</th>
                                <th className="text-left px-4 py-3">Engine</th>
                                <th className="text-left px-4 py-3">Risk</th>
                                <th className="text-left px-4 py-3">Findings (C/H/M/L/I)</th>
                                <th className="text-right px-4 py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {scans.length === 0 && !loading && (
                                <tr><td colSpan={7} className="text-center text-slate-500 py-12">No scans yet — run any tool and it will appear here.</td></tr>
                            )}
                            {scans.map(s => {
                                const c = s.severity_counts || {};
                                const fmt = (s.created_at ? new Date(s.created_at).toLocaleString() : '—');
                                return (
                                    <tr key={s.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmt}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium">{s.tool_label}</div>
                                            <div className="text-xs text-slate-500">#{s.id}</div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-xs truncate">{s.target}</td>
                                        <td className="px-4 py-3 text-xs text-slate-400">{s.engine || '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${RISK_COLOR[s.risk_label] || RISK_COLOR.INFO}`}>
                                                {s.risk_score.toFixed(0)} · {s.risk_label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono text-slate-300">
                                            <span className="text-red-400">{c.CRITICAL ?? 0}</span>/
                                            <span className="text-red-300">{c.HIGH ?? 0}</span>/
                                            <span className="text-amber-300">{c.MEDIUM ?? 0}</span>/
                                            <span className="text-blue-300">{c.LOW ?? 0}</span>/
                                            <span className="text-slate-400">{c.INFO ?? 0}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleDownload(s)}
                                                    disabled={downloading === s.id}
                                                    title="Download PDF report"
                                                    className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 px-2.5 py-1 rounded text-xs"
                                                >
                                                    <FileDown size={14} /> PDF
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(s)}
                                                    title="Delete scan"
                                                    className="flex items-center gap-1 bg-slate-700 hover:bg-red-700 px-2 py-1 rounded text-xs"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
}
