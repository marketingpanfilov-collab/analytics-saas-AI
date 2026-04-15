"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { acquireBodyScrollLock } from "@/app/lib/bodyScrollLock";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";
import { ALLOWED_TYPES, MAX_ATTACHMENTS, MAX_BYTES, type StoredAttachment } from "@/app/lib/supportAttachments";

const SUPPORT_READ_STORAGE_KEY = "boardiq_support_ticket_read_v1";

type Ticket = {
  id: string;
  ticket_no: number | null;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_sender_role?: string | null;
};

type MessageAttachment = {
  name: string;
  size: number;
  url: string;
  content_type?: string;
};

type TicketMessage = {
  id: string;
  sender_role: string;
  body: string;
  created_at: string;
  attachments?: MessageAttachment[];
};

function loadReadMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SUPPORT_READ_STORAGE_KEY);
    const j = raw ? JSON.parse(raw) : {};
    return typeof j === "object" && j && !Array.isArray(j) ? (j as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistReadMap(map: Record<string, string>) {
  try {
    localStorage.setItem(SUPPORT_READ_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

function formatRelativeRu(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Короткое время в ленте сообщений */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function clientFileAllowed(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t && ALLOWED_TYPES.has(t)) return true;
  return file.name.toLowerCase().endsWith(".zip");
}

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "open") return "Открыт";
  if (s === "waiting" || s === "pending") return "Ожидает";
  if (s === "closed") return "Закрыт";
  if (s === "in_progress" || s === "in progress") return "В работе";
  return status.replace(/_/g, " ");
}

function priorityLabel(p: string): string {
  const x = p.toLowerCase();
  if (x === "low") return "Низкий";
  if (x === "normal") return "Обычный";
  if (x === "high") return "Высокий";
  if (x === "urgent") return "Срочный";
  return p;
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "open") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200/90";
  if (s === "waiting" || s === "pending")
    return "border-amber-500/25 bg-amber-500/10 text-amber-200/85";
  if (s === "closed") return "border-white/[0.1] bg-white/[0.05] text-white/45";
  return "border-white/[0.12] bg-white/[0.06] text-white/55";
}

function priorityBadgeClass(p: string): string {
  const x = p.toLowerCase();
  if (x === "urgent" || x === "high") return "border-white/15 bg-white/[0.08] text-white/70";
  if (x === "low") return "border-white/[0.08] bg-white/[0.04] text-white/40";
  return "border-white/[0.1] bg-white/[0.05] text-white/50";
}

function isUserRole(role: string): boolean {
  return role.toLowerCase() === "user";
}

function ticketHasUnreadSupport(t: Ticket, readMap: Record<string, string>): boolean {
  const role = (t.last_message_sender_role ?? "").toLowerCase();
  if (!role || role === "user") return false;
  const seen = readMap[t.id];
  if (!seen) return true;
  return new Date(t.updated_at).getTime() > new Date(seen).getTime();
}

function markTicketReadInStorage(ticketId: string, updatedAt: string) {
  const m = loadReadMap();
  m[ticketId] = updatedAt;
  persistReadMap(m);
}

// --- Skeletons ---

function TicketRowSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex gap-2">
        <div className="h-4 w-16 rounded bg-white/10" />
        <div className="h-4 flex-1 rounded bg-white/10" />
      </div>
      <div className="mt-2 h-3 w-full rounded bg-white/[0.06]" />
      <div className="mt-2 flex gap-2">
        <div className="h-5 w-14 rounded-full bg-white/10" />
        <div className="h-5 w-14 rounded-full bg-white/10" />
      </div>
    </div>
  );
}

function ChatBubbleSkeleton({ align }: { align: "left" | "right" }) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"} animate-pulse`}>
      <div
        className={`max-w-[70%] rounded-2xl px-3 py-2 ${
          align === "right" ? "rounded-br-md bg-white/10" : "rounded-bl-md bg-white/[0.06]"
        }`}
      >
        <div className="h-3 w-24 rounded bg-white/10" />
        <div className="mt-2 h-3 w-48 rounded bg-white/[0.07]" />
      </div>
    </div>
  );
}

