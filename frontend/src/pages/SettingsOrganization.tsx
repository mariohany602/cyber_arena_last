import { useEffect, useState } from 'react';
import { Building2, RefreshCcw, Shield, KeyRound, CheckCircle2, AlertTriangle, Loader2, Copy, Cpu, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import ToolLayout from '../components/layout/ToolLayout';
import { orgAPI, plansAPI, type CurrentOrg, type ProvisionResult, type PlanInfo, type OrgUsage } from '../utils/api';
import toast from 'react-hot-toast';

/**
 * Settings → Organization
 *
 * Tenant-owner view of the SaaS spine: shows the org's identifiers on the
 * shared SOC stack (Wazuh group, TheHive org, Shuffle tag), the
 * provisioning status, and a **Provision now** button that re-runs
 * tenant_provisioning.provision_tenant() against the live Wazuh/TheHive
 * APIs. Useful when those machines were unreachable at signup time and
 * we need to retry after the fact.
 */
export default function SettingsOrganization() {
    const [org, setOrg] = useState<CurrentOrg | null>(null);
    const [plans, setPlans] = useState<PlanInfo[]>([]);
    const [usage, setUsage] = useState<OrgUsage | null>(null);
    const [loading, setLoading] = useState(true);
    const [provisioning, setProvisioning] = useState(false);
    const [lastResult, setLastResult] = useState<ProvisionResult['result'] | null>(null);
    const [rotating, setRotating] = useState(false);
    const [switchingTo, setSwitchingTo] = useState<string | null>(null);

    const refresh = async () => {
        try {
            setLoading(true);
            const [o, p, u] = await Promise.all([
                orgAPI.current(),
                plansAPI.list().catch(() => []),
                orgAPI.usage().catch(() => null),
            ]);
            setOrg(o);
            setPlans(p);
            setUsage(u);
        } catch (e: any) {
            toast.error(e.response?.data?.detail || 'Failed to load organization');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); }, []);

    const isOwnerOrAdmin = org && (org.my_role === 'owner' || org.my_role === 'admin');
    const isOwner = org && org.my_role === 'owner';

    const handleSwitchPlan = async (code: string) => {
        if (!org || code === org.plan) return;
        if (!confirm(`Switch this organization's plan to "${code}"? (Demo only — no payment is taken.)`)) return;
        setSwitchingTo(code);
        try {
            const updated = await orgAPI.changePlan(code);
            setOrg({ ...org, plan: updated.plan, features: updated.features });
            toast.success(`Switched to ${code}`);
        } catch (e: any) {
            toast.error(e.response?.data?.detail || 'Plan switch failed');
        } finally {
            setSwitchingTo(null);
        }
    };

    const handleProvision = async () => {
        if (!org) return;
        setProvisioning(true);
        setLastResult(null);
        try {
            const res = await orgAPI.provision();
            setLastResult(res.result);
            toast.success('Provisioning completed');
            await refresh();
        } catch (e: any) {
            toast.error(e.response?.data?.detail || 'Provisioning failed');
        } finally {
            setProvisioning(false);
        }
    };

    const handleRotate = async () => {
        if (!org) return;
        if (!confirm('Rotate the enrollment key? Any pre-existing installer one-liners will stop working immediately.')) return;
        setRotating(true);
        try {
            const { enrollment_key } = await orgAPI.rotateEnrollmentKey();
            setOrg({ ...org, enrollment_key });
            toast.success('Enrollment key rotated');
        } catch (e: any) {
            toast.error(e.response?.data?.detail || 'Rotation failed');
        } finally {
            setRotating(false);
        }
    };

    const copy = (value: string | null | undefined, label: string) => {
        if (!value) return;
        navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
    };

    return (
        <ToolLayout title="Organization Settings" icon={Building2}>
            <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
                {loading && (
                    <div className="flex items-center gap-3 text-ui-muted">
                        <Loader2 className="w-5 h-5 animate-spin" /> Loading organization…
                    </div>
                )}

                {org && (
                    <>
                        {/* Header */}
                        <div className="rounded-xl border border-ui-border bg-ui-panel p-6 flex items-start justify-between">
                            <div className="flex items-start gap-4">
                                <div className="rounded-lg bg-brand-500/15 border border-brand-500/30 p-3">
                                    <Building2 className="w-6 h-6 text-brand-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">{org.name}</h2>
                                    <p className="text-xs text-ui-muted font-mono mt-1">slug: {org.slug}</p>
                                    <div className="flex gap-2 mt-3">
                                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-brand-500/20 text-brand-300 border border-brand-500/30">
                                            {org.plan}
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-ui-bg text-ui-muted border border-ui-border">
                                            {org.my_role}
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-ui-bg text-ui-muted border border-ui-border">
                                            {org.status}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <ProvisionBadge provisioned={org.provisioned} />
                        </div>

                        {/* Usage / quotas */}
                        {usage && (
                            <div className="rounded-xl border border-ui-border bg-ui-panel p-6">
                                <h3 className="text-lg font-bold text-white mb-4">Usage this period</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <UsageTile
                                        label="Team members"
                                        used={usage.current.users}
                                        cap={usage.limits.max_users}
                                    />
                                    <UsageTile
                                        label="Scans (last 30 days)"
                                        used={usage.current.scans_30d}
                                        cap={usage.limits.max_engagements}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Provisioning panel */}
                        <div className="rounded-xl border border-ui-border bg-ui-panel p-6">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Shield className="w-5 h-5 text-brand-400" /> SOC Stack Provisioning
                                    </h3>
                                    <p className="text-sm text-ui-muted mt-1">
                                        Creates this tenant's Wazuh agent group and TheHive organisation so
                                        data is isolated server-side. Gated by <code className="text-brand-300">PROVISIONING_ENABLED</code> on the backend.
                                    </p>
                                </div>
                                {isOwnerOrAdmin && (
                                    <button
                                        onClick={handleProvision}
                                        disabled={provisioning}
                                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-black font-bold text-sm transition"
                                    >
                                        {provisioning
                                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Provisioning…</>
                                            : <><RefreshCcw className="w-4 h-4" /> Provision now</>}
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                                <IdField label="Wazuh agent group" value={org.wazuh_agent_group} onCopy={copy} />
                                <IdField label="TheHive organisation" value={org.thehive_org_name} onCopy={copy} />
                                <IdField label="Shuffle tag" value={org.wazuh_agent_group /* same convention */} onCopy={copy} />
                            </div>

                            {lastResult && (
                                <div className="mt-5 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-ui-muted">Last run</p>
                                    {(['wazuh', 'thehive', 'shuffle'] as const).map((k) => {
                                        const r = (lastResult as any)[k];
                                        if (!r) return null;
                                        const failed = !!r.error;
                                        return (
                                            <div key={k} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${failed ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
                                                {failed
                                                    ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                                    : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                                                <div className="font-mono text-xs">
                                                    <span className="font-bold uppercase">{k}</span>: {failed ? r.error : (r.note || (r.created ? 'created' : 'ok'))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {!lastResult && org.provision_error && (
                                <div className="mt-5 flex items-start gap-2 text-sm px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <div className="font-mono text-xs">{org.provision_error}</div>
                                </div>
                            )}
                        </div>

                        {/* Plan switcher */}
                        <div className="rounded-xl border border-ui-border bg-ui-panel p-6">
                            <div className="flex items-start justify-between gap-4 mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Sparkles className="w-5 h-5 text-brand-400" /> Subscription plan
                                    </h3>
                                    <p className="text-sm text-ui-muted mt-1">
                                        Owner-only. No payment is taken — this is a demo plan switcher to showcase feature gating.
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                {plans.map((p) => {
                                    const isCurrent = p.code === org.plan;
                                    const isLoading = switchingTo === p.code;
                                    return (
                                        <div
                                            key={p.code}
                                            className={`rounded-lg border p-4 flex flex-col ${isCurrent ? 'border-brand-500/60 bg-brand-500/5' : 'border-ui-border bg-ui-bg'}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-bold text-white uppercase tracking-wider">{p.name}</p>
                                                {isCurrent && (
                                                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
                                                        current
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-2xl font-black text-brand-300 mt-2">
                                                {p.price_monthly_cents === 0
                                                    ? (p.code === 'enterprise' ? 'Contact us' : 'Free')
                                                    : `$${(p.price_monthly_cents / 100).toFixed(0)}`}
                                                {p.price_monthly_cents > 0 && <span className="text-xs text-ui-muted font-normal">/mo</span>}
                                            </p>
                                            <ul className="mt-3 space-y-1 text-xs text-ui-muted flex-1">
                                                {(['sqlmap', 'nuclei', 'ai_assistant'] as const).map((f) => (
                                                    <li key={f} className="flex items-center gap-1.5">
                                                        {p.features[f]
                                                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                                            : <span className="w-3.5 h-3.5 inline-block rounded-full border border-ui-border" />}
                                                        <span className={p.features[f] ? 'text-white' : ''}>{f}</span>
                                                    </li>
                                                ))}
                                                <li className="text-[10px] mt-2 opacity-70">
                                                    users: {p.features.max_users === -1 ? '∞' : p.features.max_users}
                                                </li>
                                            </ul>
                                            <button
                                                onClick={() => handleSwitchPlan(p.code)}
                                                disabled={!isOwner || isCurrent || !!switchingTo}
                                                className={`mt-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-bold transition ${
                                                    isCurrent
                                                        ? 'bg-ui-bg text-ui-muted cursor-default'
                                                        : 'bg-brand-500 hover:bg-brand-400 text-black disabled:opacity-50'
                                                }`}
                                            >
                                                {isLoading
                                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                                    : (isCurrent ? 'Current plan' : (isOwner ? 'Switch' : 'Owner only'))}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Enrollment key */}
                        <div className="rounded-xl border border-ui-border bg-ui-panel p-6">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <KeyRound className="w-5 h-5 text-brand-400" /> Agent enrollment key
                                    </h3>
                                    <p className="text-sm text-ui-muted mt-1">
                                        Used by the one-liner installer to register Wazuh agents into <code className="text-brand-300">{org.wazuh_agent_group}</code>.
                                    </p>
                                </div>
                                {isOwnerOrAdmin && (
                                    <button
                                        onClick={handleRotate}
                                        disabled={rotating}
                                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ui-bg hover:bg-ui-border border border-ui-border text-white font-bold text-sm transition disabled:opacity-50"
                                    >
                                        {rotating
                                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Rotating…</>
                                            : <><RefreshCcw className="w-4 h-4" /> Rotate</>}
                                    </button>
                                )}
                            </div>
                            <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-ui-bg border border-ui-border font-mono text-xs text-ui-muted">
                                <code className="flex-1 truncate">{org.enrollment_key || '—'}</code>
                                <button
                                    onClick={() => copy(org.enrollment_key, 'Enrollment key')}
                                    className="text-brand-400 hover:text-brand-300"
                                    title="Copy"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                            </div>
                            <Link
                                to="/settings/agents"
                                className="inline-flex items-center gap-2 mt-4 text-sm text-brand-300 hover:text-brand-200 font-bold"
                            >
                                <Cpu className="w-4 h-4" /> Manage registered agents →
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </ToolLayout>
    );
}

function ProvisionBadge({ provisioned }: { provisioned: boolean }) {
    if (provisioned) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3.5 h-3.5" /> Provisioned
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" /> Not provisioned
        </span>
    );
}

function UsageTile({ label, used, cap }: { label: string; used: number; cap: number | null | undefined }) {
    const unlimited = cap === -1 || cap == null;
    const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, cap as number)) * 100));
    const nearCap = !unlimited && pct >= 80;
    const overCap = !unlimited && pct >= 100;
    return (
        <div className="rounded-lg border border-ui-border bg-ui-bg p-4">
            <div className="flex items-baseline justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-ui-muted">{label}</p>
                <p className={`text-sm font-mono font-bold ${overCap ? 'text-red-300' : nearCap ? 'text-amber-300' : 'text-white'}`}>
                    {used}<span className="text-ui-muted"> / {unlimited ? '∞' : cap}</span>
                </p>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-ui-border/40 overflow-hidden">
                <div
                    className={`h-full transition-all ${overCap ? 'bg-red-400' : nearCap ? 'bg-amber-400' : 'bg-brand-400'}`}
                    style={{ width: unlimited ? '6%' : `${pct}%` }}
                />
            </div>
            {!unlimited && nearCap && (
                <p className={`mt-2 text-xs ${overCap ? 'text-red-300' : 'text-amber-300'}`}>
                    {overCap ? 'Limit exceeded — upgrade to continue.' : 'Approaching plan limit.'}
                </p>
            )}
        </div>
    );
}

function IdField({ label, value, onCopy }: { label: string; value: string | null | undefined; onCopy: (v: string | null | undefined, label: string) => void }) {
    return (
        <div className="rounded-lg border border-ui-border bg-ui-bg p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-ui-muted">{label}</p>
            <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-sm text-white">{value || '—'}</code>
                {value && (
                    <button onClick={() => onCopy(value, label)} className="text-brand-400 hover:text-brand-300" title="Copy">
                        <Copy className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}
