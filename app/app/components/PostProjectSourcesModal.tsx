"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

export type PostProjectOnboardingSignals = {
  hydrated: boolean;
  hasAdAccounts: boolean;
  hasSiteEvents: boolean;
  hasRedirectLinks: boolean;
};

type Props = {
  projectId: string;
  open: boolean;
  onDismiss: () => void;
  signals?: PostProjectOnboardingSignals;
};

const stepRowBase =
  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] sm:text-xs";

function ProgressIcon({ done, loading }: { done: boolean; loading: boolean }) {
  const box = "flex h-4 w-4 shrink-0 items-center justify-center";
  if (loading) {
    return <span className={`${box} animate-pulse rounded-full bg-white/15`} aria-hidden />;
  }
  if (done) {
    return (
      <span
        className={`${box} rounded-full border border-emerald-400/55 bg-emerald-500/25 text-emerald-200`}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5" aria-hidden>
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`${box} rounded-full border border-white/22 bg-transparent`}
      aria-hidden
    >
      <span className="block h-[5px] w-[5px] shrink-0 rounded-full bg-white/45" />
    </span>
  );
}

function ProgressPill({
  label,
  done,
  loading,
}: {
  label: string;
  done: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className={`${stepRowBase} border-white/10 bg-white/[0.04] text-white/40`}>
        <ProgressIcon done={false} loading />
        <span className="truncate">{label}</span>
      </div>
    );
  }
  return (
    <div
      className={`${stepRowBase} ${
        done
          ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100/95"
          : "border-white/12 bg-white/[0.04] text-white/55"
      }`}
    >
      <ProgressIcon done={done} loading={false} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function StepCardSkeleton() {
  return (
    <div className="flex min-h-[148px] flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:min-h-[160px]">
      <div className="mb-3 h-4 w-2/3 animate-pulse rounded-md bg-white/10" />
      <div className="mb-2 h-3 w-full animate-pulse rounded bg-white/[0.06]" />
      <div className="mb-auto h-3 w-4/5 animate-pulse rounded bg-white/[0.05]" />
      <div className="mt-4 h-9 w-full animate-pulse rounded-xl bg-white/10" />
    </div>
  );
}

type StepDef = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

export default function PostProjectSourcesModal({ projectId, open, onDismiss, signals }: Props) {
  const [mounted, setMounted] = useState(false);
  const [localSignals, setLocalSignals] = useState<PostProjectOnboardingSignals | null>(null);
  const [enter, setEnter] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setEnter(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEnter(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setLocalSignals(null);
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    if (signals?.hydrated) {
      setLocalSignals(null);
      return;
    }
    const ac = new AbortController();
    (async () => {
      let hasAdAccounts = false;
      let hasSiteEvents = false;
      let hasRedirectLinks = false;
      try {
        const [aRes, iRes, rRes, tRes] = await Promise.all([
          fetch(`/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}`, {
            cache: "no-store",
            signal: ac.signal,
          }),
          fetch(`/api/oauth/integration/status?project_id=${encodeURIComponent(projectId)}`, {
            cache: "no-store",
            signal: ac.signal,
          }),
          fetch(`/api/redirect-links?project_id=${encodeURIComponent(projectId)}`, {
            cache: "no-store",
            signal: ac.signal,
          }),
          fetch(`/api/tracking/source/status?site_id=${encodeURIComponent(projectId)}`, {
            cache: "no-store",
            signal: ac.signal,
          }),
        ]);
        if (aRes.ok) {
          const j = (await aRes.json()) as { accounts?: unknown[] };
          hasAdAccounts = Array.isArray(j?.accounts) && j.accounts.length > 0;
        }
        if (!hasAdAccounts && iRes.ok) {
          const j = (await iRes.json()) as {
            integrations?: Array<{ connected?: boolean; enabled_accounts?: number }>;
          };
          const list = Array.isArray(j?.integrations) ? j.integrations : [];
          hasAdAccounts = list.some((x) => x.connected === true && Number(x.enabled_accounts ?? 0) > 0);
        }
        if (rRes.ok) {
          const j = (await rRes.json()) as { items?: unknown[] };
          hasRedirectLinks = Array.isArray(j?.items) && j.items.length > 0;
        }
        if (tRes.ok) {
          const j = (await tRes.json()) as { hasEvents?: boolean };
          if (j?.hasEvents === true) hasSiteEvents = true;
        }
      } catch {
        /* ignore */
      }
      if (!ac.signal.aborted) {
        setLocalSignals({
          hydrated: true,
          hasAdAccounts,
          hasSiteEvents,
          hasRedirectLinks,
        });
      }
    })();
    return () => ac.abort();
  }, [open, projectId, signals?.hydrated]);

  const effective = signals?.hydrated
    ? signals
    : localSignals?.hydrated
      ? localSignals
      : null;
  const loading = open && effective == null;

  const steps = useMemo((): StepDef[] => {
    const qs = `?project_id=${encodeURIComponent(projectId)}`;
    const hasAd = effective?.hasAdAccounts ?? false;
    const hasSite = effective?.hasSiteEvents ?? false;
    const hasLinks = effective?.hasRedirectLinks ?? false;
    return [
      {
        key: "ads",
        title: "Рекламные кабинеты",
        description: "Meta / Google / TikTok",
        href: `/app/accounts${qs}`,
        cta: "Подключить",
        done: hasAd,
      },
      {
        key: "sales",
        title: "Источники продаж",
        description: "CRM / сайт / Pixel",
        href: `/app/pixels${qs}`,
        cta: "Подключить",
        done: hasSite,
      },
      {
        key: "track",
        title: "Tracking",
        description: "UTM / ссылки",
        href: `/app/utm-builder${qs}`,
        cta: "Создать ссылку",
        done: hasLinks,
      },
    ];
  }, [effective, projectId]);

  const startHref = useMemo(() => {
    const qs = `?project_id=${encodeURIComponent(projectId)}`;
    if (!effective) return `/app/accounts${qs}`;
    if (!effective.hasAdAccounts) return `/app/accounts${qs}`;
    if (!effective.hasSiteEvents) return `/app/pixels${qs}`;
    if (!effective.hasRedirectLinks) return `/app/utm-builder${qs}`;
    return `/app/accounts${qs}`;
  }, [effective, projectId]);

  if (!open || !mounted || typeof document === "undefined") return null;

  const cardShell =
    "group relative flex min-h-[148px] flex-col rounded-2xl border border-white/[0.12] bg-white/[0.04] p-4 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] outline-none transition-all duration-200 sm:min-h-[168px] " +
    "hover:-translate-y-0.5 hover:scale-[1.02] hover:border-sky-400/35 hover:bg-white/[0.07] hover:shadow-[0_12px_40px_-8px_rgba(56,189,248,0.22),0_0_0_1px_rgba(125,211,252,0.12)_inset] " +
    "focus-visible:ring-2 focus-visible:ring-sky-400/50 active:scale-[0.99]";

  const panelStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    boxSizing: "border-box",
    background:
      "radial-gradient(ellipse 90% 70% at 50% -10%, rgba(59, 130, 246, 0.22), transparent 52%), radial-gradient(ellipse 70% 50% at 100% 100%, rgba(16, 185, 129, 0.12), transparent 45%), rgba(6, 8, 14, 0.88)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    opacity: enter ? 1 : 0,
    transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  const modalGlow: CSSProperties = {
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.06) inset, 0 24px 80px rgba(0,0,0,0.55), 0 0 100px -20px rgba(59, 130, 246, 0.25)",
    opacity: enter ? 1 : 0,
    transform: enter ? "scale(1)" : "scale(0.96)",
    transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-project-onboarding-title"
      style={panelStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className="relative w-full max-w-[920px] max-h-[min(92vh,820px)] overflow-y-auto rounded-[22px] border border-white/[0.14] bg-[rgba(14,16,24,0.72)] px-5 py-6 sm:px-8 sm:py-8"
        style={modalGlow}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-[22px] opacity-90"
          style={{
            background:
              "radial-gradient(ellipse 120% 80% at 20% 0%, rgba(96, 165, 250, 0.12), transparent 50%), radial-gradient(ellipse 80% 60% at 100% 20%, rgba(52, 211, 153, 0.08), transparent 48%)",
          }}
          aria-hidden
        />
        <div className="relative">
          <h2
            id="post-project-onboarding-title"
            className="text-[22px] font-black tracking-tight text-white sm:text-2xl"
            style={{ letterSpacing: "-0.03em" }}
          >
            Аналитика почти готова
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65 sm:text-[15px]">
            Подключите источники и настройте отслеживание, чтобы видеть реальные продажи и вклад каналов
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2 sm:gap-3">
            <ProgressPill label="Кабинеты" done={!!effective?.hasAdAccounts} loading={loading} />
            <ProgressPill label="Источники продаж" done={!!effective?.hasSiteEvents} loading={loading} />
            <ProgressPill label="Tracking" done={!!effective?.hasRedirectLinks} loading={loading} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
            {loading
              ? [0, 1, 2].map((i) => <StepCardSkeleton key={i} />)
              : steps.map((s) => (
                  <Link
                    key={s.key}
                    href={s.href}
                    className={cardShell}
                    onClick={onDismiss}
                    aria-label={`${s.title}: ${s.cta}`}
                  >
                    {s.done ? (
                      <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 text-xs font-bold text-emerald-200">
                        ✓
                      </span>
                    ) : null}
                    <div className="pr-7 text-[15px] font-bold text-white/95">{s.title}</div>
                    <div className="mt-1 text-xs leading-snug text-white/50 sm:text-[13px]">{s.description}</div>
                    <span className="mt-auto inline-flex w-fit items-center justify-center rounded-xl border border-sky-400/40 bg-gradient-to-b from-sky-400/25 to-sky-500/10 px-3 py-2 text-xs font-bold text-sky-100 transition group-hover:border-sky-300/55 group-hover:from-sky-400/35 sm:text-[13px]">
                      {s.cta}
                    </span>
                  </Link>
                ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={startHref}
              className="inline-flex w-full items-center justify-center rounded-xl border border-sky-400/50 bg-gradient-to-b from-sky-400/30 to-sky-600/20 px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_36px_-6px_rgba(56,189,248,0.35)] transition hover:scale-[1.02] hover:border-sky-300/60 hover:shadow-[0_16px_44px_-6px_rgba(56,189,248,0.45)] sm:w-auto sm:min-w-[200px]"
              onClick={onDismiss}
            >
              Начать настройку
            </Link>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full py-2 text-center text-[13px] font-semibold text-white/40 transition hover:text-white/65 sm:w-auto sm:px-4"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
