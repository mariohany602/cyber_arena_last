/**
 * AI Security Assistant — module 12 of the SOC platform extension.
 *
 * Chat interface backed by /api/soc/ai/*. Supports context-aware
 * conversations (attach an incident / IOC / alert / MITRE technique)
 * and quick-action intents (explain, remediate, summarize, sigma,
 * investigate).
 *
 * Designed to degrade gracefully — if the OpenAI key isn't set the chat
 * UI still works, the assistant just responds with a "disabled" notice.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Bot, FileSearch, Hammer, MessageSquarePlus, Send, Sparkles,
    Trash2, User as UserIcon, Wand2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { aiAPI } from '../utils/api';
import type {
    AIChatResponse, AIConversationDetail, AIConversationRow, AIIntent,
    AIMessageRow,
} from '../utils/api';
import {
    SocPage, SocCard, PermissionGate, timeAgo,
} from '../components/soc/SocLayout';

const INTENT_BUTTONS: Array<{ key: AIIntent; label: string; icon: any; hint: string }> = [
    { key: 'explain',     label: 'Explain',      icon: Bot,         hint: 'Plain-English breakdown' },
    { key: 'remediate',   label: 'Remediate',    icon: Hammer,      hint: 'Concrete fix steps' },
    { key: 'summarize',   label: 'Summarize',    icon: Sparkles,    hint: 'Exec-ready summary' },
    { key: 'sigma',       label: 'Sigma rule',   icon: Wand2,       hint: 'Generate detection YAML' },
    { key: 'investigate', label: 'Investigate',  icon: FileSearch,  hint: 'Investigation playbook' },
];

const CONTEXT_TYPES = ['', 'incident', 'alert', 'ioc', 'mitre'];

export default function AIAssistant() {
    const [searchParams] = useSearchParams();

    const [enabled, setEnabled] = useState(true);
    const [model, setModel] = useState('');
    const [convs, setConvs] = useState<AIConversationRow[]>([]);
    const [active, setActive] = useState<AIConversationDetail | null>(null);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [contextType, setContextType] = useState(searchParams.get('ctx_type') || '');
    const [contextId, setContextId] = useState(searchParams.get('ctx_id') || '');

    const scrollRef = useRef<HTMLDivElement>(null);

    const loadConfig = async () => {
        try {
            const c = await aiAPI.config();
            setEnabled(c.enabled);
            setModel(c.model);
        } catch { /* ignore */ }
    };

    const loadConversations = async () => {
        try {
            setConvs(await aiAPI.listConversations());
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed to load'); }
    };

    const loadConversation = async (id: number) => {
        try {
            const c = await aiAPI.getConversation(id);
            setActive(c);
            if (c.context_type) setContextType(c.context_type);
            if (c.context_id) setContextId(c.context_id);
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    useEffect(() => { loadConfig(); loadConversations(); }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [active?.messages?.length]);

    const newChat = () => {
        setActive(null);
        setInput('');
    };

    const send = async (intent?: AIIntent, override?: string) => {
        const text = (override ?? input).trim();
        if (!text && !intent) { toast.error('Type a message'); return; }
        setBusy(true);
        try {
            const body = {
                message: text,
                conversation_id: active?.id ?? null,
                context_type: contextType || null,
                context_id: contextId || null,
            };
            const resp: AIChatResponse = intent
                ? await aiAPI.quick(intent, body)
                : await aiAPI.chat(body);

            // Update local conversation state without a full refetch.
            const newMessages: AIMessageRow[] = [
                ...(active?.messages || []),
                resp.user_message,
                resp.assistant_message,
            ];
            setActive({
                ...resp.conversation,
                messages: newMessages,
            });
            setInput('');
            if (!resp.conversation.id || (active?.id !== resp.conversation.id)) {
                loadConversations();
            }
            if (resp.provider_disabled) {
                toast('AI provider disabled — set OPENAI_API_KEY on backend.', { icon: 'ℹ️' });
            } else if (resp.error) {
                toast.error('Assistant returned an error — see message.');
            }
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Chat failed');
        } finally { setBusy(false); }
    };

    const deleteConv = async (id: number) => {
        if (!confirm('Delete this conversation?')) return;
        try {
            await aiAPI.deleteConversation(id);
            toast.success('Deleted');
            if (active?.id === id) setActive(null);
            loadConversations();
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed'); }
    };

    return (
        <SocPage
            eyebrow="AI security assistant"
            title={<><span className="text-white">Sentinel </span><span className="text-gradient-brand">AI</span></>}
            subtitle={
                enabled
                    ? <>Powered by <span className="font-mono text-white">{model}</span></>
                    : <span className="text-neon-yellow">Provider disabled — set OPENAI_API_KEY on the backend</span>
            }
            actions={
                <PermissionGate permission="ai.chat" fallback={
                    <span className="chip chip-base opacity-50">requires ai.chat permission</span>
                }>
                    <button onClick={newChat} className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30">
                        <MessageSquarePlus size={14} /> New chat
                    </button>
                </PermissionGate>
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
                {/* Conversations sidebar */}
                <SocCard padding="p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle mb-2 px-1">
                        Conversations
                    </div>
                    {convs.length === 0 ? (
                        <p className="text-xs text-ui-subtle italic px-1 py-2">No conversations yet.</p>
                    ) : (
                        <ul className="space-y-1 max-h-[640px] overflow-y-auto custom-scrollbar pr-1">
                            {convs.map(c => (
                                <li key={c.id} className="group">
                                    <div className={`flex items-start gap-1.5 rounded-lg border px-2 py-2 transition-colors
                                        ${active?.id === c.id
                                            ? 'bg-brand-primary/10 border-brand-primary/40'
                                            : 'border-ui-border/30 hover:border-ui-border-bright/40 hover:bg-white/[0.02]'}`}>
                                        <button onClick={() => loadConversation(c.id)} className="flex-1 min-w-0 text-left">
                                            <div className="text-xs font-medium text-white truncate">{c.title || 'Untitled'}</div>
                                            <div className="text-[10px] text-ui-subtle">
                                                {c.context_type ? <span className="font-mono">{c.context_type}{c.context_id ? `:${c.context_id}` : ''} · </span> : null}
                                                {timeAgo(c.updated_at)}
                                            </div>
                                        </button>
                                        <button onClick={() => deleteConv(c.id)}
                                            className="opacity-0 group-hover:opacity-100 text-ui-subtle hover:text-neon-red transition-all">
                                            <Trash2 size={11} />
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </SocCard>

                {/* Chat panel */}
                <SocCard padding="p-0">
                    {/* Context strip */}
                    <div className="px-5 py-3 border-b border-ui-border/30 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-ui-subtle">Context</span>
                        <select value={contextType} onChange={e => setContextType(e.target.value)}
                            disabled={!!active}
                            className="px-2 py-1 rounded bg-ui-surface border border-ui-border/40 text-xs">
                            {CONTEXT_TYPES.map(t => <option key={t} value={t}>{t || 'freeform'}</option>)}
                        </select>
                        {contextType && (
                            <input value={contextId} onChange={e => setContextId(e.target.value)}
                                disabled={!!active}
                                placeholder={contextType === 'incident' ? 'incident id' : `${contextType} id`}
                                className="px-2 py-1 rounded bg-ui-surface border border-ui-border/40 text-xs w-40 font-mono" />
                        )}
                        {active && (
                            <button onClick={newChat} className="chip chip-base ml-auto">
                                <X size={12} /> Close conversation
                            </button>
                        )}
                    </div>

                    {/* Messages */}
                    <div ref={scrollRef} className="max-h-[560px] min-h-[360px] overflow-y-auto custom-scrollbar p-5 space-y-4">
                        {!active && (
                            <EmptyState />
                        )}
                        {active?.messages?.map(m => (
                            <Bubble key={m.id} msg={m} />
                        ))}
                        {busy && (
                            <div className="flex items-center gap-2 text-xs text-ui-subtle italic">
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" />
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" style={{ animationDelay: '0.2s' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" style={{ animationDelay: '0.4s' }} />
                                <span>thinking…</span>
                            </div>
                        )}
                    </div>

                    {/* Quick intents */}
                    <div className="px-5 py-2 border-t border-ui-border/30 flex flex-wrap gap-1.5">
                        {INTENT_BUTTONS.map(b => {
                            const Icon = b.icon;
                            return (
                                <button key={b.key} onClick={() => send(b.key)}
                                    disabled={busy}
                                    title={b.hint}
                                    className="chip chip-base hover:bg-brand-primary/10 hover:text-brand-primary-bright disabled:opacity-40">
                                    <Icon size={12} /> {b.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Input */}
                    <PermissionGate permission="ai.chat" fallback={
                        <div className="px-5 py-4 text-xs text-ui-subtle italic border-t border-ui-border/30">
                            You don't have permission to chat with the assistant.
                        </div>
                    }>
                        <div className="px-5 py-4 border-t border-ui-border/30 flex gap-2">
                            <textarea
                                rows={2}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send();
                                    }
                                }}
                                disabled={busy}
                                placeholder="Ask anything — try 'why is rule 5710 firing on host WIN-04?'"
                                className="soc-input flex-1 resize-none font-sans"
                            />
                            <button onClick={() => send()} disabled={busy || !input.trim()}
                                className="chip chip-base bg-brand-primary/20 text-brand-primary-bright border-brand-primary/40 hover:bg-brand-primary/30 disabled:opacity-40 px-3">
                                <Send size={14} /> Send
                            </button>
                        </div>
                    </PermissionGate>
                </SocCard>
            </div>
        </SocPage>
    );
}

function EmptyState() {
    return (
        <div className="text-center py-12 text-ui-subtle">
            <Bot className="mx-auto mb-3 text-brand-primary-bright" size={32} />
            <h3 className="text-lg font-bold text-white mb-1">How can I help you investigate?</h3>
            <p className="text-sm text-ui-muted">
                Attach a context (incident / alert / IOC / MITRE technique) on the right,
                or just ask a question. Use the quick-intent buttons below for common tasks.
            </p>
        </div>
    );
}

function Bubble({ msg }: { msg: AIMessageRow }) {
    const isUser = msg.role === 'user';
    return (
        <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0
                ${isUser ? 'bg-brand-primary/20 text-brand-primary-bright' : 'bg-neon-magenta/15 text-neon-magenta'}`}>
                {isUser ? <UserIcon size={14} /> : <Bot size={14} />}
            </div>
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words
                ${isUser
                    ? 'bg-brand-primary/10 text-white rounded-tr-none border border-brand-primary/30'
                    : 'bg-ui-surface/60 text-slate-200 rounded-tl-none border border-ui-border/30'}`}>
                {msg.content}
                {msg.tokens_used > 0 && !isUser && (
                    <div className="text-[9px] font-mono text-ui-subtle mt-2 opacity-60">
                        {msg.tokens_used} tokens · {timeAgo(msg.created_at)}
                    </div>
                )}
            </div>
        </div>
    );
}
