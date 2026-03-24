"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/components/landing/BaseButton";
import {
  PARTNERSHIP_COLLABORATION_OPTIONS,
  type PartnershipCollaborationId,
} from "@/app/lib/landing/partnershipTypes";

const inputClass =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/28";

type PartnershipLeadContextValue = {
  open: () => void;
  close: () => void;
};

const PartnershipLeadContext = createContext<PartnershipLeadContextValue | null>(null);

export function usePartnershipLead() {
  const ctx = useContext(PartnershipLeadContext);
  if (!ctx) {
    throw new Error("usePartnershipLead must be used within PartnershipLeadProvider");
  }
  return ctx;
}

const partnershipNavClass =
  "cursor-pointer rounded-md px-1 py-0.5 text-sm font-semibold !text-white/65 transition-colors duration-200 ease-out hover:!text-white hover:[text-shadow:0_0_20px_rgba(255,255,255,0.45),0_0_36px_rgba(200,230,255,0.2)]";

/** Кнопка «Партнёрам»: на лендинге с провайдером открывает попап; иначе — ссылка на главную #partnership */
export function PartnershipNavButton({ className }: { className?: string }) {
  const ctx = useContext(PartnershipLeadContext);
  if (!ctx) {
    return (
      <Link href="/#partnership" className={cn(partnershipNavClass, className)}>
        Партнёрам
      </Link>
    );
  }
  return (
    <button type="button" onClick={ctx.open} className={cn(partnershipNavClass, className)}>
      Партнёрам
    </button>
  );
}

