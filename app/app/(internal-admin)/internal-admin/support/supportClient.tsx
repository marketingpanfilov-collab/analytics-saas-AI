"use client";

import { useEffect, useState } from "react";

type AdminTicket = {
  id: string;
  ticket_no: number | null;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  user_email: string | null;
  last_message: string | null;
};

type TicketMessage = {
  id: string;
  sender_role: string;
  body: string;
  created_at: string;
};

export default function InternalSupportPageClient() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal-admin/support/tickets", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Failed to load tickets");
        setTickets([]);
        return;
      }
      setTickets(Array.isArray(json.tickets) ? json.tickets : []);
    } catch {
      setError("Network error");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!activeTicketId) {
      setMessages([]);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/internal-admin/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok || !json?.success) {
          setError(json?.error ?? "Failed to load messages");
          setMessages([]);
          return;
        }
        setMessages(Array.isArray(json.messages) ? json.messages : []);
      } catch {
        if (mounted) {
          setError("Network error");
          setMessages([]);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeTicketId]);

  async function updateTicket(id: string, patch: { status?: string; priority?: string }) {
    try {
      const res = await fetch("/api/internal-admin/support/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: id, ...patch }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Failed to update ticket");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTicketId || !reply.trim()) return;
    setReplyBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/internal-admin/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Failed to send");
        return;
      }
      setReply("");
      const after = await fetch(`/api/internal-admin/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
        cache: "no-store",
      });
      const afterJson = await after.json();
      setMessages(Array.isArray(afterJson?.messages) ? afterJson.messages : []);
      await load();
    } catch {
      setError("Network error");
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white/95">Support queue</h1>
      {error ? <div className="text-sm text-red-300">{error}</div> : null}
      {loading ? <div className="text-sm text-white/70">Loading...</div> : null}
      {!loading && tickets.length === 0 ? <div className="text-sm text-white/70">No tickets yet.</div> : null}
      <div className="space-y-3">
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
              <div className="text-sm font-semibold">
                #{t.ticket_no ?? "—"} {t.subject}
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs">{t.status}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs">{t.priority}</span>
              <span className="text-xs text-white/65">{t.user_email ?? "unknown user"}</span>
            </div>
            {t.last_message ? <p className="mt-2 text-sm text-white/75">{t.last_message}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void updateTicket(t.id, { status: "in_progress" })}
                className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-xs"
              >
                Mark in_progress
              </button>
              <button
                type="button"
                onClick={() => void updateTicket(t.id, { status: "resolved" })}
                className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-xs"
              >
                Mark resolved
              </button>
              <button
                type="button"
                onClick={() => void updateTicket(t.id, { priority: "urgent" })}
                className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-xs"
              >
                Set urgent
              </button>
            </div>
          </button>
        ))}
      </div>
      {activeTicketId ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white/90">Ticket thread</div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/55">{m.sender_role}</div>
                <div className="mt-1 text-sm text-white/90">{m.body}</div>
              </div>
            ))}
            {messages.length === 0 ? <div className="text-sm text-white/70">No messages yet.</div> : null}
          </div>
          <form onSubmit={sendReply} className="space-y-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to user"
              className="min-h-[90px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={replyBusy}
              className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm disabled:opacity-60"
            >
              {replyBusy ? "Sending..." : "Send reply"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

