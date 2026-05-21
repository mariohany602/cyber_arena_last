import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { Mail, Lock, LogIn, Shield } from 'lucide-react';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [require2FA, setRequire2FA] = useState(false);
    const [otpToken, setOtpToken] = useState('');
    const [userId, setUserId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    const { login, login2FA } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const data = await login(email, password);
            if (data?.require_2fa) {
                setRequire2FA(true);
                setUserId(data.user_id);
            } else {
                navigate('/');
            }
        } catch (error) {
            // Error handled in AuthContext
        } finally {
            setLoading(false);
        }
    };

    const handle2FAVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userId) return;
        setLoading(true);
        try {
            await login2FA(userId, otpToken);
            navigate('/');
        } catch (error) {
            // Error handled in AuthContext
        } finally {
            setLoading(false);
        }
    };

    if (require2FA) {
        return (
            <div className="min-h-screen bg-ui-bg flex items-center justify-center p-4 relative overflow-hidden font-sans">
                <div className="absolute inset-0 bg-grid-white bg-[length:40px_40px] opacity-10" />
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md relative z-10 glass-panel p-10 border-ui-border/30 bg-ui-surface/80 shadow-glass"
                >
                    <div className="text-center mb-8">
                        <Shield size={48} className="text-brand-primary mx-auto mb-4" />
                        <h2 className="text-2xl font-black text-white tracking-tight uppercase">Security Verification</h2>
                        <p className="text-ui-muted text-xs mt-2 font-mono">ENTER THE CODE SENT TO YOUR EMAIL</p>
                    </div>

                    <form onSubmit={handle2FAVerify} className="space-y-6">
                        <div className="space-y-2">
                            <label className="block text-xs font-black text-ui-muted uppercase tracking-widest">Verification Code</label>
                            <input
                                type="text"
                                value={otpToken}
                                onChange={(e) => setOtpToken(e.target.value)}
                                required
                                autoFocus
                                maxLength={6}
                                className="cyber-input text-center text-3xl font-black tracking-[0.5em] text-brand-primary-bright py-5"
                                placeholder="000000"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="cyber-button cyber-button-primary w-full py-4 text-sm tracking-widest flex items-center justify-center gap-3"
                        >
                            {loading ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-white" /> : "COMPLETE UPLINK"}
                        </button>

                        <button
                            type="button"
                            onClick={() => setRequire2FA(false)}
                            className="w-full text-ui-muted text-xs font-bold hover:text-white transition-colors"
                        >
                            BACK TO LOGIN
                        </button>
                    </form>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-ui-bg flex items-center justify-center p-4 relative overflow-hidden font-sans">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-grid-white bg-[length:40px_40px] opacity-10" />
            <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand-primary/10 rounded-full blur-[150px] animate-pulse-glow" />
            <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand-secondary/5 rounded-full blur-[150px]" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md relative z-10"
            >
                {/* Logo/Header */}
                <div className="text-center mb-10">
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="inline-flex items-center justify-center w-20 h-20 bg-gradient-brand rounded-3xl mb-6 shadow-glow-primary relative group"
                    >
                        <Shield size={40} className="text-white relative z-10" />
                        <div className="absolute inset-0 bg-white/20 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                    </motion.div>
                    <h1 className="text-4xl font-black text-white tracking-tighter mb-2">
                        CYBER <span className="text-brand-primary">ARENA</span>
                    </h1>
                    <p className="text-ui-muted font-mono text-[10px] uppercase tracking-[0.3em]">Institutional Access Terminal</p>
                </div>

                {/* Login Card */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-panel p-10 border-ui-border/30 bg-ui-surface/80 shadow-glass"
                >
                    <h2 className="text-2xl font-black text-white mb-8 tracking-tight">OPERATOR LOGIN</h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Email Input */}
                        <div className="space-y-2">
                            <label htmlFor="email" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-ui-subtle group-focus-within:text-brand-primary-bright transition-colors pointer-events-none z-10" size={18} />
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="cyber-input pl-12"
                                    placeholder="operator@cyberarena.com"
                                />
                            </div>
                        </div>

                        {/* Password Input */}
                        <div className="space-y-2">
                            <label htmlFor="password" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Authentication Key
                            </label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-ui-subtle group-focus-within:text-brand-primary-bright transition-colors pointer-events-none z-10" size={18} />
                                <input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="cyber-input pl-12 pr-16"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black tracking-widest text-ui-subtle hover:text-brand-primary-bright transition-colors"
                                >
                                    {showPassword ? "HIDE" : "SHOW"}
                                </button>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="cyber-button cyber-button-primary w-full py-4 text-sm tracking-widest flex items-center justify-center gap-3"
                        >
                            {loading ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-white"></div>
                            ) : (
                                <>
                                    <LogIn size={18} />
                                    SYNC ACCESS
                                </>
                            )}
                        </button>
                    </form>

                    {/* Signup Link */}
                    <div className="mt-8 text-center pt-8 border-t border-ui-border/10">
                        <p className="text-ui-muted text-sm font-medium">
                            No operator credentials?{' '}
                            <Link
                                to="/signup"
                                className="text-brand-primary hover:text-brand-primary/80 font-black transition-colors underline-offset-4 hover:underline"
                            >
                                REQUEST ENROLLMENT
                            </Link>
                        </p>
                    </div>
                </motion.div>

                {/* Footer */}
                <p className="text-center text-ui-muted text-[10px] uppercase font-mono tracking-[0.4em] mt-10 opacity-50">
                    Encrypted Node Entry // v2.4.0
                </p>
            </motion.div>
        </div>
    );
}