const PARTNERSHIP_MODAL_ANIM_MS = 320;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function PartnershipModal({
  onCloseComplete,
  onRegisterClose,
}: {
  onCloseComplete: () => void;
  onRegisterClose: (fn: () => void) => void;
}) {
  const titleId = useId();
  const reduced = usePrefersReducedMotion();
  const animMs = reduced ? 0 : PARTNERSHIP_MODAL_ANIM_MS;
  const [visible, setVisible] = useState(false);

  const runClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(onCloseComplete, animMs);
  }, [onCloseComplete, animMs]);

  useEffect(() => {
    onRegisterClose(runClose);
    return () => onRegisterClose(() => {});
  }, [onRegisterClose, runClose]);

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [collaborationType, setCollaborationType] = useState<PartnershipCollaborationId>("product_sales");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") runClose();
    };
    document.addEventListener("keydown", onKey);

    // Фиксируем body с сохранением scrollY, чтобы при открытии модалки не было скачка страницы к верху.
    // Дополнительно компенсируем ширину скроллбара, чтобы избежать сдвига контента.
    const html = document.documentElement;
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
    const scrollY = window.scrollY;

    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyWidth = document.body.style.width;
    const prevHtmlScrollBehavior = html.style.scrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const fixedHeaders = Array.from(document.querySelectorAll<HTMLElement>("header")).filter(
      (el) => getComputedStyle(el).position === "fixed"
    );
    const headerPrevPadding = fixedHeaders.map((h) => h.style.paddingRight);
    if (scrollbarWidth > 0) {
      fixedHeaders.forEach((h) => {
        h.style.paddingRight = `${scrollbarWidth}px`;
      });
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.paddingRight = prevBodyPaddingRight;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.width = prevBodyWidth;
      html.style.scrollBehavior = "auto";
      window.scrollTo(0, scrollY);
      requestAnimationFrame(() => {
        html.style.scrollBehavior = prevHtmlScrollBehavior;
      });
      fixedHeaders.forEach((h, i) => {
        h.style.paddingRight = headerPrevPadding[i] ?? "";
      });
    };
  }, [runClose]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/landing/partnership-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          company,
          website,
          email,
          phone,
          collaborationType,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          name_required: "Укажите имя.",
          company_required: "Укажите компанию.",
          website_required: "Укажите сайт.",
          email_invalid: "Проверьте формат email.",
          phone_required: "Укажите телефон.",
          collaboration_required: "Выберите вид сотрудничества.",
          collaboration_invalid: "Выберите вид сотрудничества из списка.",
          smtp_not_configured: "Не удалось отправить заявку. Напишите нам на marketing.panfilov@gmail.com",
          send_failed: "Не удалось отправить заявку. Напишите нам на marketing.panfilov@gmail.com",
        };
        setMsg({
          kind: "err",
          text: map[data.error ?? ""] ?? "Не удалось отправить заявку. Напишите нам на marketing.panfilov@gmail.com",
        });
        return;
      }

      setMsg({
        kind: "ok",
        text: "Заявка отправлена. В ближайшее время мы свяжемся с вами.",
      });
      setName("");
      setCompany("");
      setWebsite("");
      setEmail("");
      setPhone("");
      setCollaborationType("product_sales");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (msg?.kind !== "ok") return;
    const t = window.setTimeout(() => runClose(), 3200);
    return () => window.clearTimeout(t);
  }, [msg, runClose]);

  const transitionCls = reduced ? "" : "duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4 py-[20px]"
      role="presentation"
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 cursor-pointer bg-black/70 backdrop-blur-sm transition-opacity",
          transitionCls,
          visible ? "opacity-100" : "opacity-0"
        )}
        aria-label="Закрыть"
        onClick={runClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "scrollbar-hidden relative z-10 flex w-full max-w-lg flex-col overflow-y-auto overscroll-y-contain rounded-2xl border border-white/10 bg-[#0f0f14] shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.06] will-change-transform [-webkit-overflow-scrolling:touch]",
          "max-h-[calc(100svh-40px)]",
          "px-8 pb-10 pt-9 md:px-12 md:pb-12 md:pt-10",
          "transition-[opacity,transform]",
          transitionCls,
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0 pr-2">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight text-white md:text-2xl">
              Хотите сотрудничать с нами?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/58 md:mt-3.5">
              Оставьте контактные данные — мы обязательно свяжемся с вами в ближайшее время.
            </p>
          </div>
          <button
            type="button"
            onClick={runClose}
            className="shrink-0 cursor-pointer rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Закрыть окно"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-8 flex flex-col gap-5 md:mt-10 md:gap-6"
        >
          <div>
            <label htmlFor="partner-collab" className="block text-sm font-medium text-zinc-300">
              Вид сотрудничества
            </label>
            <select
              id="partner-collab"
              name="collaborationType"
              required
              value={collaborationType}
              onChange={(e) => setCollaborationType(e.target.value as PartnershipCollaborationId)}
              disabled={loading}
              className={cn(inputClass, "cursor-pointer appearance-none bg-[#0f0f14] pr-10")}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 0.75rem center",
                backgroundSize: "1.25rem",
              }}
            >
              {PARTNERSHIP_COLLABORATION_OPTIONS.map((o) => (
                <option key={o.id} value={o.id} className="bg-[#0f0f14] text-white">
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="partner-name-m" className="block text-sm font-medium text-zinc-300">
                Имя
              </label>
              <input
                id="partner-name-m"
                name="name"
                required
                autoComplete="name"
                className={inputClass}
                placeholder="Иван Иванов"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="partner-company-m" className="block text-sm font-medium text-zinc-300">
                Компания
              </label>
              <input
                id="partner-company-m"
                name="company"
                required
                autoComplete="organization"
                className={inputClass}
                placeholder="ООО «Агентство»"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label htmlFor="partner-website-m" className="block text-sm font-medium text-zinc-300">
              Сайт
            </label>
            <input
              id="partner-website-m"
              name="website"
              type="text"
              required
              inputMode="url"
              autoComplete="url"
              className={inputClass}
              placeholder="https://example.com или домен"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="partner-email-m" className="block text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id="partner-email-m"
                name="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="partner-phone-m" className="block text-sm font-medium text-zinc-300">
                Телефон
              </label>
              <input
                id="partner-phone-m"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                className={inputClass}
                placeholder="+7 700 000 00 00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {msg ? (
            <p
              className={cn(
                "rounded-xl border px-4 py-3 text-sm",
                msg.kind === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              )}
            >
              {msg.text}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-8 flex h-12 w-full shrink-0 cursor-pointer items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/[0.18] text-sm font-extrabold text-white shadow-[0_10px_30px_rgba(16,185,129,0.16)] transition hover:bg-emerald-500/[0.28] disabled:cursor-not-allowed disabled:opacity-50 md:mt-9"
          >
            {loading ? "Отправка…" : "Отправить заявку"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function PartnershipLeadProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<() => void>(() => {});

  const openModal = useCallback(() => setMounted(true), []);
  const closeModal = useCallback(() => {
    closeRef.current?.();
  }, []);

  const value = useMemo(
    () => ({
      open: openModal,
      close: closeModal,
    }),
    [openModal, closeModal]
  );

  return (
    <PartnershipLeadContext.Provider value={value}>
      {children}
      {mounted ? (
        <PartnershipModal
          onCloseComplete={() => setMounted(false)}
          onRegisterClose={(fn) => {
            closeRef.current = fn;
          }}
        />
      ) : null}
    </PartnershipLeadContext.Provider>
  );
}