// --- New ticket modal ---

const inputFocusClass =
  "focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10";

function NewTicketModal({
  open,
  onClose,
  canSupport,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  canSupport: boolean;
  onCreated: (ticketId: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    return acquireBodyScrollLock();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSubject("");
      setMessage("");
      setPriority("normal");
      setLocalError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSupport) return;
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setLocalError(null);
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
        setLocalError(json?.error ?? "Не удалось создать обращение");
        return;
      }
      const tid = String(json.ticket_id ?? "");
      if (tid) onCreated(tid);
      onClose();
    } catch {
      setLocalError("Ошибка сети");
    } finally {
      setSubmitting(false);
    }
  }

  const overlay = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-new-ticket-title"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#12141c] shadow-[0_16px_48px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            background: "linear-gradient(165deg, rgba(255,255,255,0.04) 0%, transparent 42%)",
          }}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-white/[0.06] px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
            <div className="flex items-start justify-between gap-3">
              <h2 id="support-new-ticket-title" className="text-lg font-bold tracking-tight text-white">
                Новое обращение
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.08] hover:text-white/75"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-white/50">Опишите проблему — команда ответит в этом чате.</p>
          </div>

          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
          >
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/40">
                  Тема
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Кратко, о чём обращение"
                  className={`h-11 w-full rounded-xl border border-white/[0.1] bg-black/40 px-3.5 text-sm text-white placeholder:text-white/30 ${inputFocusClass}`}
                  maxLength={180}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/40">
                  Приоритет
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className={`settings-page-select h-11 ${inputFocusClass}`}
                >
                  <option value="low">Низкий</option>
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                  <option value="urgent">Срочный</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/40">
                  Описание проблемы
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Детали, шаги воспроизведения, скриншоты можно описать текстом"
                  className={`min-h-[120px] w-full resize-y rounded-xl border border-white/[0.1] bg-black/40 px-3.5 py-3 text-sm text-white placeholder:text-white/30 ${inputFocusClass}`}
                  required
                />
              </div>
              {localError ? <p className="text-sm text-red-300/90">{localError}</p> : null}
            </div>
            <div className="mt-6 flex shrink-0 flex-wrap items-center gap-3 border-t border-white/[0.06] pt-5">
              <button
                type="submit"
                disabled={!canSupport || submitting}
                aria-busy={submitting}
                className="inline-flex h-11 min-w-[160px] flex-1 items-center justify-center rounded-xl border border-sky-500/35 bg-gradient-to-b from-sky-500/20 to-sky-600/12 px-5 text-sm font-semibold text-white transition hover:border-sky-400/40 hover:from-sky-500/25 disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
              >
                {submitting ? "Создание…" : "Создать обращение"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-2 text-sm font-medium text-white/45 hover:text-white/70"
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

export default function SupportPageClient() {
  const { resolvedUi } = useBillingBootstrap();
  const canSupport = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.support),
    [resolvedUi]
  );

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [readMap, setReadMap] = useState<Record<string, string>>({});

  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [newModalOpen, setNewModalOpen] = useState(false);

  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<StoredAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTicket = useMemo(
    () => tickets.find((t) => t.id === activeTicketId) ?? null,
    [tickets, activeTicketId]
  );

  const isClosed = (activeTicket?.status ?? "").toLowerCase() === "closed";

  useEffect(() => {
    setReadMap(loadReadMap());
  }, []);

  const loadTickets = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setListError(json?.error ?? "Не удалось загрузить обращения");
        setTickets([]);
        return;
      }
      setTickets(Array.isArray(json.tickets) ? json.tickets : []);
    } catch {
      setListError("Ошибка сети");
      setTickets([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadTickets();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [loadTickets]);

  useEffect(() => {
    setPendingAttachments([]);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [activeTicketId]);

  useEffect(() => {
    if (!activeTicketId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }
    let mounted = true;
    setMessagesLoading(true);
    setChatError(null);
    (async () => {
      try {
        const res = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok || !json?.success) {
          setChatError(json?.error ?? "Не удалось загрузить сообщения");
          setMessages([]);
          return;
        }
        setMessages(Array.isArray(json.messages) ? json.messages : []);
      } catch {
        if (mounted) {
          setChatError("Ошибка сети");
          setMessages([]);
        }
      } finally {
        if (mounted) setMessagesLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeTicketId]);

  useEffect(() => {
    if (!activeTicketId || !activeTicket) return;
    markTicketReadInStorage(activeTicketId, activeTicket.updated_at);
    setReadMap(loadReadMap());
  }, [activeTicketId, activeTicket?.updated_at, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTicketId, messagesLoading]);

  useEffect(() => {
    const html = document.documentElement;
    const releaseBody = acquireBodyScrollLock();
    const prevHtml = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      releaseBody();
    };
  }, []);

  function selectTicket(t: Ticket) {
    setActiveTicketId(t.id);
    markTicketReadInStorage(t.id, t.updated_at);
    setReadMap(loadReadMap());
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setMobileView("chat");
    }
  }

  function onCreatedTicket(ticketId: string) {
    void loadTickets().then(() => {
      setActiveTicketId(ticketId);
      setMobileView("chat");
      markTicketReadInStorage(ticketId, new Date().toISOString());
      setReadMap(loadReadMap());
    });
  }

  async function submitReply(e?: React.FormEvent) {
    e?.preventDefault();
    const text = reply.trim();
    const hasAtt = pendingAttachments.length > 0;
    if (!canSupport || !activeTicketId || (!text && !hasAtt) || replyBusy || isClosed) return;
    setReplyBusy(true);
    setChatError(null);
    try {
      const res = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          attachments: pendingAttachments.map((a) => ({
            path: a.path,
            name: a.name,
            size: a.size,
            content_type: a.content_type,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setChatError(json?.error ?? "Не удалось отправить сообщение");
        return;
      }
      setReply("");
      setPendingAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const after = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/messages`, {
        cache: "no-store",
      });
      const afterJson = await after.json();
      setMessages(Array.isArray(afterJson?.messages) ? afterJson.messages : []);
      await loadTickets();
    } catch {
      setChatError("Ошибка сети");
    } finally {
      setReplyBusy(false);
    }
  }

  async function onFilesSelected(files: FileList | null) {
    if (!canSupport || !activeTicketId || isClosed || !files?.length) return;
    setAttachError(null);
    const list = Array.from(files);
    const room = MAX_ATTACHMENTS - pendingAttachments.length;
    if (room <= 0) {
      setAttachError(`Не более ${MAX_ATTACHMENTS} файлов за сообщение`);
      return;
    }
    const toAdd = list.slice(0, room);
    if (list.length > room) {
      setAttachError(`Добавлено ${room} из ${list.length}: лимит ${MAX_ATTACHMENTS} файлов`);
    }
    setAttachBusy(true);
    try {
      const next: StoredAttachment[] = [...pendingAttachments];
      for (const file of toAdd) {
        if (file.size > MAX_BYTES) {
          setAttachError(`«${file.name}» больше 10 МБ`);
          continue;
        }
        if (!clientFileAllowed(file)) {
          setAttachError(`Тип файла не поддерживается: ${file.name}`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicketId)}/upload`, {
          method: "POST",
          body: fd,
        });
        const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string; file?: StoredAttachment } | null;
        if (!res.ok || !json?.success || !json.file?.path) {
          setAttachError(json?.error ?? "Не удалось загрузить файл");
          continue;
        }
        next.push({
          path: json.file.path,
          name: json.file.name,
          size: json.file.size,
          content_type: json.file.content_type,
        });
      }
      setPendingAttachments(next);
    } catch {
      setAttachError("Ошибка сети при загрузке");
    } finally {
      setAttachBusy(false);
    }
  }

  function removePending(path: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.path !== path));
  }

  function onReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = reply.trim();
      if (text || pendingAttachments.length > 0) void submitReply();
    }
  }

  const unreadCount = useMemo(
    () => tickets.filter((t) => ticketHasUnreadSupport(t, readMap)).length,
    [tickets, readMap]
  );

  return (
    <div
      data-support-chat-layout="support_chat_sticky_panels_v1"
      className="flex min-h-0 w-full min-w-0 flex-1 flex-col self-stretch overflow-hidden bg-[#0b0b10]"
    >
      <header className="shrink-0 border-b border-white/[0.08] bg-[rgba(10,12,18,0.4)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Поддержка</h1>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-white/55 sm:text-sm">
              Создавайте обращения и общайтесь с командой поддержки в одном окне
            </p>
          </div>
          <button
            type="button"
            disabled={!canSupport}
            onClick={() => setNewModalOpen(true)}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-gradient-to-b from-sky-500/18 to-sky-700/10 px-4 text-sm font-semibold text-white transition hover:border-sky-400/35 hover:from-sky-500/22 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Новое обращение
            {unreadCount > 0 ? (
              <span className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white/90">
                {unreadCount}
              </span>
            ) : null}
          </button>
        </div>
        {listError ? <p className="mt-2 text-sm text-red-300/95">{listError}</p> : null}
        {!canSupport ? (
          <p className="mt-2 text-sm text-amber-200/85">Обращения в поддержку недоступны в текущем режиме подписки.</p>
        ) : null}
      </header>

      <div className="flex min-h-0 w-full min-w-0 flex-1 basis-0 flex-col overflow-hidden md:flex-row">
        <aside
          className={`flex min-h-0 w-full flex-col overflow-hidden border-white/[0.06] md:w-[320px] md:max-w-[320px] md:shrink-0 md:basis-[320px] md:border-r ${
            mobileView === "chat" ? "hidden md:flex" : "flex min-h-0 flex-1 md:flex-none"
          }`}
        >
          <div className="shrink-0 border-b border-white/[0.06] px-4 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">Мои обращения</span>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4"
            aria-label="Список обращений"
          >
            <div className="space-y-2">
              {listLoading ? (
                <>
                  <TicketRowSkeleton />
                  <TicketRowSkeleton />
                  <TicketRowSkeleton />
                </>
              ) : null}
              {!listLoading && tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-10 text-center">
                  <div
                    className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.04] text-xl"
                    aria-hidden
                  >
                    💬
                  </div>
                  <h2 className="text-base font-bold text-white/95">Обращений пока нет</h2>
                  <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-white/55 sm:text-sm">
                    Создайте первое обращение, если нужна помощь с настройкой, интеграциями или аналитикой
                  </p>
                  <button
                    type="button"
                    disabled={!canSupport}
                    onClick={() => setNewModalOpen(true)}
                    className="mt-5 h-10 rounded-xl border border-sky-500/30 bg-gradient-to-b from-sky-500/18 to-sky-700/10 px-5 text-sm font-semibold text-white transition hover:border-sky-400/35 disabled:opacity-45"
                  >
                    Создать обращение
                  </button>
                </div>
              ) : null}
              {!listLoading &&
                tickets.map((t) => {
                  const unread = ticketHasUnreadSupport(t, readMap);
                  const active = t.id === activeTicketId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => selectTicket(t)}
                      className={`w-full rounded-xl border p-3.5 text-left transition ${
                        active
                          ? "border-sky-500/35 bg-sky-500/[0.08] ring-1 ring-sky-400/15"
                          : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white/95">
                              #{t.ticket_no ?? "—"}{" "}
                              <span className="font-semibold">{t.subject}</span>
                            </span>
                            {unread ? (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-sky-400/90 ring-2 ring-sky-400/20"
                                title="Новый ответ"
                              />
                            ) : null}
                          </div>
                          {t.last_message ? (
                            <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-white/50">{t.last_message}</p>
                          ) : (
                            <p className="mt-1.5 text-xs italic text-white/35">Нет сообщений</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(t.status)}`}
                        >
                          {statusLabel(t.status)}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityBadgeClass(t.priority)}`}
                        >
                          {priorityLabel(t.priority)}
                        </span>
                        <span className="ml-auto text-[11px] text-white/40">{formatRelativeRu(t.updated_at)}</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </aside>

        <section
          className={`flex min-h-0 w-full min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-[#0c0d12] ${
            mobileView === "list" ? "hidden md:flex" : "flex"
          }`}
          aria-label="Чат поддержки"
        >
          {mobileView === "chat" ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-3 py-2.5 md:hidden">
              <button
                type="button"
                onClick={() => setMobileView("list")}
                className="rounded-lg border border-white/12 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white/85"
              >
                ← К обращениям
              </button>
            </div>
          ) : null}

          {!activeTicket ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-6 text-center">
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl opacity-90"
                aria-hidden
              >
                📩
              </div>
              <h2 className="text-lg font-bold text-white/90">Выберите обращение</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/50">
                Здесь откроется переписка с командой поддержки
              </p>
            </div>
          ) : (
            <div className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-3xl flex-1 flex-col overflow-hidden border-white/[0.06] md:border-l md:basis-0">
              {/* A: шапка тикета — flex shrink-0, не в зоне scroll сообщений */}
              <div className="shrink-0 border-b border-white/[0.06] bg-[#12141a]/80 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold leading-snug text-white sm:text-[17px]">
                    <span className="mr-2 font-mono text-xs text-white/40">#{activeTicket.ticket_no ?? "—"}</span>
                    {activeTicket.subject}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(activeTicket.status)}`}
                    >
                      {statusLabel(activeTicket.status)}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityBadgeClass(activeTicket.priority)}`}
                    >
                      {priorityLabel(activeTicket.priority)}
                    </span>
                    <span className="text-[11px] text-white/38">
                      Создано {formatDateTime(activeTicket.created_at)} · {formatRelativeRu(activeTicket.updated_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* B: только здесь вертикальный scroll истории */}
              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[#12141a]/40 px-4 py-4 sm:px-5"
                role="log"
                aria-live="polite"
                aria-relevant="additions"
              >
                {messagesLoading ? (
                  <div className="space-y-4">
                    <ChatBubbleSkeleton align="left" />
                    <ChatBubbleSkeleton align="right" />
                    <ChatBubbleSkeleton align="left" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex min-h-[12rem] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
                    <p className="text-sm font-medium text-white/70">Сообщений пока нет</p>
                    <p className="mt-2 max-w-[280px] text-xs leading-relaxed text-white/42">
                      Напишите первое сообщение по этому обращению
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {messages.map((m) => {
                      const mine = isUserRole(m.sender_role);
                      return (
                        <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`flex max-w-[min(70%,420px)] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}
                          >
                            <div
                              className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                                mine
                                  ? "rounded-br-md border border-sky-500/25 bg-gradient-to-b from-sky-600/28 to-sky-900/20 text-white"
                                  : "rounded-bl-md border border-white/[0.1] bg-white/[0.06] text-white/90"
                              }`}
                            >
                              <div className="whitespace-pre-wrap break-words">{m.body}</div>
                              {m.attachments && m.attachments.length > 0 ? (
                                <ul className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs">
                                  {m.attachments.map((a, idx) => (
                                    <li key={`${m.id}-att-${idx}-${a.name}`}>
                                      <a
                                        href={a.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sky-300/95 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-200"
                                      >
                                        {a.name}
                                      </a>
                                      <span className="ml-1.5 text-white/40">({formatFileSize(a.size)})</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                            <div
                              className={`flex items-center gap-1.5 px-0.5 text-[10px] text-white/38 ${mine ? "flex-row-reverse" : ""}`}
                            >
                              <span className="font-medium">{mine ? "Вы" : "Поддержка"}</span>
                              <span aria-hidden>·</span>
                              <time dateTime={m.created_at}>{formatMessageTime(m.created_at)}</time>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
                {chatError ? <p className="mt-4 text-center text-sm text-red-300/90">{chatError}</p> : null}
              </div>

              {/* C: composer — flex shrink-0, всегда внизу колонки чата */}
              <div className="shrink-0 border-t border-white/[0.06] bg-[#12141a] px-3 py-3 sm:px-4">
                {isClosed ? (
                  <p className="mb-3 text-center text-xs text-white/45">Обращение закрыто — новые сообщения недоступны.</p>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,application/zip,.zip"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    void onFilesSelected(e.target.files);
                    e.target.value = "";
                  }}
                />
                {pendingAttachments.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {pendingAttachments.map((a) => (
                      <span
                        key={a.path}
                        className="inline-flex max-w-full items-center gap-1 rounded-lg border border-white/12 bg-white/[0.06] py-1 pl-2 pr-1 text-[11px] text-white/80"
                      >
                        <span className="truncate" title={a.name}>
                          {a.name}
                        </span>
                        <span className="shrink-0 text-white/40">{formatFileSize(a.size)}</span>
                        <button
                          type="button"
                          disabled={!canSupport || replyBusy || attachBusy || isClosed}
                          onClick={() => removePending(a.path)}
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-white/45 hover:bg-white/10 hover:text-white/80 disabled:opacity-40"
                          aria-label={`Убрать ${a.name}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {attachError ? <p className="mb-2 text-center text-xs text-amber-200/85">{attachError}</p> : null}
                <div className="flex items-end gap-2 sm:gap-3">
                  <button
                    type="button"
                    disabled={
                      !canSupport ||
                      replyBusy ||
                      attachBusy ||
                      isClosed ||
                      pendingAttachments.length >= MAX_ATTACHMENTS
                    }
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.05] px-2.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-38 sm:px-3 sm:text-sm"
                    title={`Прикрепить файл (до ${MAX_ATTACHMENTS}, до 10 МБ): изображения, PDF, TXT, ZIP`}
                    aria-label={`Прикрепить файл, не более ${MAX_ATTACHMENTS}, до 10 мегабайт`}
                  >
                    <span className="hidden sm:inline">Прикрепить</span>
                    <span className="sm:hidden" aria-hidden>
                      📎
                    </span>
                  </button>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={onReplyKeyDown}
                    placeholder="Напишите сообщение…"
                    disabled={!canSupport || replyBusy || isClosed}
                    rows={1}
                    className={`min-h-10 max-h-36 flex-1 resize-y rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2.5 text-sm leading-snug text-white placeholder:text-white/32 ${inputFocusClass} disabled:opacity-45`}
                  />
                  <button
                    type="button"
                    disabled={
                      !canSupport ||
                      replyBusy ||
                      attachBusy ||
                      isClosed ||
                      (!reply.trim() && pendingAttachments.length === 0)
                    }
                    aria-busy={replyBusy}
                    onClick={() => void submitReply()}
                    className="inline-flex h-10 min-w-[108px] shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-gradient-to-b from-sky-500/18 to-sky-700/10 px-3 text-sm font-semibold text-white transition hover:border-sky-400/38 disabled:cursor-not-allowed disabled:opacity-38"
                  >
                    {replyBusy ? (
                      <span className="text-xs">Отправка…</span>
                    ) : attachBusy ? (
                      <span className="text-xs">Загрузка…</span>
                    ) : (
                      "Отправить"
                    )}
                  </button>
                </div>
                <p className="mt-2 text-center text-[10px] text-white/32">
                  Enter — отправить · Shift+Enter — новая строка · до {MAX_ATTACHMENTS} файлов по 10 МБ
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <NewTicketModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        canSupport={canSupport}
        onCreated={onCreatedTicket}
      />
    </div>
  );
}
