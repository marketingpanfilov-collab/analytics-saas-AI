"use client";

import { useEffect, useState } from "react";

type Ticket = {
  id: string;
  ticket_no: number | null;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  last_message: string | null;
};

type TicketMessage = {
  id: string;
  sender_role: string;
  body: string;
  created_at: string;
};

export default function SupportPageClient() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  async function loadTickets() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Не удалось загрузить тикеты");
        setTickets([]);
        return;
      }
      setTickets(Array.isArray(json.tickets) ? json.tickets : []);
    } catch {
      setError("Ошибка сети");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  useEffect(() => {
    if (!activeTicketId) {
      setMessages([]);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok || !json?.success) {
          setError(json?.error ?? "Не удалось загрузить переписку");
          setMessages([]);
          return;
        }
        setMessages(Array.isArray(json.messages) ? json.messages : []);
      } catch {
        if (mounted) {
          setError("Ошибка сети");
          setMessages([]);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeTicketId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: message.trim(),
          priority,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Не удалось создать тикет");
        return;
      }
      setSubject("");
      setMessage("");
      setPriority("normal");
      await loadTickets();
    } catch {
      setError("Ошибка сети");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTicketId || !reply.trim()) return;
    setReplyBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Не удалось отправить сообщение");
        return;
      }
      setReply("");
      const after = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
        cache: "no-store",
      });
      const afterJson = await after.json();
      setMessages(Array.isArray(afterJson?.messages) ? afterJson.messages : []);
      await loadTickets();
    } catch {
      setError("Ошибка сети");
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-white/95">Поддержка</h1>
        <p className="mt-1 text-sm text-white/65">Создайте обращение и отслеживайте статус ответа команды поддержки.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Тема обращения"
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none"
            maxLength={180}
            required
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none"
          >
            <option value="low">Низкий</option>
            <option value="normal">Обычный</option>
            <option value="high">Высокий</option>
            <option value="urgent">Срочный</option>
          </select>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Опишите проблему"
          className="min-h-[120px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
          required
        />
        {error ? <div className="text-sm text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center rounded-lg border border-emerald-400/35 bg-emerald-500/[0.18] px-4 text-sm font-semibold text-white transition hover:bg-emerald-500/[0.26] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Отправка..." : "Создать тикет"}
        </button>
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-white/90">Мои обращения</h2>
        {loading ? <div className="text-sm text-white/60">Загрузка...</div> : null}
        {!loading && tickets.length === 0 ? <div className="text-sm text-white/60">Обращений пока нет.</div> : null}
        {tickets.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTicketId(t.id)}
            className={`w-full rounded-xl border p-4 text-left ${
              activeTicketId === t.id ? "border-emerald-400/40 bg-emerald-500/[0.08]" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-white/95">
                #{t.ticket_no ?? "—"} {t.subject}
              </div>
              <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-xs text-white/75">
                {t.status}
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-xs text-white/75">
                {t.priority}
              </span>
            </div>
            {t.last_message ? <p className="mt-2 text-sm text-white/70">{t.last_message}</p> : null}
          </button>
        ))}
      </div>

      {activeTicketId ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="text-sm font-semibold text-white/90">Переписка по обращению</h3>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/55">{m.sender_role}</div>
                <div className="mt-1 text-sm text-white/90">{m.body}</div>
              </div>
            ))}
            {messages.length === 0 ? <div className="text-sm text-white/60">Сообщений пока нет.</div> : null}
          </div>
          <form onSubmit={submitReply} className="space-y-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Ваше сообщение"
              className="min-h-[90px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
            <button
              type="submit"
              disabled={replyBusy}
              className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/[0.05] px-3 text-sm font-semibold text-white/90 disabled:opacity-60"
            >
              {replyBusy ? "Отправка..." : "Отправить"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

