import React, { useState, useEffect } from 'react';
import { Activity, Play, RefreshCw, Wifi, ArrowDown, ArrowUp, Layers } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';

interface Packet {
    id: number;
    time: string;
    protocol: string;
    source: string;
    destination: string;
    length: number;
    info: string;
}

interface Stats {
    rx_kbps: number;
    tx_kbps: number;
    packets_sec: number;
}

const TrafficAnalyzer: React.FC = () => {
    const [packets, setPackets] = useState<Packet[]>([]);
    const [stats, setStats] = useState<Stats>({ rx_kbps: 0, tx_kbps: 0, packets_sec: 0 });
    const [loading, setLoading] = useState(false);
    const [capturing, setCapturing] = useState(false);

    const loadTraffic = async () => {
        setLoading(true);
        try {
            const response = await api.get('/api/analyze');
            const data = response.data;

            if (data.status === 'success') {
                setPackets(data.data);
                setStats(data.stats);
            }
        } catch (error) {
            console.error("Failed to load traffic data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTraffic();
    }, []);

    return (
        <ToolLayout title="Network Traffic Analyzer" icon={Wifi} status={capturing ? 'running' : 'idle'}>
            <div className="flex flex-col h-full gap-6">

                {/* Traffic Visualizer (Top) */}
                <div className="h-52 glass-panel border-ui-border/30 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between">
                    <div className="flex justify-between items-start z-10">
                        <div className="text-[10px] font-black text-ui-muted uppercase tracking-[0.2em] flex items-center gap-2">
                            <Activity size={14} className="text-brand-primary" /> 
                            <span>Network Throughput Graph</span>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex flex-col items-end">
                                <span className="text-[9px] font-black text-ui-muted uppercase tracking-widest">Incoming</span>
                                <span className="text-sm font-mono font-black text-neon-green">{stats.rx_kbps.toFixed(1)} KB/s</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-[9px] font-black text-ui-muted uppercase tracking-widest">Outgoing</span>
                                <span className="text-sm font-mono font-black text-brand-primary">{stats.tx_kbps.toFixed(1)} KB/s</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-end gap-1.5 h-24 overflow-hidden">
                        {Array.from({ length: 60 }).map((_, i) => {
                            const h = capturing ? Math.random() * 80 + 20 : 10;
                            return (
                                <div
                                    key={i}
                                    className={`flex-1 rounded-t-sm transition-all duration-500 ease-in-out ${
                                        capturing ? 'bg-gradient-to-t from-brand-primary/20 to-brand-primary/80' : 'bg-ui-border/20'
                                    }`}
                                    style={{
                                        height: `${h}%`,
                                        opacity: capturing ? 0.4 + (Math.random() * 0.6) : 0.2
                                    }}
                                />
                            );
                        })}
                    </div>
                </div>

                {/* Controls & Table */}
                <div className="flex-1 glass-panel border-ui-border/30 rounded-2xl overflow-hidden flex flex-col shadow-2xl relative">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/20 to-transparent" />

                    {/* Toolbar */}
                    <div className="p-4 border-b border-ui-border/20 bg-ui-bg/40 backdrop-blur-md flex justify-between items-center z-10">
                        <div className="flex gap-3">
                            <button
                                onClick={() => setCapturing(!capturing)}
                                className={`px-5 py-2.5 rounded-xl font-black text-[10px] tracking-widest flex items-center gap-2.5 transition-all border ${capturing
                                    ? 'bg-neon-red/10 text-neon-red border-neon-red/30 hover:bg-neon-red/20'
                                    : 'bg-neon-green/10 text-neon-green border-neon-green/30 hover:bg-neon-green/20'
                                    }`}
                            >
                                {capturing ? <div className="w-2.5 h-2.5 bg-neon-red rounded-full animate-pulse shadow-[0_0_8px_#ef4444]" /> : <Play size={14} className="fill-current" />}
                                {capturing ? 'TERMINATE CAPTURE' : 'INITIALIZE CAPTURE'}
                            </button>
                            <button
                                onClick={loadTraffic}
                                className="px-5 py-2.5 bg-ui-surface/60 hover:bg-ui-surface/80 text-ui-muted hover:text-white rounded-xl text-[10px] font-black tracking-widest border border-ui-border/30 flex items-center gap-2.5 transition-all"
                            >
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> SYNC DATA
                            </button>
                        </div>
                        <div className="flex items-center gap-6 text-[10px] font-black font-mono text-ui-muted uppercase tracking-widest">
                            <span className="flex items-center gap-1.5"><ArrowDown size={14} className="text-neon-green" /> {stats.rx_kbps.toFixed(1)} KB/S</span>
                            <span className="flex items-center gap-1.5"><ArrowUp size={14} className="text-brand-primary" /> {stats.tx_kbps.toFixed(1)} KB/S</span>
                            <span className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-lg"><Layers size={14} /> {packets.length || '--'} PACKETS</span>
                        </div>
                    </div>

                    {/* Data Table */}
                    <div className="flex-1 overflow-auto bg-ui-bg/20 custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-ui-bg/60 text-ui-muted font-black font-mono text-[9px] uppercase sticky top-0 z-20 backdrop-blur-md">
                                <tr>
                                    <th className="p-4 border-b border-ui-border/20 w-24">Packet ID</th>
                                    <th className="p-4 border-b border-ui-border/20 w-32">Timestamp</th>
                                    <th className="p-4 border-b border-ui-border/20 w-48 text-brand-primary">Source</th>
                                    <th className="p-4 border-b border-ui-border/20 w-48 text-neon-green">Destination</th>
                                    <th className="p-4 border-b border-ui-border/20 w-32">Protocol</th>
                                    <th className="p-4 border-b border-ui-border/20 w-24">Length</th>
                                    <th className="p-4 border-b border-ui-border/20">Protocol Details</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ui-border/10 font-mono text-[11px]">
                                {packets.map((pkt) => (
                                    <tr key={pkt.id} className="hover:bg-white/5 transition-colors group cursor-pointer">
                                        <td className="p-4 text-ui-muted font-bold">#{pkt.id}</td>
                                        <td className="p-4 text-ui-muted/60">{pkt.time}</td>
                                        <td className="p-4 text-brand-primary font-black tracking-tight">{pkt.source}</td>
                                        <td className="p-4 text-neon-green font-black tracking-tight">{pkt.destination}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black border tracking-widest ${
                                                pkt.protocol === 'TCP' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' :
                                                pkt.protocol === 'UDP' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                                                pkt.protocol === 'HTTP' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' :
                                                pkt.protocol === 'ICMP' ? 'bg-neon-red/10 text-neon-red border-neon-red/30' :
                                                'bg-ui-border/20 text-ui-muted border-ui-border/30'
                                            }`}>
                                                {pkt.protocol}
                                            </span>
                                        </td>
                                        <td className="p-4 text-ui-muted">{pkt.length} B</td>
                                        <td className="p-4 text-white/70 italic text-[10px] group-hover:text-white transition-colors">
                                            {pkt.info}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        
                        {!loading && packets.length === 0 && (
                            <div className="p-20 text-center space-y-4">
                                <Activity size={48} className="mx-auto text-ui-muted/20 animate-pulse" />
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ui-muted/30">Interface Listening... Initiate capture to stream data packets.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default TrafficAnalyzer;
