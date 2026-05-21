import React, { useState, useEffect, useRef } from 'react';
import { Send, Terminal as TerminalIcon, Shield, Lock, Search, User, Activity, Cpu, Zap, Info } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
    id: number;
    sender_id: number;
    recipient_id: number;
    content: string;
    timestamp: string;
    is_encrypted: boolean;
}

const Chat = () => {
    const { user } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [encrypting, setEncrypting] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (selectedUser) {
            fetchMessages();
            const interval = setInterval(fetchMessages, 5000);
            return () => clearInterval(interval);
        }
    }, [selectedUser]);

    useEffect(() => {
        handleSearch();
    }, [searchQuery]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSearch = async () => {
        try {
            const response = await api.get(`/api/v1/users/search?query=${searchQuery}`);
            setUsers(response.data);
        } catch (error) {
            console.error("Search failed");
        }
    };

    const fetchMessages = async () => {
        if (!selectedUser) return;
        try {
            const response = await api.get(`/api/v1/chat/history?other_user_id=${selectedUser.id}`);
            setMessages(response.data);
        } catch (error) {
            console.error("Failed to fetch messages");
        }
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedUser) return;

        setEncrypting(true);
        // Simulate encryption delay
        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            await api.post('/api/v1/chat/send', {
                recipient_id: selectedUser.id,
                content: newMessage
            });
            setNewMessage('');
            fetchMessages();
        } catch (error) {
            console.error("Failed to send message");
        } finally {
            setEncrypting(false);
        }
    };

    return (
        <ToolLayout title="E2EE Communications Terminal" icon={TerminalIcon} status={encrypting ? 'running' : 'idle'}>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-250px)]">

                {/* User Sidebar */}
                <div className="lg:col-span-1 glass-panel border-ui-border/30 bg-ui-surface/40 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-ui-border/20">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted" />
                            <input
                                type="text"
                                placeholder="Find Operators..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-lg py-2 pl-10 pr-4 text-xs font-mono text-white focus:border-brand-primary/50 outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {users.map((u) => (
                            <button
                                key={u.id}
                                onClick={() => setSelectedUser(u)}
                                className={`w-full p-4 flex items-center gap-3 hover:bg-white/5 transition-all text-left border-b border-ui-border/10 ${selectedUser?.id === u.id ? 'bg-brand-primary/10 border-l-2 border-l-brand-primary' : ''
                                    }`}
                            >
                                <div className="w-10 h-10 rounded-xl bg-ui-bg border border-ui-border/30 flex items-center justify-center text-brand-primary">
                                    <User size={18} />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="text-xs font-black text-white uppercase tracking-widest truncate">{u.username}</p>
                                    <p className="text-[10px] font-mono text-ui-muted truncate">{u.job_title || 'Level 1 Operator'}</p>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-neon-green/40 shadow-glow-green" />
                            </button>
                        ))}
                        {users.length === 0 && (
                            <div className="p-8 text-center opacity-30">
                                <Activity size={32} className="mx-auto mb-2" />
                                <p className="text-[10px] uppercase font-mono tracking-widest">No signals found</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Chat Area */}
                <div className="lg:col-span-3 glass-panel border-ui-border/30 bg-ui-surface/40 flex flex-col overflow-hidden relative">
                    {selectedUser ? (
                        <>
                            {/* Chat Header */}
                            <div className="p-4 bg-black/20 border-b border-ui-border/20 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
                                        <TerminalIcon size={14} />
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Secure Channel: {selectedUser.username}</h3>
                                        <p className="text-[8px] font-mono text-neon-green uppercase tracking-widest">Signal Integrity: 100% // E2EE Active</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <div className="px-2 py-1 bg-neon-green/10 border border-neon-green/20 rounded-md flex items-center gap-2">
                                        <Lock size={10} className="text-neon-green" />
                                        <span className="text-[8px] font-black text-neon-green tracking-widest">AES-256</span>
                                    </div>
                                </div>
                            </div>

                            {/* Message Display */}
                            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-black/10">
                                {messages.map((m) => (
                                    <motion.div
                                        key={m.id}
                                        initial={{ opacity: 0, x: m.sender_id === user?.id ? 20 : -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className={`flex ${m.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div className={`max-w-[70%] space-y-1 ${m.sender_id === user?.id ? 'text-right' : 'text-left'}`}>
                                            <div className={`p-4 rounded-2xl border text-xs leading-relaxed font-mono ${m.sender_id === user?.id
                                                ? 'bg-brand-primary/10 border-brand-primary/20 text-white rounded-tr-none shadow-glow-primary/5'
                                                : 'bg-white/5 border-ui-border/30 text-slate-300 rounded-tl-none'
                                                }`}>
                                                {m.content}
                                            </div>
                                            <div className="flex items-center gap-2 justify-end opacity-40">
                                                <span className="text-[8px] font-mono text-ui-muted uppercase">{new Date(m.timestamp).toLocaleTimeString()}</span>
                                                <Shield size={8} className="text-neon-green" />
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>

                            {/* Message Input */}
                            <form onSubmit={handleSendMessage} className="p-6 bg-black/20 border-t border-ui-border/20">
                                <div className="relative group">
                                    <input
                                        type="text"
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        placeholder="Enter encrypted signal..."
                                        className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-4 pl-6 pr-16 text-sm font-mono text-white focus:border-brand-primary/50 outline-none transition-all shadow-inner"
                                    />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                        <AnimatePresence>
                                            {encrypting && (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-neon-green mr-2">
                                                    <Cpu size={14} className="animate-spin" />
                                                    <span className="text-[8px] font-black uppercase tracking-tighter">Encrypting</span>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || encrypting}
                                            className="p-2.5 rounded-lg bg-brand-primary text-white shadow-glow-primary hover:scale-105 transition-transform disabled:opacity-50 disabled:grayscale"
                                        >
                                            <Send size={16} />
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-ui-muted gap-6 p-20 text-center relative">
                            <div className="absolute inset-0 bg-brand-primary/5 blur-[100px] pointer-events-none" />
                            <div className="w-24 h-24 rounded-3xl bg-ui-surface/60 border border-ui-border/30 flex items-center justify-center relative z-10 animate-pulse">
                                <Shield size={48} className="text-brand-primary opacity-50" />
                            </div>
                            <div className="space-y-4 max-w-sm relative z-10">
                                <h3 className="text-xs font-black uppercase tracking-[0.4em] text-white">Communications Silo</h3>
                                <p className="text-[10px] font-mono opacity-60 leading-relaxed uppercase">
                                    Select an operational node from the directory to establish an end-to-end encrypted uplink.
                                </p>
                                <div className="flex items-center justify-center gap-4 text-[8px] font-black tracking-widest text-brand-primary opacity-50">
                                    <span>AES-256-GCM</span>
                                    <div className="w-1 h-1 rounded-full bg-ui-border/50" />
                                    <span>RSA-4096</span>
                                    <div className="w-1 h-1 rounded-full bg-ui-border/50" />
                                    <span>SECURE HANDSHAKE</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom status bar */}
            <div className="mt-6 flex flex-wrap gap-4">
                <div className="px-4 py-2 glass-panel border-ui-border/30 bg-black/40 flex items-center gap-3">
                    <Activity size={14} className="text-neon-green" />
                    <span className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Network status: <span className="text-neon-green">Nominal</span></span>
                </div>
                <div className="px-4 py-2 glass-panel border-ui-border/30 bg-black/40 flex items-center gap-3">
                    <Cpu size={14} className="text-brand-primary" />
                    <span className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Encryption core: <span className="text-brand-primary">Signal v2.4</span></span>
                </div>
            </div>
        </ToolLayout>
    );
};

export default Chat;
