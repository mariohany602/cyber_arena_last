import React, { useState, useEffect } from 'react';
import { User, Mail, MapPin, Briefcase, Camera, Save, Shield, Activity, Terminal as TerminalIcon, Cpu, Globe, Lock, Key, Smartphone, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import ToolLayout from '../components/layout/ToolLayout';
import api, { authAPI } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';

const Profile = () => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [formData, setFormData] = useState({
        job_title: '',
        bio: '',
        location: '',
    });

    // Password States
    const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
    const [showPass, setShowPass] = useState({ current: false, new: false, confirm: false });
    const [passLoading, setPassLoading] = useState(false);

    // 2FA States
    const [is2FAEnabled, setIs2FAEnabled] = useState(false);
    const [twoFALoading, setTwoFALoading] = useState(false);

    useEffect(() => {
        if (user) {
            setFormData({
                job_title: user.job_title || '',
                bio: user.bio || '',
                location: user.location || '',
            });
            setIs2FAEnabled(user.is_2fa_enabled);
        }
    }, [user]);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage({ type: '', text: '' });

        try {
            await api.put('/api/v1/profile', formData);
            setMessage({ type: 'success', text: 'Operational profile updated successfully.' });
            toast.success('Profile updated');
        } catch (error: any) {
            setMessage({ type: 'error', text: 'Failed to synchronize profile data.' });
            toast.error('Update failed');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (passwords.new !== passwords.confirm) {
            toast.error('Passwords do not match');
            return;
        }
        setPassLoading(true);
        try {
            await authAPI.updatePassword({
                current_password: passwords.current,
                new_password: passwords.new,
                confirm_password: passwords.confirm
            });
            toast.success('Password updated successfully');
            setPasswords({ current: '', new: '', confirm: '' });
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Failed to update password');
        } finally {
            setPassLoading(false);
        }
    };

    const handle2FASetup = async () => {
        setTwoFALoading(true);
        try {
            await authAPI.setup2FA();
            setIs2FAEnabled(true);
            toast.success('Email-based 2FA Enabled');
        } catch (error) {
            toast.error('Failed to enable 2FA');
        } finally {
            setTwoFALoading(false);
        }
    };


    const handle2FADisable = async () => {
        if (!confirm('Are you sure you want to disable 2FA? This decreases account security.')) return;
        setTwoFALoading(true);
        try {
            await authAPI.disable2FA();
            setIs2FAEnabled(false);
            toast.success('2FA Disabled');
        } catch (error) {
            toast.error('Failed to disable 2FA');
        } finally {
            setTwoFALoading(false);
        }
    };

    const getPasswordStrength = (pass: string) => {
        if (!pass) return { score: 0, label: 'EMPTY', color: 'bg-white/10' };
        let score = 0;
        if (pass.length >= 8) score++;
        if (/[A-Z]/.test(pass)) score++;
        if (/[0-9]/.test(pass)) score++;
        if (/[^A-Za-z0-9]/.test(pass)) score++;

        switch (score) {
            case 1: return { score: 25, label: 'WEAK', color: 'bg-neon-red' };
            case 2: return { score: 50, label: 'FAIR', color: 'bg-neon-yellow' };
            case 3: return { score: 75, label: 'GOOD', color: 'bg-neon-cyan' };
            case 4: return { score: 100, label: 'STRONG', color: 'bg-neon-green' };
            default: return { score: 10, label: 'CRITICAL', color: 'bg-neon-red animate-pulse' };
        }
    };

    const strength = getPasswordStrength(passwords.new);

    return (
        <ToolLayout title="Operator Identity Management" icon={User} status={loading || passLoading || twoFALoading ? 'running' : 'idle'}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">

                {/* Left: Identity Card & Security Overview */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="glass-panel p-8 border-ui-border/30 bg-ui-surface/40 flex flex-col items-center text-center relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary/50 shadow-glow-primary" />

                        <div className="relative mb-6">
                            <div className="w-32 h-32 rounded-3xl border-2 border-brand-primary/30 p-1 bg-ui-bg relative z-10">
                                <div className="w-full h-full rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary overflow-hidden">
                                    {user?.profile_pic ? (
                                        <img src={user.profile_pic} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={64} className="opacity-40" />
                                    )}
                                </div>
                            </div>
                            <button className="absolute bottom-[-10px] right-[-10px] w-10 h-10 rounded-xl bg-brand-primary text-white flex items-center justify-center shadow-glow-primary z-20 hover:scale-110 transition-transform">
                                <Camera size={18} />
                            </button>
                        </div>

                        <h2 className="text-xl font-black text-white tracking-widest uppercase mb-1">{user?.username}</h2>
                        <p className="text-xs font-mono text-brand-primary uppercase tracking-[0.2em] mb-4">{formData.job_title || 'OPERATOR_LEVEL_1'}</p>

                        <div className="w-full h-px bg-white/5 my-6" />

                        <div className="w-full space-y-4">
                            <div className="flex items-center gap-4 text-ui-muted text-left">
                                <Mail size={16} className="shrink-0" />
                                <span className="text-xs font-mono truncate">{user?.email}</span>
                            </div>
                            <div className="flex items-center gap-4 text-ui-muted text-left">
                                <MapPin size={16} className="shrink-0" />
                                <span className="text-xs font-mono uppercase tracking-widest">{formData.location || 'DECRYPTING...'}</span>
                            </div>
                            <div className="flex items-center gap-4 text-ui-muted text-left">
                                <Activity size={16} className="shrink-0" />
                                <span className="text-xs font-mono uppercase tracking-widest text-neon-green">Status: Active</span>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel p-6 border-ui-border/30 bg-black/40 space-y-4">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-ui-muted mb-4">Security Clearance</h3>
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                            <div className="flex items-center gap-3">
                                <Shield size={14} className="text-brand-primary" />
                                <span className="text-[10px] font-mono text-white">Multi-Factor Auth</span>
                            </div>
                            <div className={`w-2 h-2 rounded-full ${is2FAEnabled ? 'bg-neon-green shadow-glow-green' : 'bg-neon-red shadow-glow-red animate-pulse'}`} />
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                            <div className="flex items-center gap-3">
                                <Lock size={14} className="text-brand-primary" />
                                <span className="text-[10px] font-mono text-white">E2EE Protocol</span>
                            </div>
                            <div className="text-[8px] font-bold text-neon-green tracking-tighter">SECURE</div>
                        </div>
                    </div>
                </div>

                {/* Right: Management Interface (Tabs simulated by sections) */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Operational Intel Section */}
                    <div className="glass-panel p-8 border-ui-border/30 bg-ui-surface/40 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <TerminalIcon size={120} />
                        </div>

                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-12 h-12 rounded-xl bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
                                <Cpu size={24} />
                            </div>
                            <div>
                                <h3 className="text-white font-black text-sm uppercase tracking-widest">Operational Intel</h3>
                                <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest">Update your field identity metadata</p>
                            </div>
                        </div>

                        <form onSubmit={handleUpdate} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">Job Title / Designation</label>
                                    <input
                                        type="text"
                                        value={formData.job_title}
                                        onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                                        placeholder="Senior Penetration Tester"
                                        className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3.5 px-4 text-sm font-mono text-white focus:border-brand-primary/50 outline-none transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">Field Location</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            placeholder="Cyber Hub, Neo Tokyo"
                                            className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3.5 px-10 text-sm font-mono text-white focus:border-brand-primary/50 outline-none transition-all"
                                        />
                                        <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted" />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-mono font-bold text-ui-muted uppercase tracking-[0.2em] mb-2 block">Operator Bio / Capabilities</label>
                                <textarea
                                    rows={3}
                                    value={formData.bio}
                                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                                    placeholder="Red team lead specializing in infrastructure exploitation..."
                                    className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3 px-4 text-sm font-mono text-white focus:border-brand-primary/50 outline-none transition-all resize-none"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="cyber-button cyber-button-primary w-full py-4 text-xs tracking-[0.3em] flex items-center justify-center gap-3"
                            >
                                {loading ? <Activity className="animate-spin" size={16} /> : <Save size={16} />}
                                {loading ? 'SYNCHRONIZING...' : 'UPDATE IDENTITY'}
                            </button>
                        </form>
                    </div>

                    {/* Security Hardening Section */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Change Password Form */}
                        <div className="glass-panel p-8 border-ui-border/30 bg-ui-surface/40 flex flex-col h-full">
                            <div className="flex items-center gap-3 mb-6">
                                <Key className="text-neon-cyan" size={20} />
                                <h3 className="text-white font-black text-xs uppercase tracking-widest">Update Credentials</h3>
                            </div>

                            <form onSubmit={handlePasswordChange} className="space-y-4 flex-1 flex flex-col">
                                <div className="space-y-4 flex-1">
                                    <div className="relative">
                                        <input
                                            type={showPass.current ? "text" : "password"}
                                            value={passwords.current}
                                            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                                            required
                                            placeholder="Current Password"
                                            className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3 px-4 text-xs font-mono text-white outline-none focus:border-neon-cyan/50 transition-all pr-10"
                                        />
                                        <button type="button" onClick={() => setShowPass({ ...showPass, current: !showPass.current })} className="absolute right-3 top-1/2 -translate-y-1/2 text-ui-muted hover:text-white">
                                            {showPass.current ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type={showPass.new ? "text" : "password"}
                                            value={passwords.new}
                                            onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                                            required
                                            placeholder="New Password"
                                            className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3 px-4 text-xs font-mono text-white outline-none focus:border-neon-cyan/50 transition-all pr-10"
                                        />
                                        <button type="button" onClick={() => setShowPass({ ...showPass, new: !showPass.new })} className="absolute right-3 top-1/2 -translate-y-1/2 text-ui-muted hover:text-white">
                                            {showPass.new ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type={showPass.confirm ? "text" : "password"}
                                            value={passwords.confirm}
                                            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                                            required
                                            placeholder="Confirm New Password"
                                            className="w-full bg-ui-bg/50 border border-ui-border/50 rounded-xl py-3 px-4 text-xs font-mono text-white outline-none focus:border-neon-cyan/50 transition-all pr-10"
                                        />
                                        <button type="button" onClick={() => setShowPass({ ...showPass, confirm: !showPass.confirm })} className="absolute right-3 top-1/2 -translate-y-1/2 text-ui-muted hover:text-white">
                                            {showPass.confirm ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </div>

                                    {/* Strength Indicator */}
                                    {passwords.new && (
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[8px] font-black uppercase tracking-tighter">
                                                <span className="text-ui-muted">Entropy Status</span>
                                                <span className={strength.color.replace('bg-', 'text-')}>{strength.label}</span>
                                            </div>
                                            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${strength.score}%` }}
                                                    className={`h-full ${strength.color}`}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={passLoading}
                                    className="w-full bg-neon-cyan/10 hover:bg-neon-cyan/20 border border-neon-cyan/30 text-neon-cyan py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all mt-4"
                                >
                                    {passLoading ? 'ENCRYPTING...' : 'UPDATE KEY'}
                                </button>
                            </form>
                        </div>

                        {/* 2FA management */}
                        <div className="glass-panel p-8 border-ui-border/30 bg-ui-surface/40">
                            <div className="flex items-center gap-3 mb-6">
                                <Smartphone className="text-neon-magenta" size={20} />
                                <h3 className="text-white font-black text-xs uppercase tracking-widest">Two-Factor Auth</h3>
                            </div>

                            <div className="space-y-6">
                                <p className="text-[10px] text-ui-muted leading-relaxed font-medium">Add an extra layer of industrial-grade security to your access terminal by requiring a 6-digit verification code sent to your email.</p>

                                {is2FAEnabled ? (
                                    <div className="p-4 rounded-xl bg-neon-green/5 border border-neon-green/20 space-y-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-neon-green shadow-glow-green" />
                                            <span className="text-[10px] font-black text-neon-green uppercase tracking-widest">Active Protection Enabled</span>
                                        </div>
                                        <button
                                            onClick={handle2FADisable}
                                            className="w-full text-[10px] font-bold text-neon-red/60 hover:text-neon-red transition-colors uppercase tracking-widest"
                                        >
                                            Disable Protection
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={handle2FASetup}
                                            disabled={twoFALoading}
                                            className="w-full bg-neon-magenta/10 hover:bg-neon-magenta/20 border border-neon-magenta/30 text-neon-magenta py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                                        >
                                            {twoFALoading ? 'ENABLING...' : 'ENABLE EMAIL 2FA'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </ToolLayout>
    );
};

export default Profile;
