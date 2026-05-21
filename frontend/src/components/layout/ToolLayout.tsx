import React, { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Shield, Terminal } from 'lucide-react';
import { motion } from 'framer-motion';

interface ToolLayoutProps {
    title: string;
    icon?: React.ElementType;
    children: ReactNode;
    status?: 'idle' | 'running' | 'completed' | 'error';
}

const ToolLayout: React.FC<ToolLayoutProps> = ({ title, icon: Icon, children, status = 'idle' }) => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-ui-bg text-slate-300 font-sans flex flex-col relative overflow-hidden">
            {/* Ambient Background */}
            <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] bg-brand-primary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] bg-brand-secondary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute inset-0 bg-grid-white bg-[length:40px_40px] opacity-[0.02] pointer-events-none" />

            <header className="bg-ui-bg/70 backdrop-blur-xl border-b border-ui-border/20 p-5 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => navigate('/tools')}
                            className="bg-ui-surface/60 hover:bg-ui-surface/90 p-2.5 rounded-xl transition-all border border-ui-border/30 hover:border-brand-primary/40 group active:scale-95"
                        >
                            <ArrowLeft size={20} className="group-hover:-translate-x-0.5 transition-transform" />
                        </button>
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl border shadow-inner-glow ${
                                title.toLowerCase().includes('vulnerability') || title.toLowerCase().includes('brute') 
                                ? 'bg-brand-secondary/10 border-brand-secondary/30 text-brand-secondary' 
                                : 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary'
                            }`}>
                                {Icon ? <Icon size={22} /> : <Terminal size={22} />}
                            </div>
                            <div>
                                <h1 className="text-xl font-black text-white tracking-tight uppercase italic">{title}</h1>
                                <div className="flex items-center gap-2 text-[9px] font-black font-mono text-ui-muted uppercase tracking-[0.2em] mt-0.5">
                                    <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-neon-yellow animate-pulse' : 'bg-neon-green'} shadow-sm`}></span>
                                    {status === 'running' ? 'LINK_ACTIVE' : 'SYSTEM_READY'} // {status === 'running' ? 'PROCESSING' : 'STANDBY'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className={`px-4 py-2 rounded-xl border text-[10px] font-black tracking-widest flex items-center gap-3 ${
                            status === 'running' ? 'bg-neon-yellow/10 border-neon-yellow/30 text-neon-yellow' :
                            status === 'completed' ? 'bg-neon-green/10 border-neon-green/30 text-neon-green' :
                            status === 'error' ? 'bg-neon-red/10 border-neon-red/30 text-neon-red' :
                            'bg-ui-surface/60 border-ui-border/40 text-ui-muted'
                        }`}>
                            <Activity size={14} className={status === 'running' ? 'animate-spin-slow' : ''} />
                            {status === 'running' ? 'UPLINK_ENGAGED' :
                                status === 'completed' ? 'SEQUENCE_FINALIZED' :
                                    status === 'error' ? 'FATAL_EXCEPTION' : 'IDLE_WAIT'}
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-7xl mx-auto w-full p-8 relative z-10 custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="h-full flex flex-col"
                >
                    {children}
                </motion.div>
            </main>
        </div>
    );
};

export default ToolLayout;
