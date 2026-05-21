/**
 * IOC detail view — module 4. Shows the full local IOC record plus its
 * cached enrichment (VirusTotal / AbuseIPDB / GeoIP / DNS).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, RefreshCw, Sparkles, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { iocsAPI } from '../utils/api';
import type { IOCRow } from '../utils/api';
import {
    SocPage, SocCard, PermissionGate, timeAgo, fmtDateTime,
} from '../components/soc/SocLayout';
import { ThreatBadge } from './IOCs';

export default function IOCDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const iocId = Number(id);

    const [data, setData] = useState<IOCRow | null>(null);
    const [loading, setLoading] = useState(false);
    const [enriching, setEnriching] = useState(false);

    const load = async () => {
        setLoading(true);
        try { setData(await iocsAPI.get(iocId)); }
        catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (!Number.isNaN(iocId)) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [iocId]);

    const reenrich = async () => {
        if (!data) return;
        setEnriching(true);
        try {
            await iocsAPI.enrich(data.type, data.value, true);
            toast.success('Re-enriched');
            load();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
        finally { setEnriching(false); }
    };

    const remove = async () => {
        if (!data) return;
        if (!confirm(`Delete IOC ${data.value}?`)) return;
        try {
            await iocsAPI.delete(data.id);
            toast.success('IOC deleted');
            navigate('/iocs');
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    if (Number.isNaN(iocId)) {
        return <SocPage eyebrow="IOC" title="Invalid IOC id"><SocCard>—</SocCard></SocPage>;
    }

    const enrichment = data?.enrichment || {};

    return (
        <SocPage
            eyebrow={`IOC #${iocId}`}
            title={data ? <span className="font-mono text-white break-all">{data.value}</span> : <span className="text-ui-muted">Loading…</span>}
            subtitle={data ? <>First seen {timeAgo(data.first_seen)} · Last seen {timeAgo(data.last_seen)}</> : null}
            actions={
                <>
                    <button onClick={() => navigate('/iocs')} className="chip chip-base"><ArrowLeft size={14} /> Back</button>
                    <button onClick={load} disabled={loading} className="chip chip-base">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <PermissionGate permission="ioc.enrich">
                        <button onClick={reenrich} disabled={enriching}
                            className="chip chip-base bg-neon-magenta/15 text-neon-magenta border-neon-magenta/40 hover:bg-neon-magenta/25">
                            <Sparkles size={14} className={enriching ? 'animate-pulse' : ''} />
                            {enriching ? 'Enriching…' : 'Re-enrich'}
                        </button>
                    </PermissionGate>
                    <PermissionGate permission="ioc.delete">
                        <button onClick={remove}
                            className="chip chip-base hover:bg-neon-red/15 hover:text-neon-red hover:border-neon-red/40">
                            <Trash2 size={14} /> Delete
                        </button>
                    </PermissionGate>
                </>
            }
        >
            {!data ? (
                <SocCard><div className="text-center text-ui-subtle py-10">Loading…</div></SocCard>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2 space-y-5">
                        <SocCard>
                            <div className="flex flex-wrap gap-2 items-center mb-3">
                                <span className="chip chip-base uppercase">{data.type}</span>
                                <ThreatBadge score={data.threat_score} />
                                {data.source && <span className="chip chip-base">via {data.source}</span>}
                                {data.confidence && <span className="chip chip-base">conf:{data.confidence}</span>}
                                <span className="chip chip-base">TLP:{data.tlp.toUpperCase()}</span>
                            </div>
                            {data.description ? (
                                <p className="text-sm text-slate-200 whitespace-pre-wrap">{data.description}</p>
                            ) : (
                                <p className="text-sm text-ui-subtle italic">No description.</p>
                            )}
                            {data.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-3">
                                    {data.tags.map(t => <span key={t} className="chip chip-base">{t}</span>)}
                                </div>
                            )}
                        </SocCard>

                        <EnrichmentBlock title="VirusTotal" data={enrichment.virustotal} />
                        <EnrichmentBlock title="AbuseIPDB"  data={enrichment.abuseipdb} />
                        <EnrichmentBlock title="GeoIP"      data={enrichment.geoip} />
                        <EnrichmentBlock title="DNS"        data={enrichment.dns} />
                    </div>

                    <div className="space-y-5">
                        <SocCard>
                            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-3">Record</div>
                            <dl className="text-xs space-y-1.5">
                                <Row k="Type"        v={data.type} />
                                <Row k="Source"      v={data.source || '—'} />
                                <Row k="Confidence"  v={data.confidence} />
                                <Row k="Threat score" v={String(data.threat_score)} />
                                <Row k="TLP"         v={data.tlp.toUpperCase()} />
                                <Row k="First seen"  v={fmtDateTime(data.first_seen)} />
                                <Row k="Last seen"   v={fmtDateTime(data.last_seen)} />
                                <Row k="Created"     v={fmtDateTime(data.created_at)} />
                                <Row k="Updated"     v={fmtDateTime(data.updated_at)} />
                            </dl>
                        </SocCard>
                    </div>
                </div>
            )}
        </SocPage>
    );
}

function EnrichmentBlock({ title, data }: { title: string; data: any }) {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
    return (
        <SocCard>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
                {typeof data.score === 'number' && <ThreatBadge score={data.score} />}
            </div>
            {data.provider_disabled ? (
                <p className="text-xs text-ui-subtle italic">Provider disabled (no API key configured).</p>
            ) : data.error ? (
                <p className="text-xs text-neon-red">{data.error}</p>
            ) : (
                <pre className="text-[11px] text-ui-muted whitespace-pre-wrap break-all bg-white/[0.02] rounded p-2 max-h-72 overflow-auto custom-scrollbar">
                    {JSON.stringify(data, null, 2)}
                </pre>
            )}
        </SocCard>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex justify-between gap-3">
            <dt className="text-ui-subtle">{k}</dt>
            <dd className="text-slate-200 text-right break-all">{v}</dd>
        </div>
    );
}
