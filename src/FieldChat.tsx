import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronRight, MessageSquare, SendHorizontal } from 'lucide-react';
import { api } from './api';
import type { CaseMessage } from './api';
import type { RecoveryCase } from './types';

const POLL_MS = 5000; // ponytail: polling; switch to SSE/websocket if chat volume grows

export function ChatList({ cases, onOpen }: { cases: RecoveryCase[]; onOpen: (caseId: string) => void }) {
  if (!cases.length) return <p className="field-empty">Chats open once a finance company assigns you a case.</p>;
  return <section className="field-list">{cases.map((item) => <button key={item.id} className="field-list-row" onClick={() => onOpen(item.id)}>
    <MessageSquare size={18} /><span><strong>{item.finance?.company ?? 'Finance team'}</strong><small>{item.vehicle.registration} · {item.id}</small></span><ChevronRight size={17} />
  </button>)}</section>;
}

export function ChatThread({ token, caseId, userId, online, onError }: { token: string; caseId: string; userId: string; online: boolean; onError: (message: string) => void }) {
  const [messages, setMessages] = useState<CaseMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => api.caseMessages(token, caseId).then(({ messages: next }) => { if (active) setMessages(next); }).catch(() => { if (active) setMessages((current) => current ?? []); });
    void load();
    const timer = window.setInterval(() => { if (navigator.onLine) void load(); }, POLL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, caseId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const { message } = await api.sendCaseMessage(token, caseId, body);
      setMessages((current) => [...(current ?? []), message]);
      setDraft('');
    } catch (error) { onError(error instanceof Error ? error.message : 'Message not sent.'); } finally { setSending(false); }
  }

  return <section className="chat">
    <div className="chat-messages">
      {messages === null ? <p className="field-empty">Loading messages…</p>
        : messages.length === 0 ? <p className="field-empty">No messages yet. Say hello to the finance team.</p>
        : messages.map((item) => <div key={item.id} className={`chat-bubble ${item.senderId === userId ? 'mine' : ''}`}>
          {item.senderId !== userId && <small>{item.senderName}</small>}<p>{item.body}</p><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </div>)}
      <div ref={endRef} />
    </div>
    <form className="chat-compose" onSubmit={send}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder={online ? 'Type a message' : 'Offline · reconnect to send'} disabled={!online} aria-label="Message" />
      <button type="submit" disabled={!online || sending || !draft.trim()} aria-label="Send message"><SendHorizontal size={19} /></button>
    </form>
  </section>;
}
