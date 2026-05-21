import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { Mail, Lock, User, UserPlus, Shield, AlertCircle, Building2 } from 'lucide-react';

export default function Signup() {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<{ [key: string]: string }>({});
    const { signup } = useAuth();
    const navigate = useNavigate();

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};

        if (username.length < 3) {
            newErrors.username = 'Username must be at least 3 characters';
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            newErrors.email = 'Please enter a valid email address';
        }

        if (password.length < 6) {
            newErrors.password = 'Password must be at least 6 characters';
        }

        if (password !== confirmPassword) {
            newErrors.confirmPassword = 'Passwords do not match';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        setLoading(true);
        try {
            await signup(username, email, password, companyName.trim() || undefined);
            navigate('/login');
        } catch (error) {
            // Error handled in AuthContext
        } finally {
            setLoading(false);
        }
    };

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
                    <p className="text-ui-muted font-mono text-[10px] uppercase tracking-[0.3em]">New Operator Enrollment</p>
                </div>

                {/* Signup Card */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-panel p-10 border-ui-border/30 bg-ui-surface/80 shadow-glass"
                >
                    <h2 className="text-2xl font-black text-white mb-8 tracking-tight">CREATE ACCOUNT</h2>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Company / Organization Input — creates the user's first tenant */}
                        <div className="space-y-1.5">
                            <label htmlFor="company" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Company / Organization
                                <span className="ml-2 text-ui-subtle/70 font-mono normal-case tracking-normal">(optional)</span>
                            </label>
                            <div className="relative group">
                                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-ui-subtle group-focus-within:text-brand-primary-bright transition-colors pointer-events-none z-10" size={18} />
                                <input
                                    id="company"
                                    type="text"
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                    className="cyber-input pl-12"
                                    placeholder="Acme Corp"
                                    maxLength={120}
                                />
                            </div>
                            <p className="text-[10px] text-ui-subtle/80 font-mono tracking-wide">
                                A workspace is created for your team. Leave blank to use your username.
                            </p>
                        </div>

                        {/* Username Input */}
                        <div className="space-y-1.5">
                            <label htmlFor="username" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Username
                            </label>
                            <div className="relative group">
                                <User className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none z-10 ${errors.username ? 'text-neon-red' : 'text-ui-subtle group-focus-within:text-brand-primary-bright'}`} size={18} />
                                <input
                                    id="username"
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    className={`cyber-input pl-12 ${errors.username ? '!border-neon-red/60 focus:!border-neon-red focus:!shadow-[0_0_0_4px_rgba(248,113,113,0.12)]' : ''}`}
                                    placeholder="operator_01"
                                />
                            </div>
                            {errors.username && (
                                <p className="mt-1 text-[10px] text-neon-red font-bold uppercase tracking-wider flex items-center gap-1">
                                    <AlertCircle size={12} />
                                    {errors.username}
                                </p>
                            )}
                        </div>

                        {/* Email Input */}
                        <div className="space-y-1.5">
                            <label htmlFor="email" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none z-10 ${errors.email ? 'text-neon-red' : 'text-ui-subtle group-focus-within:text-brand-primary-bright'}`} size={18} />
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className={`cyber-input pl-12 ${errors.email ? '!border-neon-red/60 focus:!border-neon-red focus:!shadow-[0_0_0_4px_rgba(248,113,113,0.12)]' : ''}`}
                                    placeholder="operator@cyberarena.com"
                                />
                            </div>
                            {errors.email && (
                                <p className="mt-1 text-[10px] text-neon-red font-bold uppercase tracking-wider flex items-center gap-1">
                                    <AlertCircle size={12} />
                                    {errors.email}
                                </p>
                            )}
                        </div>

                        {/* Password Input */}
                        <div className="space-y-1.5">
                            <label htmlFor="password" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Master Password
                            </label>
                            <div className="relative group">
                                <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none z-10 ${errors.password ? 'text-neon-red' : 'text-ui-subtle group-focus-within:text-brand-primary-bright'}`} size={18} />
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className={`cyber-input pl-12 ${errors.password ? '!border-neon-red/60 focus:!border-neon-red focus:!shadow-[0_0_0_4px_rgba(248,113,113,0.12)]' : ''}`}
                                    placeholder="••••••••"
                                />
                            </div>
                            {errors.password && (
                                <p className="mt-1 text-[10px] text-neon-red font-bold uppercase tracking-wider flex items-center gap-1">
                                    <AlertCircle size={12} />
                                    {errors.password}
                                </p>
                            )}
                        </div>

                        {/* Confirm Password Input */}
                        <div className="space-y-1.5">
                            <label htmlFor="confirmPassword" className="block text-xs font-black text-ui-muted uppercase tracking-widest">
                                Confirm Key
                            </label>
                            <div className="relative group">
                                <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none z-10 ${errors.confirmPassword ? 'text-neon-red' : 'text-ui-subtle group-focus-within:text-brand-primary-bright'}`} size={18} />
                                <input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    className={`cyber-input pl-12 ${errors.confirmPassword ? '!border-neon-red/60 focus:!border-neon-red focus:!shadow-[0_0_0_4px_rgba(248,113,113,0.12)]' : ''}`}
                                    placeholder="••••••••"
                                />
                            </div>
                            {errors.confirmPassword && (
                                <p className="mt-1 text-[10px] text-neon-red font-bold uppercase tracking-wider flex items-center gap-1">
                                    <AlertCircle size={12} />
                                    {errors.confirmPassword}
                                </p>
                            )}
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="cyber-button cyber-button-primary w-full py-4 text-sm tracking-widest flex items-center justify-center gap-3 mt-4"
                        >
                            {loading ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-white"></div>
                            ) : (
                                <>
                                    <UserPlus size={18} />
                                    REGISTER NODE
                                </>
                            )}
                        </button>
                    </form>

                    {/* Login Link */}
                    <div className="mt-8 text-center pt-8 border-t border-ui-border/10">
                        <p className="text-ui-muted text-sm font-medium">
                            Already an registered operator?{' '}
                            <Link
                                to="/login"
                                className="text-brand-primary hover:text-brand-primary/80 font-black transition-colors underline-offset-4 hover:underline"
                            >
                                BACK TO LOGIN
                            </Link>
                        </p>
                    </div>
                </motion.div>

                {/* Footer */}
                <p className="text-center text-ui-muted text-[10px] uppercase font-mono tracking-[0.4em] mt-10 opacity-50">
                    Secure Node Registration // v2.4.0
                </p>
            </motion.div>
        </div>
    );
}
