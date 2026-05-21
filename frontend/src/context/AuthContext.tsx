import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, rbacAPI } from '../utils/api';
import toast from 'react-hot-toast';

interface User {
    id: number;
    username: string;
    email: string;
    is_active: boolean;
    created_at: string;
    job_title?: string;
    bio?: string;
    location?: string;
    profile_pic?: string;
    is_2fa_enabled: boolean;
    // SOC RBAC fields (Phase 1) — populated lazily after auth.
    role?: string;
    permissions?: string[];
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<any>;
    login2FA: (userId: number, token: string) => Promise<void>;
    signup: (username: string, email: string, password: string, companyName?: string) => Promise<void>;
    logout: () => void;
    isAuthenticated: boolean;
    /** True if the current user has the named SOC permission (Phase 1 RBAC). */
    hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // After the base user is loaded, fetch SOC RBAC role + permissions.
    // Failures are silent — the SOC extension simply degrades to "no perms".
    const enrichWithRbac = async (base: User): Promise<User> => {
        try {
            const me = await rbacAPI.me();
            return { ...base, role: me.role, permissions: me.permissions };
        } catch {
            return base;
        }
    };

    // Check if user is logged in on mount
    useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    const userData = await authAPI.getCurrentUser();
                    setUser(await enrichWithRbac(userData));
                } catch (error) {
                    localStorage.removeItem('token');
                }
            }
            setLoading(false);
        };
        checkAuth();
    }, []);

    const login = async (email: string, password: string) => {
        try {
            const data = await authAPI.login(email, password);
            if (data.require_2fa) {
                return data;
            }
            localStorage.setItem('token', data.access_token);
            const userData = await authAPI.getCurrentUser();
            setUser(await enrichWithRbac(userData));
            toast.success('Login successful!');
            return data;
        } catch (error: any) {
            let message = 'Login failed';
            if (error.code === 'ERR_NETWORK') {
                message = 'Cannot connect to server. Is the backend running?';
            } else if (error.response?.data?.detail) {
                message = error.response.data.detail;
            }
            toast.error(message);
            throw error;
        }
    };

    const login2FA = async (userId: number, token: string) => {
        try {
            const data = await authAPI.login2FA(userId, token);
            localStorage.setItem('token', data.access_token);
            const userData = await authAPI.getCurrentUser();
            setUser(await enrichWithRbac(userData));
            toast.success('Login successful!');
        } catch (error: any) {
            let message = '2FA Verification failed';
            if (error.response?.data?.detail) {
                message = error.response.data.detail;
            }
            toast.error(message);
            throw error;
        }
    };

    const signup = async (username: string, email: string, password: string, companyName?: string) => {
        try {
            await authAPI.signup(username, email, password, companyName);
            toast.success('Account created! Please login.');
        } catch (error: any) {
            let message = 'Signup failed';
            if (error.code === 'ERR_NETWORK') {
                message = 'Cannot connect to server. Is the backend running?';
            } else if (error.response?.data?.detail) {
                message = error.response.data.detail;
            }
            toast.error(message);
            throw error;
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('active_org_id');
        setUser(null);
        toast.success('Logged out successfully');
    };

    const hasPermission = (permission: string): boolean => {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return Array.isArray(user.permissions) && user.permissions.includes(permission);
    };

    const value = {
        user,
        loading,
        login,
        login2FA,
        signup,
        logout,
        isAuthenticated: !!user,
        hasPermission,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
