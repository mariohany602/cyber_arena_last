import { useEffect, useState } from 'react';
import { Sparkles, X, ArrowRight, Lock } from 'lucide-react';
import type { FeatureLockedDetail } from '../utils/api';

/**
 * Global plan-gating modal. Listens for the `feature-locked` window event
 * that ``api.ts``'s response interceptor dispatches whenever the backend
 * returns 403 with ``detail.error === 'feature_locked'``. Renders a single
 * upgrade CTA pointing at /settings/organization.
 */
export default function UpgradeModal() {
    const [detail, setDetail] = useState<FeatureLockedDetail | null>(null);

    useEffect(() => {
        const onLocked = (e: Event) => {
            const ce = e as CustomEvent<FeatureLockedDetail>;
            setDetail(ce.detail);
        };
        window.addEventListener('feature-locked', onLocked as EventListener);
        return () => window.removeEventListener('feature-locked', onLocked as EventListener);
    }, []);

    if (!detail) return null;

    const close = () => setDetail(null);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={close}>
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative max-w-md w-full rounded-2xl border border-brand-500/40 bg-ui-panel shadow-2xl shadow-brand-500/20 p-6"
            >
                <button
                    onClick={close}
                    className="absolute top-3 right-3 text-ui-muted hover:text-white"
                    aria-label="Close"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-brand-500/15 border border-brand-500/30 p-2.5">
                        <Lock className="w-6 h-6 text-brand-400" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-white">Upgrade required</h3>
                        <p className="text-sm text-ui-muted mt-1">{detail.message}</p>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg border border-ui-border bg-ui-bg p-3">
                        <p className="font-black uppercase tracking-widest text-ui-muted">Current plan</p>
                        <p className="text-white font-mono mt-1">{detail.current_plan}</p>
                    </div>
                    <div className="rounded-lg border border-brand-500/40 bg-brand-500/5 p-3">
                        <p className="font-black uppercase tracking-widest text-brand-300">Unlocks at</p>
                        <p className="text-brand-300 font-mono mt-1">{detail.upgrade_to || '—'}</p>
                    </div>
                </div>

                <div className="mt-5 flex items-center gap-3">
                    <button
                        onClick={close}
                        className="px-4 py-2 rounded-lg border border-ui-border bg-ui-bg text-ui-muted hover:text-white text-sm font-bold transition"
                    >
                        Not now
                    </button>
                    <button
                        onClick={() => { close(); window.location.assign('/settings/organization'); }}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-black font-bold text-sm transition"
                    >
                        <Sparkles className="w-4 h-4" /> View plans <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
