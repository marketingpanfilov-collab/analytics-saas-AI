"use client";

import { useCallback, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { EffectivePlan } from "@/app/lib/accessState";
import { useAppMainPaneRef } from "./AppMainPaneRefContext";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import { useBillingPricingModalRequest } from "./BillingPricingModalProvider";

/** Сайдбар в `(with-sidebar)/layout` — для fallback центра карточки до измерения `<main>`. */
const APP_SIDEBAR_WIDTH_PX = 260;

export type PlanRestrictedTier = Exclude<EffectivePlan, null>;

export type PlanRestrictedOverlayProps = {
  allowedPlans: readonly PlanRestrictedTier[];
  message: string;
  children: React.ReactNode;
  /** Идентификатор для контекста открытия модалки тарифов */
  upgradeSource?: string;
  /** Лимит квоты (напр. weekly report), не связанный с allowedPlans */
  quotaExhausted?: boolean;
  /** Текст карточки при quotaExhausted (иначе используется message) */
  quotaMessage?: string;
};

type PaneBox = { top: number; left: number; width: number; height: number };

function normalizeEffectivePlan(raw: string | null | undefined): PlanRestrictedTier | null {
  if (raw == null || typeof raw !== "string") return null;
  const p = raw.trim().toLowerCase();
  if (p === "starter" || p === "growth" || p === "scale") return p;
  return null;
}

/**
 * Мягкое ограничение: при плане вне `allowedPlans` контент страницы получает blur-sm + opacity.
 * Карточка CTA — отдельный fixed-слой (центр по горизонтали в колонке main, ~43vh по вертикали viewport),
 * не скроллится с контентом; прокрутка main не блокируется (pointer-events-none на обёртке).
 */
export default function PlanRestrictedOverlay({
  allowedPlans,
  message,
  children,
  upgradeSource = "plan_restricted_overlay",
  quotaExhausted = false,
  quotaMessage,
}: PlanRestrictedOverlayProps) {
  const { bootstrap, loading: bootstrapLoading } = useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  const router = useRouter();
  const mainPaneRef = useAppMainPaneRef();
  const [paneBox, setPaneBox] = useState<PaneBox | null>(null);

  const allowed = useMemo(() => new Set<string>(allowedPlans), [allowedPlans]);
  const effective = normalizeEffectivePlan(bootstrap?.effective_plan ?? undefined);
  const restrictedByPlan =
    !bootstrapLoading && effective !== null && !allowed.has(effective);
  const restricted = restrictedByPlan || quotaExhausted;
  const cardCopy =
    quotaExhausted && quotaMessage && quotaMessage.length > 0 ? quotaMessage : message;

  useLayoutEffect(() => {
    if (!restricted) {
      setPaneBox(null);
      return;
    }
    const el = mainPaneRef?.current;
    if (!el) {
      setPaneBox(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setPaneBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [restricted, mainPaneRef]);

  const onUpgrade = useCallback(() => {
    const opened = requestBillingPricingModal(upgradeSource, { force: true });
    if (!opened) router.push("/app/settings");
  }, [requestBillingPricingModal, router, upgradeSource]);

  const card = (
    <div
      className="pointer-events-auto max-w-md shrink-0 rounded-2xl border border-white/10 bg-[#12121a]/95 px-6 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      role="region"
      aria-label="Ограничение по тарифу"
    >
      <p className="text-[15px] leading-relaxed text-white/90">{cardCopy}</p>
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-6 w-full cursor-pointer rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
      >
        Обновить тариф
      </button>
    </div>
  );

  const cardPositionStyle: CSSProperties =
    paneBox != null && paneBox.width >= 1
      ? {
          left: paneBox.left + paneBox.width / 2,
          top: "43vh",
          transform: "translate(-50%, -50%)",
        }
      : {
          left: `calc(${APP_SIDEBAR_WIDTH_PX}px + (100vw - ${APP_SIDEBAR_WIDTH_PX}px) / 2)`,
          top: "43vh",
          transform: "translate(-50%, -50%)",
        };

  return (
    <div className="relative isolate min-h-full w-full">
      <div
        className={
          restricted
            ? "pointer-events-none select-none blur-sm opacity-60 transition-[filter,opacity] duration-200"
            : undefined
        }
        aria-hidden={restricted}
      >
        {children}
      </div>
      {restricted ? (
        <div className="pointer-events-none fixed z-[40]" style={cardPositionStyle}>
          {card}
        </div>
      ) : null}
    </div>
  );
}
