import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Lock, Globe, Fingerprint } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Landing() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [authStep, setAuthStep] = useState(0);

    const handleLogin = () => {
        setLoading(true);
        // Simulate auth sequence
        setTimeout(() => setAuthStep(1), 500); // Connecting
        setTimeout(() => setAuthStep(2), 1500); // Verifying
        setTimeout(() => setAuthStep(3), 2500); // Success
        setTimeout(() => navigate('/dashboard'), 3200);
    };

    return (
        <div className="h-screen bg-ui-bg text-white overflow-hidden relative font-sans selection:bg-brand-primary/30 selection:text-brand-primary">

            {/* --- Premium Background --- */}
            <div className="absolute inset-0 bg-grid-white bg-[length:40px_40px] opacity-20" />
            <div className="absolute inset-0 bg-gradient-main pointer-events-none" />
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-primary/10 rounded-full blur-[150px] pointer-events-none animate-pulse-glow" />
            <div className="absolute bottom-10 left-10 w-[400px] h-[400px] bg-brand-secondary/5 rounded-full blur-[120px] pointer-events-none" />

            <main className="relative z-10 h-full flex flex-col items-center justify-center p-6 bg-glow-radial">

                <AnimatePresence mode="wait">
                    {!loading ? (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="text-center max-w-4xl"
                        >
                            {/* Logo */}
                            <div className="mb-10 flex justify-center">
                                <motion.div
                                    initial={{ scale: 0.8 }}
                                    animate={{ scale: 1 }}
                                    className="relative"
                                >
                                    <div className="absolute inset-0 bg-brand-primary blur-3xl opacity-30 animate-pulse" />
                                    <div className="w-24 h-24 rounded-3xl bg-gradient-brand flex items-center justify-center relative z-10 shadow-glow-primary hover:shadow-glow-cyan transition-shadow cursor-default">
                                        <Shield size={48} className="text-white" />
                                        <div className="absolute inset-0 rounded-3xl border border-white/20" />
                                    </div>
                                    <Lock size={20} className="text-white absolute -bottom-2 -right-2 z-20 bg-ui-surface p-1 rounded-lg border border-ui-border shadow-lg" />
                                </motion.div>
                            </div>

                            <motion.h1
                                initial={{ opacity: 0, letterSpacing: "0.2em" }}
                                animate={{ opacity: 1, letterSpacing: "normal" }}
                                transition={{ duration: 1 }}
                                className="text-6xl md:text-8xl font-black tracking-tighter mb-6 text-white"
                            >
                                CYBER <span className="text-gradient-brand">ARENA</span>
                            </motion.h1>

                            <p className="text-lg text-ui-muted mb-12 max-w-2xl mx-auto font-mono leading-relaxed uppercase tracking-widest bg-ui-surface/30 py-2 px-4 rounded-full border border-ui-border/20 backdrop-blur-sm">
                                <span className="text-brand-primary">Pentesting</span> // <span className="text-brand-secondary">SOC Analysis</span> // <span className="text-neon-cyan">Security Edge</span>
                            </p>

                            <div className="flex flex-col md:flex-row gap-6 justify-center items-center">
                                <button
                                    onClick={handleLogin}
                                    className="cyber-button cyber-button-primary group px-10 py-5 text-xl tracking-widest"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                                    <span className="relative flex items-center gap-4">
                                        <Fingerprint /> ACCESS TERMINAL
                                    </span>
                                </button>

                                <button className="cyber-button cyber-button-outline px-10 py-5 flex items-center gap-3">
                                    <Globe size={20} /> Documentation
                                </button>
                            </div>

                            {/* Footer Stats */}
                            <div className="mt-24 grid grid-cols-3 gap-12 text-center border-t border-ui-border/10 pt-12 max-w-3xl mx-auto backdrop-blur-[2px]">
                                <div className="space-y-2 group">
                                    <div className="text-3xl font-black font-mono text-white group-hover:text-brand-primary transition-colors tracking-tighter">v2.4.0</div>
                                    <div className="text-[10px] text-ui-muted uppercase tracking-[0.3em] font-bold">Build Phase</div>
                                </div>
                                <div className="space-y-2 group">
                                    <div className="text-3xl font-black font-mono text-neon-green group-hover:shadow-glow-green/20 transition-all tracking-tighter uppercase">Online</div>
                                    <div className="text-[10px] text-ui-muted uppercase tracking-[0.3em] font-bold">Grid Status</div>
                                </div>
                                <div className="space-y-2 group">
                                    <div className="text-3xl font-black font-mono text-brand-secondary group-hover:text-glow-primary transition-colors tracking-tighter">Secure</div>
                                    <div className="text-[10px] text-ui-muted uppercase tracking-[0.3em] font-bold">Encryption</div>
                                </div>
                            </div>

                        </motion.div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-ui-surface/60 backdrop-blur-2xl border border-brand-primary/30 p-12 rounded-3xl shadow-glow-primary max-w-md w-full relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-primary to-transparent animate-scanline" />

                            <div className="flex flex-col items-center gap-10">
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-full border-4 border-ui-border border-t-brand-primary animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Shield size={24} className="text-brand-primary opacity-50" />
                                    </div>
                                </div>

                                <div className="space-y-3 text-center w-full">
                                    <h3 className="text-xl font-black text-white uppercase tracking-[0.2em]">Authenticating</h3>
                                    <div className="h-4 font-mono text-brand-primary text-[10px] tracking-widest font-bold overflow-hidden">
                                        {authStep === 1 && "> ESTABLISHING HANDSHAKE..."}
                                        {authStep === 2 && "> VERIFYING IDENTITY..."}
                                        {authStep === 3 && "> ACCESS GRANTED. WELCOME."}
                                    </div>
                                </div>

                                <div className="w-full bg-ui-bg/50 h-2 rounded-full overflow-hidden border border-ui-border/20 p-[1px]">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: authStep === 3 ? "100%" : `${authStep * 33}%` }}
                                        className="h-full bg-gradient-brand rounded-full shadow-glow-primary"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    );
}
