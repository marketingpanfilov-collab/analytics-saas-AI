"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PRICING_PLAN_IDS,
  type PricingPlanId,
} from "@/app/lib/auth/loginPurchaseUrl";
import {
  BILLING_PLAN_LABELS,
  BILLING_YEARLY_DISCOUNT_PERCENT,
  billingYearlySavingsUsd,
  defaultInlinePlanId,
  formatBillingPriceLabel,
  INLINE_PLAN_TAGLINE,
  recommendedInlinePlanId,
} from "@/app/lib/billingPlanDisplay";
import {
  BILLING_OVER_LIMIT_UPGRADE_GRACE_MS,
  broadcastBillingBootstrapInvalidate,
  clearBillingRouteStorage,
  isBillingBlocking,
  isBootstrapResponseValid,
  resolvePostPaymentRedirect,
  storeOriginRoute,
  validateBillingReturnPath,
  writeLastKnownBootstrap,
  type BillingBootstrapApiOk,
} from "@/app/lib/billingBootstrapClient";
import {
  newCheckoutAttemptId,
  persistCheckoutAttemptForSession,
  readCheckoutAttemptIdForTracing,
} from "@/app/lib/billingCheckoutAttempt";
import { emitBillingFunnelEvent } from "@/app/lib/billingFunnelAnalytics";
import {
  BILLING_SOFT_PAYMENT_DETAIL,
  BILLING_SOFT_PAYMENT_HEADLINE,
  markPaymentWebhookGrace,
} from "@/app/lib/billingPaymentWebhookGrace";
import {
  postBillingReconcileLatestCheckout,
  type ReconcileLatestCheckoutJson,
} from "@/app/lib/billingReconcileClient";
import { waitUntilPostPaymentUnblocked } from "@/app/lib/billingPostPaymentPoll";
import {
  billingPayloadFromResolved,
  emitBillingCjmEvent,
} from "@/app/lib/billingCjmAnalytics";
import {
  canUpgradeFromSlice,
  canUpgradeTo,
  readPaddleUpgradeSource,
  readSubscriptionUiSlice,
  readSubscriptionUpgradeSlice,
} from "@/app/lib/billingUpgradeClient";
import { BILLING_CHECKOUT_MISSING_ORG_MESSAGE } from "@/app/lib/billing/billingCheckoutMessages";
import { openPaddleSubscriptionCheckout } from "@/app/lib/paddleCheckoutClient";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";
import { supabase } from "@/app/lib/supabaseClient";
import type { ResolvedUiStateV1 } from "@/app/lib/billingUiContract";
import {
  parseBootstrapBillingPeriod,
  parseBootstrapPlanId,
} from "@/app/lib/subscriptionUpgradeEligibility";
import {
  OverLimitViolationEmptyHint,
  OverLimitViolationLines,
  remedialOverLimitBannerLead,
  remedialOverLimitBannerTitle,
  type OverLimitDetailRow,
} from "@/app/lib/billingOverLimitDetails";
import { getPlanFeatureMatrix, type PlanFeatureMatrix } from "@/app/lib/planConfig";
import { useBillingBootstrap } from "./BillingBootstrapProvider";

/** Сервер может ответить 202, пока другой инстанс выполняет apply с тем же idempotency_key. */
const APPLY_IN_PROGRESS_MAX_RETRIES = 24;
const APPLY_IN_PROGRESS_DELAY_MS = 500;

function billingPollDebug(
  message: string,
  data: { attempt?: number; blocking?: boolean; stop?: string }
): void {
  const enabled =
    (typeof process !== "undefined" && process.env.NODE_ENV === "development") ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BILLING_DEBUG === "1");
  if (enabled) console.debug(`[billing_post_payment] ${message}`, data);
}

function billingUpgradeClientLog(message: string, data?: Record<string, unknown>): void {
  const enabled =
    (typeof process !== "undefined" && process.env.NODE_ENV === "development") ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BILLING_DEBUG === "1");
  if (enabled) console.info(`[billing_upgrade_client] ${message}`, data ?? "");
}

type Props = {
  disabled?: boolean;
  suggestPlan?: PricingPlanId | null;
  compact?: boolean;
  showComparisonLink?: boolean;
  projectId?: string | null;
  onAfterCheckoutCompleted?: () => void;
  /**
   * Экран превышения лимита: текущий тариф — неактивная карточка с подписью «Ваш текущий тариф»;
   * выше по лестнице — отдельные кнопки «Оплатить …» без общего CTA и без строки «Текущий: …».
   */
  variant?: "default" | "over_limit";
  /** Широкая модалка: сетка 3×1, CTA внизу каждой карточки. Без флага — прежняя сетка и одна кнопка оплаты. */
  widePlanGrid?: boolean;
  /**
   * Источник открытия модалки из BillingPricingModalProvider (`requestBillingPricingModal(source)`).
   * Например `over_limit_remedial_banner` — контекст баннера на remedial-страницах.
   */
  pricingModalEntrySource?: string | null;
  /** В BillingShellGate детали лимита уже выше блока тарифов — не дублировать текст и список нарушений. */
  suppressOverLimitShellDupes?: boolean;
  /** Полноэкранный paywall в BillingShellGate: без заголовка «Тариф», строки «Текущий», «Кратко» и ссылки на политику возврата. */
  subscribeShellMinimal?: boolean;
};

function planTier(id: PricingPlanId): number {
  if (id === "starter") return 0;
  if (id === "growth") return 1;
  return 2;
}

function randomApplyIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatSeatsLimitLine(n: number | null): string {
  if (n == null) return "неограниченно";
  if (n === 1) return "1 участник";
  return `до ${n} участников`;
}

function formatProjectsLimitLine(n: number | null): string {
  if (n == null) return "неограниченно";
  if (n === 1) return "1 проект";
  return `до ${n} проектов`;
}

function formatAdsLimitLine(n: number | null): string {
  if (n == null) return "неограниченно";
  if (n === 1) return "1 рекламный аккаунт";
  return `до ${n} рекламных аккаунтов`;
}

export default function BillingInlinePricing({
  disabled = false,
  suggestPlan = null,
  compact = false,
  showComparisonLink = true,
  projectId = null,
  onAfterCheckoutCompleted,
  variant = "default",
  widePlanGrid = false,
  pricingModalEntrySource = null,
  suppressOverLimitShellDupes = false,
  subscribeShellMinimal = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const currentAppPath = useMemo(() => {
    const q = searchParams.toString();
    return q ? `${pathname}?${q}` : pathname;
  }, [pathname, searchParams]);

  const {
    bootstrap,
    reloadBootstrap,
    resolvedUi,
    overLimitApplyGraceUntilMs,
    setOverLimitApplyGraceUntilMs,
    relaxOverLimitForPendingWebhook,
    setRelaxOverLimitForPendingWebhook,
  } = useBillingBootstrap();
  const [billing, setBilling] = useState<BillingPeriod>(() => {
    const serverBilling = parseBootstrapBillingPeriod(bootstrap?.subscription?.billing_period);
    return serverBilling === "monthly" || serverBilling === "yearly" ? serverBilling : "yearly";
  });
  /** Пользователь менял период вручную — не затирать toggle при первой загрузке subscription. */
  const billingPeriodTouchedByUserRef = useRef(false);
  const lastServerBillingPeriodRef = useRef<string | undefined>(undefined);
  const [selectedPlan, setSelectedPlan] = useState<PricingPlanId>("growth");
  const [sessionEmail, setSessionEmail] = useState<string>("");
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [pwCustomerId, setPwCustomerId] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [paymentIncomplete, setPaymentIncomplete] = useState(false);
  const [postPaymentPolling, setPostPaymentPolling] = useState(false);
  const [postPaymentStuck, setPostPaymentStuck] = useState(false);
  const [postPaymentReconcileBusy, setPostPaymentReconcileBusy] = useState(false);
  const [postPaymentReconcileHint, setPostPaymentReconcileHint] = useState<string | null>(null);
  const postPaymentStartedRef = useRef(false);
  const postPaymentGenRef = useRef(0);
  const applyUpgradeInFlightRef = useRef(false);
  const optimisticSubscriptionRef = useRef<null | { plan: PricingPlanId; billing: BillingPeriod }>(null);
  const preApplyPaddleRef = useRef<null | { plan: PricingPlanId; billing: BillingPeriod }>(null);
  const overLimitGraceUntilRef = useRef<number | null>(null);
  const relaxPendingWebhookRef = useRef(false);
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const [subscriptionUpgradeApplying, setSubscriptionUpgradeApplying] = useState(false);
  const [billingToast, setBillingToast] = useState<null | { text: string }>(null);
  const [optimisticSubscription, setOptimisticSubscription] = useState<null | {
    plan: PricingPlanId;
    billing: BillingPeriod;
  }>(null);
  const [upgradeDraft, setUpgradeDraft] = useState<null | {
    targetPlan: PricingPlanId;
    targetBilling: BillingPeriod;
    /** На момент превью подписка была помесячной (для подсказки при переходе на год). */
    sourceMonthly: boolean;
    api: {
      preview: {
        current_label: string;
        target_label: string;
        currency_code: string | null;
        due_now: string | null;
        credit_label: string | null;
        next_recurring_hint: string | null;
        update_summary: unknown;
      };
    };
  }>(null);

  useEffect(() => {
    optimisticSubscriptionRef.current = optimisticSubscription;
  }, [optimisticSubscription]);

  useEffect(() => {
    overLimitGraceUntilRef.current = overLimitApplyGraceUntilMs;
  }, [overLimitApplyGraceUntilMs]);

  useEffect(() => {
    relaxPendingWebhookRef.current = relaxOverLimitForPendingWebhook;
  }, [relaxOverLimitForPendingWebhook]);

  const billingBlockingOpts = useMemo(
    () => ({ overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook }),
    [overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook]
  );

  useEffect(() => {
    if (!billingToast) return;
    const t = window.setTimeout(() => setBillingToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [billingToast]);

  const matrixPlan = bootstrap?.plan_feature_matrix?.plan;
  const recommendedPlanId = useMemo(() => recommendedInlinePlanId(matrixPlan), [matrixPlan]);
  const isOverLimit = variant === "over_limit";
  /** Модалка «Повысить тариф» с remedial-баннера — отдельная полировка UI, не fullscreen shell. */
  const remedialOverLimitModal = pricingModalEntrySource === "over_limit_remedial_banner";
  /** Единый шаг по вертикали в remedial-модалке (заголовок → текст → период → сетка → подписи). */
  const remedialModalVGap = 24;

  const overLimitDetailsNormalized = useMemo((): OverLimitDetailRow[] => {
    const d = resolvedUi?.over_limit_details;
    if (!Array.isArray(d)) return [];
    const out: OverLimitDetailRow[] = [];
    for (const r of d) {
      if (
        !r ||
        (r.type !== "projects" && r.type !== "seats" && r.type !== "ad_accounts") ||
        typeof r.current !== "number" ||
        typeof r.limit !== "number"
      )
        continue;
      out.push({ type: r.type, current: r.current, limit: r.limit });
    }
    return out;
  }, [resolvedUi?.over_limit_details]);

  const subscriptionForUi = useMemo((): BillingBootstrapApiOk["subscription"] => {
    const s = bootstrap?.subscription;
    if (!s) return null;
    if (!optimisticSubscription) return s;
    return {
      ...s,
      plan: optimisticSubscription.plan,
      billing_period: optimisticSubscription.billing,
    };
  }, [bootstrap?.subscription, optimisticSubscription]);

  const paddleSrc = useMemo(
    () => readPaddleUpgradeSource(subscriptionForUi ?? null, bootstrap, billing),
    [subscriptionForUi, bootstrap, billing]
  );

  const subscriptionUpgradeSlice = useMemo(
    () => readSubscriptionUpgradeSlice(subscriptionForUi ?? null, bootstrap, billing),
    [subscriptionForUi, bootstrap, billing]
  );

  const subscriptionUiSlice = useMemo(
    () => readSubscriptionUiSlice(subscriptionForUi ?? null, bootstrap, billing),
    [subscriptionForUi, bootstrap, billing]
  );

  /**
   * Период оплаты по подписке: с сервера; если интервал unknown — тот же источник, что и «текущая» карточка
   * (включая подстановку из тоггла), чтобы не было «Год на витрине» и «Оплата: раз в месяц» одновременно.
   */
  const realBilling: BillingPeriod = useMemo(() => {
    const bp = parseBootstrapBillingPeriod(subscriptionForUi?.billing_period);
    if (bp === "monthly" || bp === "yearly") return bp;
    if (subscriptionUiSlice) return subscriptionUiSlice.billing;
    return billing;
  }, [subscriptionForUi?.billing_period, subscriptionUiSlice, billing]);

  /** Режим отображения цен на карточках тарифов (Месяц / Год). */
  const displayBilling = billing;

  useEffect(() => {
    const raw = subscriptionForUi?.billing_period;
    const serverBilling = parseBootstrapBillingPeriod(raw);
    if (serverBilling !== "monthly" && serverBilling !== "yearly") return;

    const prevRaw = lastServerBillingPeriodRef.current;

    if (!billingPeriodTouchedByUserRef.current) {
      if (prevRaw === raw) return;
      lastServerBillingPeriodRef.current = raw;
      setBilling(serverBilling);
      return;
    }

    const serverChanged = prevRaw !== undefined && prevRaw !== raw;
    if (serverChanged) {
      lastServerBillingPeriodRef.current = raw;
      setBilling(serverBilling);
    } else if (prevRaw === undefined) {
      lastServerBillingPeriodRef.current = raw;
    }
  }, [subscriptionForUi?.billing_period]);

  const currentPlanId = useMemo((): PricingPlanId => {
    if (optimisticSubscription) return optimisticSubscription.plan;
    if (matrixPlan === "starter" || matrixPlan === "growth" || matrixPlan === "scale") return matrixPlan;
    const sub = String(bootstrap?.subscription?.plan ?? "")
      .trim()
      .toLowerCase();
    if (sub === "starter" || sub === "growth" || sub === "scale") return sub as PricingPlanId;
    return "starter";
  }, [matrixPlan, bootstrap?.subscription?.plan, optimisticSubscription]);

  const upgradePlanIds = useMemo(() => {
    const t = planTier(currentPlanId);
    return PRICING_PLAN_IDS.filter((id) => planTier(id) > t);
  }, [currentPlanId]);

  const upgradePayBlocked = useCallback(
    (planId: PricingPlanId) => {
      if (paddleSrc) return !canUpgradeTo(paddleSrc, planId, billing);
      if (subscriptionUiSlice) return !canUpgradeFromSlice(subscriptionUiSlice, planId, billing);
      return false;
    },
    [paddleSrc, subscriptionUiSlice, billing]
  );

  useEffect(() => {
    setUpgradeDraft(null);
  }, [billing, selectedPlan]);

  const planSummary = useMemo(() => {
    const st = subscriptionForUi?.status;
    const pl = subscriptionForUi?.plan;
    const parts: string[] = [];
    if (pl) parts.push(String(pl));
    if (st) parts.push(String(st));
    return parts.length ? parts.join(" · ") : "—";
  }, [subscriptionForUi?.plan, subscriptionForUi?.status, optimisticSubscription]);

  const [hoverUpgrade, setHoverUpgrade] = useState<PricingPlanId | null>(null);

  useEffect(() => {
    return () => {
      postPaymentGenRef.current += 1;
    };
  }, []);

  const reconcileOptimisticWithBootstrapSnapshot = useCallback(
    (sub: NonNullable<BillingBootstrapApiOk["subscription"]>) => {
      const opt = optimisticSubscriptionRef.current;
      if (!opt) return;
      const p = parseBootstrapPlanId(sub.plan);
      const b = parseBootstrapBillingPeriod(sub.billing_period);
      if (p === "unknown" || b === "unknown") return;
      if (p === opt.plan && b === opt.billing) {
        setOptimisticSubscription(null);
        preApplyPaddleRef.current = null;
        setOverLimitApplyGraceUntilMs(null);
        setRelaxOverLimitForPendingWebhook(false);
        relaxPendingWebhookRef.current = false;
        return;
      }
      const pre = preApplyPaddleRef.current;
      if (pre && p === pre.plan && b === pre.billing) return;
      setOptimisticSubscription({ plan: p, billing: b });
      preApplyPaddleRef.current = null;
      setOverLimitApplyGraceUntilMs(null);
      setRelaxOverLimitForPendingWebhook(false);
      relaxPendingWebhookRef.current = false;
    },
    [setOverLimitApplyGraceUntilMs, setRelaxOverLimitForPendingWebhook]
  );

  const finishUnlockedNavigation = useCallback(
    async (freshResolved: ResolvedUiStateV1) => {
      const rawTarget = resolvePostPaymentRedirect(freshResolved, {
        currentPath: currentAppPath,
        billingBlockingOptions: {
          overLimitApplyGraceUntilMs: overLimitGraceUntilRef.current,
          relaxOverLimitForPendingWebhook: relaxPendingWebhookRef.current,
        },
      });
      setOverLimitApplyGraceUntilMs(null);
      overLimitGraceUntilRef.current = null;
      setRelaxOverLimitForPendingWebhook(false);
      relaxPendingWebhookRef.current = false;
      setOptimisticSubscription(null);
      preApplyPaddleRef.current = null;
      setPostPaymentPolling(false);
      setPostPaymentStuck(false);
      postPaymentStartedRef.current = false;
      let target = validateBillingReturnPath(rawTarget);
      if (!target) target = validateBillingReturnPath("/app/projects");
      if (!target) target = "/app";
      clearBillingRouteStorage();
      const cur = validateBillingReturnPath(currentAppPath);
      if (cur && target === cur) {
        onAfterCheckoutCompleted?.();
        return;
      }
      router.push(target);
      onAfterCheckoutCompleted?.();
    },
    [
      currentAppPath,
      onAfterCheckoutCompleted,
      router,
      setOverLimitApplyGraceUntilMs,
      setRelaxOverLimitForPendingWebhook,
    ]
  );

  const runPostPaymentPollingLoop = useCallback(
    (generation: number) => {
      void (async () => {
        const pack = await waitUntilPostPaymentUnblocked({
          reload: reloadBootstrap,
          billingBlockingOptions: billingBlockingOpts,
          isCancelled: () => postPaymentGenRef.current !== generation,
          onTick: ({ attempt, blocking }) => billingPollDebug("tick", { attempt, blocking }),
        });
        if (postPaymentGenRef.current !== generation) return;
        const fresh = pack.resolved;
        if (pack.bootstrap?.subscription) {
          reconcileOptimisticWithBootstrapSnapshot(pack.bootstrap.subscription);
        }
        const blocking = fresh ? isBillingBlocking(fresh, billingBlockingOpts) : true;
        if (fresh && !blocking) {
          billingPollDebug("stop", { stop: "unlock" });
          emitBillingFunnelEvent("billing_access_unblocked", {
            checkout_attempt_id: readCheckoutAttemptIdForTracing(),
            organization_id: pack.bootstrap?.primary_org_id ?? null,
            user_id: sessionUserId,
            plan: pack.bootstrap?.subscription?.plan ?? pack.bootstrap?.plan_feature_matrix?.plan ?? null,
            billing_period: pack.bootstrap?.subscription?.billing_period ?? null,
            source: "in_app",
          });
          await finishUnlockedNavigation(fresh);
          return;
        }
        billingPollDebug("stop", { stop: blocking ? "still_blocking" : "no_resolved" });
        emitBillingFunnelEvent("billing_checkout_stuck_timeout", {
          checkout_attempt_id: readCheckoutAttemptIdForTracing(),
          organization_id: bootstrap?.primary_org_id ?? null,
          user_id: sessionUserId,
          plan: bootstrap?.subscription?.plan ?? bootstrap?.plan_feature_matrix?.plan ?? null,
          billing_period: bootstrap?.subscription?.billing_period ?? null,
          source: "in_app",
        });
        setPostPaymentStuck(true);
      })();
    },
    [
      billingBlockingOpts,
      finishUnlockedNavigation,
      reloadBootstrap,
      reconcileOptimisticWithBootstrapSnapshot,
      sessionUserId,
    ]
  );

  const onManualRefreshStatus = useCallback(async () => {
    if (manualRefreshBusy) return;
    setManualRefreshBusy(true);
    try {
      const pack = await reloadBootstrap();
      if (pack.bootstrap?.subscription) {
        reconcileOptimisticWithBootstrapSnapshot(pack.bootstrap.subscription);
      }
      const fresh = pack.resolved;
      if (fresh && !isBillingBlocking(fresh, billingBlockingOpts)) await finishUnlockedNavigation(fresh);
    } finally {
      setManualRefreshBusy(false);
    }
  }, [
    billingBlockingOpts,
    finishUnlockedNavigation,
    manualRefreshBusy,
    reloadBootstrap,
    reconcileOptimisticWithBootstrapSnapshot,
  ]);

  useEffect(() => {
    if (suggestPlan && PRICING_PLAN_IDS.includes(suggestPlan)) {
      setSelectedPlan(suggestPlan);
      return;
    }
    setSelectedPlan(defaultInlinePlanId(matrixPlan));
  }, [suggestPlan, matrixPlan]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setSessionEmail((data.user?.email ?? "").trim());
      setSessionUserId(data.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/billing/current-customer", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; customer_id?: string | null };
        if (cancelled) return;
        const id = json?.success ? json.customer_id ?? null : null;
        setPwCustomerId(id && id.startsWith("ctm_") ? id : null);
      } catch {
        if (!cancelled) setPwCustomerId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startCheckoutForPlan = useCallback(
    async (plan: PricingPlanId) => {
      if (disabled || checkoutBusy) return;
      postPaymentGenRef.current += 1;
      postPaymentStartedRef.current = false;
      setPostPaymentPolling(false);
      setPostPaymentStuck(false);
      setPostPaymentReconcileHint(null);
      setCheckoutError(null);
      setPaymentIncomplete(false);
      const email = sessionEmail.trim();
      if (!email) {
        setCheckoutError("Не удалось определить email сессии.");
        return;
      }
      let primaryOrgId = (bootstrap?.primary_org_id ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(primaryOrgId)) {
        const provRes = await fetch("/api/billing/provision-checkout-organization", {
          method: "POST",
          credentials: "include",
        });
        const provBody = (await provRes.json().catch(() => null)) as {
          success?: boolean;
          organization_id?: string;
          error?: string;
        } | null;
        if (!provRes.ok || !provBody?.success || !provBody.organization_id) {
          setPreparingCheckout(false);
          setCheckoutBusy(false);
          setCheckoutError(
            provBody?.error ??
              `${BILLING_CHECKOUT_MISSING_ORG_MESSAGE} Попробуйте обновить страницу.`
          );
          return;
        }
        primaryOrgId = String(provBody.organization_id).trim();
        const pack = await reloadBootstrap();
        const refreshed = (pack.bootstrap?.primary_org_id ?? "").trim();
        if (/^[0-9a-f-]{36}$/i.test(refreshed)) {
          primaryOrgId = refreshed;
        }
      }
      if (!/^[0-9a-f-]{36}$/i.test(primaryOrgId)) {
        setPreparingCheckout(false);
        setCheckoutBusy(false);
        setCheckoutError(`${BILLING_CHECKOUT_MISSING_ORG_MESSAGE} Попробуйте обновить страницу.`);
        return;
      }
      const canOpenPaddlePreview =
        (paddleSrc && canUpgradeTo(paddleSrc, plan, billing)) ||
        Boolean(
          subscriptionUpgradeSlice && canUpgradeFromSlice(subscriptionUpgradeSlice, plan, billing)
        );

      if (canOpenPaddlePreview) {
        postPaymentGenRef.current += 1;
        postPaymentStartedRef.current = false;
        setPostPaymentPolling(false);
        setPostPaymentStuck(false);
        setPaymentIncomplete(false);
        setCheckoutError(null);
        setCheckoutBusy(true);
        setPreparingCheckout(true);
        try {
          const res = await fetch("/api/billing/subscription-upgrade/preview", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target_plan: plan,
              target_billing: billing,
              ...(projectId ? { project_id: projectId } : {}),
              ...(bootstrap?.primary_org_id
                ? { primary_org_id: bootstrap.primary_org_id }
                : {}),
              ...(bootstrap?.subscription?.provider_subscription_id
                ? {
                    provider_subscription_id: String(
                      bootstrap.subscription.provider_subscription_id
                    ),
                  }
                : {}),
            }),
          });
          const j = (await res.json()) as {
            success?: boolean;
            error?: string;
            preview?: {
              current_label: string;
              target_label: string;
              currency_code: string | null;
              due_now: string | null;
              credit_label?: string | null;
              next_recurring_hint: string | null;
              update_summary: unknown;
            };
          };
          if (!res.ok || !j.success || !j.preview) {
            billingUpgradeClientLog("preview_error", { status: res.status, error: j.error });
            setCheckoutError(
              typeof j.error === "string" ? j.error : "Не удалось получить расчёт апгрейда от Paddle."
            );
            return;
          }
          billingUpgradeClientLog("preview_ok", { plan, billing });
          const pv = j.preview;
          setUpgradeDraft({
            targetPlan: plan,
            targetBilling: billing,
            sourceMonthly:
              paddleSrc?.billing === "monthly" ||
              (!paddleSrc && subscriptionUpgradeSlice?.billing === "monthly"),
            api: {
              preview: {
                ...pv,
                credit_label: pv.credit_label ?? null,
              },
            },
          });
          emitBillingCjmEvent(
            "checkout_opened",
            billingPayloadFromResolved(resolvedUi, {
              plan,
              userId: sessionUserId,
              source_action: "paddle_subscription_upgrade_preview",
            })
          );
        } catch (e) {
          setCheckoutError(e instanceof Error ? e.message : "Ошибка сети");
        } finally {
          setPreparingCheckout(false);
          setCheckoutBusy(false);
        }
        return;
      }
      setCheckoutBusy(true);
      setPreparingCheckout(true);
      try {
        storeOriginRoute(currentAppPath || pathname);
        const checkoutAttemptId = newCheckoutAttemptId();
        persistCheckoutAttemptForSession(checkoutAttemptId);
        const r = await openPaddleSubscriptionCheckout({
          plan,
          billing,
          email,
          userId: sessionUserId,
          pwCustomerId,
          primaryOrgId,
          projectId,
          checkoutAttemptId,
          onCompleted: () => {
            if (postPaymentStartedRef.current) return;
            postPaymentStartedRef.current = true;
            setPreparingCheckout(false);
            setCheckoutBusy(false);
            setPaymentIncomplete(false);
            setPostPaymentPolling(true);
            setPostPaymentStuck(false);
            setPostPaymentReconcileHint(null);
            markPaymentWebhookGrace({ checkoutAttemptId, source: "in_app" });
            broadcastBillingBootstrapInvalidate();
            emitBillingFunnelEvent("billing_checkout_completed_client", {
              checkout_attempt_id: checkoutAttemptId,
              organization_id: primaryOrgId,
              user_id: sessionUserId,
              plan,
              billing_period: billing,
              source: "in_app",
            });
            emitBillingCjmEvent(
              "checkout_success",
              billingPayloadFromResolved(resolvedUi, {
                plan,
                userId: sessionUserId,
                source_action: "checkout_completed",
              })
            );
            const gen = postPaymentGenRef.current;
            runPostPaymentPollingLoop(gen);
          },
          onAborted: () => {
            setPreparingCheckout(false);
            setCheckoutBusy(false);
            setPaymentIncomplete(true);
            setPostPaymentPolling(false);
            emitBillingCjmEvent(
              "checkout_cancel",
              billingPayloadFromResolved(resolvedUi, {
                plan,
                userId: sessionUserId,
                source_action: "checkout_aborted",
              })
            );
          },
        });
        setPreparingCheckout(false);
        if (!r.ok) {
          setCheckoutError(r.error);
          setCheckoutBusy(false);
        } else {
          emitBillingFunnelEvent("billing_checkout_opened", {
            checkout_attempt_id: checkoutAttemptId,
            organization_id: primaryOrgId,
            user_id: sessionUserId,
            plan,
            billing_period: billing,
            source: "in_app",
          });
          emitBillingCjmEvent(
            "checkout_opened",
            billingPayloadFromResolved(resolvedUi, {
              plan,
              userId: sessionUserId,
              source_action: "paddle_checkout_open",
            })
          );
        }
      } catch (e) {
        setPreparingCheckout(false);
        setCheckoutError(e instanceof Error ? e.message : "Ошибка оплаты");
        setCheckoutBusy(false);
      }
    },
    [
      disabled,
      checkoutBusy,
      sessionEmail,
      sessionUserId,
      billing,
      pwCustomerId,
      resolvedUi,
      bootstrap?.primary_org_id,
      bootstrap?.subscription?.provider_subscription_id,
      reloadBootstrap,
      projectId,
      currentAppPath,
      pathname,
      runPostPaymentPollingLoop,
      paddleSrc,
      subscriptionUpgradeSlice,
    ]
  );

  const confirmSubscriptionUpgrade = useCallback(async () => {
    if (!upgradeDraft || disabled || subscriptionUpgradeApplying) return;
    if (applyUpgradeInFlightRef.current) return;
    applyUpgradeInFlightRef.current = true;
    setCheckoutError(null);
    setSubscriptionUpgradeApplying(true);
    try {
      const idempotencyKey = randomApplyIdempotencyKey();
      billingUpgradeClientLog("apply_request", {
        target_plan: upgradeDraft.targetPlan,
        target_billing: upgradeDraft.targetBilling,
        idempotency_key: idempotencyKey,
      });
      let res: Response;
      let j: {
        success?: boolean;
        error?: string;
        payment_failed?: boolean;
        apply_status?: string;
      };
      for (let inProgressAttempt = 0; ; inProgressAttempt++) {
        res = await fetch("/api/billing/subscription-upgrade/apply", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_plan: upgradeDraft.targetPlan,
            target_billing: upgradeDraft.targetBilling,
            idempotency_key: idempotencyKey,
            ...(projectId ? { project_id: projectId } : {}),
            ...(bootstrap?.primary_org_id
              ? { primary_org_id: bootstrap.primary_org_id }
              : {}),
            ...(bootstrap?.subscription?.provider_subscription_id
              ? {
                  provider_subscription_id: String(
                    bootstrap.subscription.provider_subscription_id
                  ),
                }
              : {}),
          }),
        });
        j = (await res.json()) as typeof j;
        if (res.status === 202 && j.apply_status === "in_progress") {
          if (inProgressAttempt >= APPLY_IN_PROGRESS_MAX_RETRIES) {
            setCheckoutError(
              "Обновление подписки всё ещё выполняется. Обновите статус на баннере или повторите через минуту."
            );
            return;
          }
          await new Promise((r) => setTimeout(r, APPLY_IN_PROGRESS_DELAY_MS));
          continue;
        }
        break;
      }
      if (!res.ok || !j.success) {
        const paymentFailed = j.payment_failed !== false;
        billingUpgradeClientLog("apply_error", {
          status: res.status,
          payment_failed: paymentFailed,
          error: typeof j.error === "string" ? j.error.slice(0, 200) : null,
        });
        const fallbackPayment =
          "Оплата не прошла или подписка не изменена. Проверьте способ оплаты в Paddle и попробуйте снова.";
        const fallbackConfig =
          "Техническая ошибка конфигурации биллинга. Обратитесь в поддержку или попробуйте позже.";
        let msg: string;
        if (typeof j.error === "string" && j.error.trim()) {
          msg = j.error;
        } else {
          msg = paymentFailed ? fallbackPayment : fallbackConfig;
        }
        setCheckoutError(msg);
        return;
      }
      billingUpgradeClientLog("apply_ok", { plan: upgradeDraft.targetPlan });
      preApplyPaddleRef.current = paddleSrc
        ? { plan: paddleSrc.plan, billing: paddleSrc.billing }
        : subscriptionUpgradeSlice
          ? { plan: subscriptionUpgradeSlice.plan, billing: subscriptionUpgradeSlice.billing }
          : null;
      const appliedPlan = upgradeDraft.targetPlan;
      const graceUntil = Date.now() + BILLING_OVER_LIMIT_UPGRADE_GRACE_MS;
      setOverLimitApplyGraceUntilMs(graceUntil);
      overLimitGraceUntilRef.current = graceUntil;
      setRelaxOverLimitForPendingWebhook(true);
      relaxPendingWebhookRef.current = true;
      setOptimisticSubscription({
        plan: upgradeDraft.targetPlan,
        billing: upgradeDraft.targetBilling,
      });
      setUpgradeDraft(null);
      setBillingToast({ text: "Тариф обновлён" });
      if (postPaymentStartedRef.current) return;
      postPaymentStartedRef.current = true;
      setPostPaymentPolling(true);
      setPostPaymentStuck(false);
      broadcastBillingBootstrapInvalidate();
      emitBillingCjmEvent(
        "checkout_success",
        billingPayloadFromResolved(resolvedUi, {
          plan: appliedPlan,
          userId: sessionUserId,
          source_action: "paddle_subscription_upgrade_applied",
        })
      );
      const gen = postPaymentGenRef.current;
      runPostPaymentPollingLoop(gen);
    } catch (e) {
      billingUpgradeClientLog("apply_network_error", { message: e instanceof Error ? e.message : String(e) });
      setCheckoutError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      applyUpgradeInFlightRef.current = false;
      setSubscriptionUpgradeApplying(false);
    }
  }, [
    upgradeDraft,
    disabled,
    subscriptionUpgradeApplying,
    paddleSrc,
    subscriptionUpgradeSlice,
    projectId,
    bootstrap?.primary_org_id,
    bootstrap?.subscription?.provider_subscription_id,
    resolvedUi,
    sessionUserId,
    runPostPaymentPollingLoop,
    setOverLimitApplyGraceUntilMs,
    setRelaxOverLimitForPendingWebhook,
  ]);

  const startCheckout = useCallback(() => {
    void startCheckoutForPlan(selectedPlan);
  }, [startCheckoutForPlan, selectedPlan]);

  const controlsLocked = disabled || checkoutBusy || postPaymentPolling || subscriptionUpgradeApplying;
  const gap = compact ? 8 : subscribeShellMinimal ? 18 : 12;
  const pad = compact ? "10px 12px" : subscribeShellMinimal ? "16px 18px" : "12px 14px";
  const periodSegMinH = 40;
  const overLimitPaySlotMinPx = 42;
  const pricingGridTemplateColumns = compact
    ? "1fr"
    : isOverLimit
      ? `repeat(${Math.max(1, 1 + upgradePlanIds.length)}, minmax(0, 1fr))`
      : widePlanGrid
        ? "repeat(3, minmax(0, 1fr))"
        : subscribeShellMinimal
          ? "repeat(auto-fit, minmax(200px, 1fr))"
          : "repeat(auto-fill, minmax(148px, 1fr))";
  /** Широкая сетка для модалки подписки / смены тарифа: на мобиле — колонка, с `sm` — три равные. */
  const useWideDefaultGrid = Boolean(widePlanGrid) && !compact && !isOverLimit;
  /** Чуть крупнее типографика в широкой модалке и на экране over-limit. */
  const fsModal = !compact && (widePlanGrid || isOverLimit);
  /** Вертикальные отступы между блоками в широкой модалке смены тарифа. */
  const wideSectionGap = useWideDefaultGrid ? 34 : gap;
  const wideGridGap = useWideDefaultGrid ? 26 : gap;
  const widePlanCardPad = useWideDefaultGrid ? "26px 22px" : pad;
  const widePayBtnMt = useWideDefaultGrid ? "mt-8" : "mt-4";
  const widePayBtnPad = useWideDefaultGrid ? "0 18px" : "0 14px";

  const matrixForComparison = useMemo((): PlanFeatureMatrix => {
    const m = bootstrap?.plan_feature_matrix;
    if (m && (m.plan === "starter" || m.plan === "growth" || m.plan === "scale")) return m;
    const p = parseBootstrapPlanId(bootstrap?.subscription?.plan);
    if (p === "starter" || p === "growth" || p === "scale") return getPlanFeatureMatrix(p);
    return getPlanFeatureMatrix("unknown");
  }, [bootstrap?.plan_feature_matrix, bootstrap?.subscription?.plan]);

  const renderDueTodayUnderPlan = useCallback((planId: PricingPlanId) => {
    if (!upgradeDraft || upgradeDraft.targetPlan !== planId) return null;
    const raw = upgradeDraft.api.preview.due_now;
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    return (
      <div className="mt-2 text-center text-[11px] leading-snug text-white/70">
        К оплате сегодня: <span className="font-semibold text-white/90">{raw.trim()}</span>
      </div>
    );
  }, [upgradeDraft]);

  const renderUpgradeLimitComparison = useCallback(
    (targetId: PricingPlanId): ReactNode => {
      const tgt = getPlanFeatureMatrix(targetId);
      const cur = matrixForComparison;
      const details = resolvedUi?.over_limit_details;
      const hint = Array.isArray(details) && details.length > 0 ? details[0]?.type : undefined;
      const fs = compact ? 10 : fsModal ? 11 : 10;
      const scaleTarget = targetId === "scale";

      const wrap = (children: ReactNode) => (
        <div
          className="mt-3 space-y-1"
          style={{
            fontSize: fs,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.58)",
          }}
        >
          {children}
        </div>
      );

      if (hint === "projects") {
        const c = cur.max_projects;
        const t = tgt.max_projects;
        if (c != null && t != null && t <= c) return null;
        return wrap(
          <>
            <div>
              Сейчас:{" "}
              <span style={{ color: "rgba(255,255,255,0.92)" }}>{formatProjectsLimitLine(c)}</span>
            </div>
            <div>
              После:{" "}
              <span style={{ color: "rgba(255,255,255,0.92)" }}>
                {scaleTarget || t == null ? "без ограничений" : formatProjectsLimitLine(t)}
              </span>
            </div>
          </>
        );
      }

      if (hint === "ad_accounts") {
        const c = cur.max_ad_accounts;
        const t = tgt.max_ad_accounts;
        if (c != null && t != null && t <= c) return null;
        return wrap(
          <>
            <div>
              Сейчас:{" "}
              <span style={{ color: "rgba(255,255,255,0.92)" }}>{formatAdsLimitLine(c)}</span>
            </div>
            <div>
              После:{" "}
              <span style={{ color: "rgba(255,255,255,0.92)" }}>
                {scaleTarget || t == null ? "без ограничений" : formatAdsLimitLine(t)}
              </span>
            </div>
          </>
        );
      }

      const c = cur.max_seats;
      const t = tgt.max_seats;
      if (c != null && t != null && t <= c && hint !== "seats") return null;
      return wrap(
        <>
          <div>
            Сейчас: <span style={{ color: "rgba(255,255,255,0.92)" }}>{formatSeatsLimitLine(c)}</span>
          </div>
          <div>
            После:{" "}
            <span style={{ color: "rgba(255,255,255,0.92)" }}>
              {scaleTarget || t == null ? "без ограничений" : formatSeatsLimitLine(t)}
            </span>
          </div>
        </>
      );
    },
    [compact, fsModal, matrixForComparison, resolvedUi?.over_limit_details]
  );

  const primaryLabel = (() => {
    if (preparingCheckout) return "Подготовка оплаты…";
    if (checkoutBusy && !preparingCheckout) return "Завершите оплату в окне Paddle…";
    return `Оплатить · ${BILLING_PLAN_LABELS[selectedPlan]}`;
  })();

  const renderModalWidePlanTaglines = (planId: PricingPlanId) => {
    const tagTop = useWideDefaultGrid ? 12 : 6;
    const tagLineGap = useWideDefaultGrid ? 8 : 4;
    if (planId === "growth") {
      return (
        <div
          style={{
            fontSize: compact ? 10 : fsModal ? 11 : 10,
            marginTop: tagTop,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.62)",
          }}
        >
          <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>Идеально для команд</div>
          <div style={{ marginTop: tagLineGap }}>Полный доступ к аналитике</div>
        </div>
      );
    }
    if (planId === "scale") {
      return (
        <div
          style={{
            fontSize: compact ? 10 : fsModal ? 11 : 10,
            marginTop: tagTop,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.58)",
          }}
        >
          <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>Максимум возможностей</div>
          <div style={{ marginTop: tagLineGap }}>Без ограничений по участникам и проектам</div>
        </div>
      );
    }
    return (
      <div
        style={{
          fontSize: compact ? 10 : fsModal ? 11 : 10,
          marginTop: tagTop,
          lineHeight: 1.45,
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {INLINE_PLAN_TAGLINE[planId]}
      </div>
    );
  };

  function renderPeriodPlanHints(
    planId: PricingPlanId,
    savingsMuted: string,
    period: BillingPeriod = displayBilling
  ) {
    const hintSize = compact ? 10 : subscribeShellMinimal ? 11 : fsModal ? 11 : 10;
    if (period === "monthly") {
      return (
        <div
          style={{
            fontSize: hintSize,
            marginTop: 3,
            color: savingsMuted,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          Без скидки
        </div>
      );
    }
    const pct = BILLING_YEARLY_DISCOUNT_PERCENT[planId];
    const save = billingYearlySavingsUsd(planId);
    return (
      <div
        style={{
          fontSize: hintSize,
          marginTop: 3,
          color: "rgba(52,211,153,0.9)",
          fontWeight: 600,
          lineHeight: 1.35,
        }}
      >
        Скидка −{pct}% (Экономия ~{save} $)
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: isOverLimit
          ? 0
          : useWideDefaultGrid
            ? 0
            : compact
              ? 12
              : subscribeShellMinimal
                ? 0
                : 18,
        position: "relative",
      }}
    >
      {billingToast ? (
        <div
          role="status"
          style={{
            position: "absolute",
            top: -6,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5,
            maxWidth: "min(420px, 100%)",
            padding: "10px 16px",
            borderRadius: 10,
            background: "rgba(16,185,129,0.95)",
            color: "#0b0b10",
            fontWeight: 800,
            fontSize: 13,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            pointerEvents: "none",
          }}
        >
          {billingToast.text}
        </div>
      ) : null}
      {useWideDefaultGrid && !isOverLimit ? (
        <div
          style={{
            textAlign: "center",
            padding: "0 52px",
            marginBottom: wideSectionGap,
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.4, color: "white" }}>
            Обновите тариф, чтобы получить больше возможностей
          </div>
          <p className="text-sm text-white/55" style={{ margin: "18px 0 0", lineHeight: 1.55 }}>
            Получите больше данных, расширенные лимиты и полный контроль над аналитикой
          </p>
        </div>
      ) : null}
      {!isOverLimit && !useWideDefaultGrid && !subscribeShellMinimal ? (
        <div
          style={{
            fontSize: compact ? 11 : fsModal ? 13 : 12,
            fontWeight: 700,
            color: "rgba(255,255,255,0.55)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Тариф
        </div>
      ) : null}
      {!isOverLimit && !useWideDefaultGrid && !subscribeShellMinimal ? (
        <>
          <div
            style={{
              fontSize: compact ? 13 : fsModal ? 15 : 14,
              color: "rgba(255,255,255,0.85)",
              marginBottom: subscriptionForUi ? 4 : gap,
            }}
          >
            Текущий: <span style={{ color: "white" }}>{planSummary}</span>
          </div>
          {subscriptionForUi ? (
            <div className="text-xs text-white/50" style={{ marginBottom: gap }}>
              Оплата: {realBilling === "yearly" ? "раз в год" : "раз в месяц"}
            </div>
          ) : null}

          <div style={{ fontSize: compact ? 11 : fsModal ? 12 : 11, color: "rgba(255,255,255,0.5)", marginBottom: gap, lineHeight: 1.45 }}>
            Кратко: Starter — старт; Growth — для роста (рекомендуем большинству); Scale — максимум возможностей.
          </div>
        </>
      ) : null}

      {isOverLimit && !suppressOverLimitShellDupes ? (
        <div
          style={{
            textAlign: "center",
            padding: "0 12px",
            marginBottom: remedialOverLimitModal ? 0 : gap,
            boxSizing: "border-box",
          }}
        >
          {remedialOverLimitModal ? (
            <>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: compact ? 15 : fsModal ? 17 : 16,
                  lineHeight: 1.35,
                  color: "white",
                  textAlign: "center",
                  marginTop: 8,
                  marginBottom: remedialModalVGap,
                }}
              >
                {remedialOverLimitBannerTitle(overLimitDetailsNormalized)}
              </div>
              <div
                style={{
                  marginTop: 0,
                  paddingTop: 20,
                  paddingBottom: 20,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  boxSizing: "border-box",
                }}
              >
                {overLimitDetailsNormalized.length > 0 ? (
                  <OverLimitViolationLines
                    details={overLimitDetailsNormalized}
                    compact={Boolean(compact)}
                    className="mt-0"
                  />
                ) : (
                  <OverLimitViolationEmptyHint compact={Boolean(compact)} className="mt-0" />
                )}
                <p
                  style={{
                    margin: "12px 0 0",
                    fontSize: compact ? 12 : 13,
                    lineHeight: 1.45,
                    color: "rgba(255,255,255,0.72)",
                  }}
                >
                  {remedialOverLimitBannerLead(overLimitDetailsNormalized)}
                </p>
              </div>
            </>
          ) : (
            <>
              {overLimitDetailsNormalized.length > 0 ? (
                <OverLimitViolationLines details={overLimitDetailsNormalized} compact={Boolean(compact)} />
              ) : null}
              <p
                style={{
                  margin: overLimitDetailsNormalized.length > 0 ? "12px 0 0" : 0,
                  fontSize: compact ? 12 : 13,
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                Обновите тариф, чтобы продолжить работу с командой и проектами.
              </p>
            </>
          )}
        </div>
      ) : null}

      <div
        style={{
          marginBottom: remedialOverLimitModal ? remedialModalVGap : useWideDefaultGrid ? wideSectionGap : gap,
          marginTop: useWideDefaultGrid ? 0 : remedialOverLimitModal ? remedialModalVGap : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
          }}
        >
        <div
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 12,
            background: "rgba(255,255,255,0.04)",
            padding: 4,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            boxSizing: "border-box",
          }}
        >
          <button
            type="button"
            disabled={controlsLocked}
            onClick={() => {
              billingPeriodTouchedByUserRef.current = true;
              setBilling("monthly");
            }}
            style={{
              borderRadius: 8,
              border: "none",
              minHeight: periodSegMinH,
              fontSize: fsModal ? 13 : 12,
              fontWeight: 600,
              cursor: controlsLocked ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              background: billing === "monthly" ? "rgba(255,255,255,0.1)" : "transparent",
              color: billing === "monthly" ? "white" : "rgba(255,255,255,0.45)",
            }}
          >
            Месяц
          </button>
          <span style={{ position: "relative", display: "block", minWidth: 0 }}>
            <button
              type="button"
              disabled={controlsLocked}
              onClick={() => {
                billingPeriodTouchedByUserRef.current = true;
                setBilling("yearly");
              }}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "none",
                minHeight: periodSegMinH,
                fontSize: fsModal ? 13 : 12,
                fontWeight: 600,
                cursor: controlsLocked ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                background: billing === "yearly" ? "rgba(255,255,255,0.1)" : "transparent",
                color: billing === "yearly" ? "white" : "rgba(255,255,255,0.45)",
                boxSizing: "border-box",
              }}
            >
              Год
            </button>
            <span
              aria-hidden
              style={{
                pointerEvents: "none",
                position: "absolute",
                right: 0,
                top: 0,
                transform: "translate(28%, -42%)",
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "rgba(16,185,129,0.35)",
                boxShadow: "0 0 0 1px rgba(52,211,129,0.45)",
                fontSize: 11,
                fontWeight: 800,
                color: "rgba(220,255,235,0.95)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              %
            </span>
          </span>
        </div>
        </div>
        <div
          className={`text-center text-xs text-white/40 px-1 ${subscribeShellMinimal ? "mt-3" : "mt-2"} ${remedialOverLimitModal ? "mb-6" : ""}`}
        >
          Цены указаны для выбранного периода
        </div>
      </div>

      <div
        className={useWideDefaultGrid ? "grid w-full grid-cols-1 items-stretch sm:grid-cols-3" : undefined}
        style={
          useWideDefaultGrid
            ? { display: "grid", gap: wideGridGap, marginBottom: wideSectionGap, alignItems: "stretch" }
            : {
                display: "grid",
                gridTemplateColumns: pricingGridTemplateColumns,
                gap: compact ? 8 : subscribeShellMinimal ? 16 : 12,
                marginBottom: remedialOverLimitModal ? remedialModalVGap : gap,
                alignItems: "stretch",
              }
        }
      >
        {isOverLimit ? (
          <>
            <div
              className="flex h-full min-h-0 min-w-0 flex-col"
              style={{
                padding: pad,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
                color: "rgba(255,255,255,0.65)",
                textAlign: "left",
                cursor: "not-allowed",
                opacity: 0.52,
                position: "relative",
                boxSizing: "border-box",
              }}
            >
              <div className="min-w-0 shrink-0">
                <span
                  style={{
                    display: "inline-block",
                    marginBottom: 8,
                    fontSize: compact ? 9 : fsModal ? 10 : 9,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "rgba(255,255,255,0.45)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 6,
                    padding: "2px 6px",
                    background: "rgba(255,255,255,0.06)",
                  }}
                >
                  Ваш текущий тариф
                </span>
                <div style={{ fontWeight: 800, fontSize: compact ? 13 : fsModal ? 15 : 14 }}>
                  {BILLING_PLAN_LABELS[currentPlanId]}
                </div>
                <div style={{ fontSize: compact ? 11 : fsModal ? 13 : 12, marginTop: 4, color: "rgba(255,255,255,0.45)" }}>
                  {formatBillingPriceLabel(currentPlanId, realBilling)}
                </div>
                <div className="mt-1 text-xs text-white/50">
                  Оплата: {realBilling === "yearly" ? "раз в год" : "раз в месяц"}
                </div>
                {renderPeriodPlanHints(currentPlanId, "rgba(255,255,255,0.34)", realBilling)}
                <div
                  style={{
                    fontSize: compact ? 10 : fsModal ? 11 : 10,
                    marginTop: 6,
                    lineHeight: 1.4,
                    color: "rgba(255,255,255,0.38)",
                  }}
                >
                  {INLINE_PLAN_TAGLINE[currentPlanId]}
                </div>
              </div>
              <div className="min-h-0 flex-1 basis-0" aria-hidden />
              {billing === "yearly" &&
              (paddleSrc
                ? canUpgradeTo(paddleSrc, currentPlanId, "yearly") && paddleSrc.billing === "monthly"
                : subscriptionUiSlice
                  ? canUpgradeFromSlice(subscriptionUiSlice, currentPlanId, "yearly") &&
                    subscriptionUiSlice.billing === "monthly"
                  : false) ? (
                <button
                  type="button"
                  className="mt-4 w-full shrink-0"
                  disabled={disabled || checkoutBusy || !sessionEmail || postPaymentPolling}
                  onClick={() => void startCheckoutForPlan(currentPlanId)}
                  style={{
                    minHeight: overLimitPaySlotMinPx,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "none",
                    background:
                      disabled || checkoutBusy || !sessionEmail || postPaymentPolling
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(52,211,153,0.92)",
                    color:
                      disabled || checkoutBusy || !sessionEmail || postPaymentPolling
                        ? "rgba(255,255,255,0.4)"
                        : "#0b0b10",
                    fontWeight: 800,
                    fontSize: compact ? 12 : fsModal ? 14 : 13,
                    cursor:
                      disabled || checkoutBusy || !sessionEmail || postPaymentPolling
                        ? "not-allowed"
                        : "pointer",
                    flexShrink: 0,
                    boxSizing: "border-box",
                  }}
                >
                  {preparingCheckout
                    ? "Подготовка…"
                    : checkoutBusy
                      ? "Обработка…"
                      : `Перейти на год · ${BILLING_PLAN_LABELS[currentPlanId]}`}
                </button>
              ) : (
                <div className="mt-4 w-full shrink-0" style={{ minHeight: overLimitPaySlotMinPx }} aria-hidden />
              )}
            </div>
            {upgradePlanIds.map((id) => {
              const showRec = suggestPlan ? suggestPlan === id : id === recommendedPlanId;
              const growthHero = id === "growth";
              const highlighted = showRec || growthHero;
              const hovered = hoverUpgrade === id;
              return (
                <div
                  key={id}
                  className="flex h-full min-h-0 min-w-0 flex-col"
                  onMouseEnter={() => setHoverUpgrade(id)}
                  onMouseLeave={() => setHoverUpgrade(null)}
                  style={{
                    padding: pad,
                    borderRadius: 12,
                    border: growthHero
                      ? "2px solid rgba(52,211,153,0.88)"
                      : highlighted
                        ? "1px solid rgba(52,211,153,0.65)"
                        : hovered
                          ? "1px solid rgba(255,255,255,0.22)"
                          : "1px solid rgba(255,255,255,0.12)",
                    background: growthHero
                      ? "rgba(52,211,153,0.14)"
                      : highlighted
                        ? "rgba(52,211,153,0.1)"
                        : hovered
                          ? "rgba(255,255,255,0.07)"
                          : "rgba(255,255,255,0.04)",
                    color: "white",
                    textAlign: "left",
                    position: "relative",
                    boxSizing: "border-box",
                    transition: "border-color 0.12s ease, background 0.12s ease, transform 0.12s ease",
                    transform: growthHero ? "scale(1.03)" : undefined,
                    zIndex: growthHero ? 1 : undefined,
                    boxShadow: growthHero ? "0 12px 40px rgba(0,0,0,0.35)" : undefined,
                  }}
                >
                  {showRec || growthHero ? (
                    <span
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        fontSize: compact ? 9 : fsModal ? 10 : 9,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "rgba(52,211,153,0.95)",
                        border: "1px solid rgba(52,211,153,0.45)",
                        borderRadius: 6,
                        padding: "2px 6px",
                        background: "rgba(52,211,153,0.12)",
                      }}
                    >
                      Рекомендуем
                    </span>
                  ) : null}
                  <div className="min-w-0 shrink-0">
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: growthHero
                          ? compact
                            ? 14
                            : fsModal
                              ? 16
                              : 15
                          : compact
                            ? 13
                            : fsModal
                              ? 15
                              : 14,
                        paddingRight: showRec || growthHero ? 72 : 0,
                      }}
                    >
                      {BILLING_PLAN_LABELS[id]}
                    </div>
                    <div style={{ fontSize: compact ? 11 : fsModal ? 13 : 12, marginTop: 4, color: "rgba(255,255,255,0.7)" }}>
                      {formatBillingPriceLabel(id, displayBilling)}
                    </div>
                    {renderPeriodPlanHints(id, "rgba(255,255,255,0.48)")}
                    {id === "growth" ? (
                      <div
                        style={{
                          fontSize: compact ? 10 : fsModal ? 11 : 10,
                          marginTop: 6,
                          lineHeight: 1.45,
                          color: "rgba(255,255,255,0.62)",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>Идеально для команд</div>
                        <div style={{ marginTop: 4 }}>Полный доступ к аналитике</div>
                      </div>
                    ) : id === "scale" ? (
                      <div
                        style={{
                          fontSize: compact ? 10 : fsModal ? 11 : 10,
                          marginTop: 6,
                          lineHeight: 1.45,
                          color: "rgba(255,255,255,0.58)",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>
                          Максимум возможностей
                        </div>
                        <div style={{ marginTop: 4 }}>Без ограничений по участникам и проектам</div>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: compact ? 10 : fsModal ? 11 : 10,
                          marginTop: 6,
                          lineHeight: 1.4,
                          color: "rgba(255,255,255,0.5)",
                        }}
                      >
                        {INLINE_PLAN_TAGLINE[id]}
                      </div>
                    )}
                    {id === "growth" || id === "scale" ? <div className="my-4 border-t border-white/10" role="presentation" /> : null}
                    {renderUpgradeLimitComparison(id)}
                  </div>
                  <div className="min-h-0 flex-1 basis-0" aria-hidden />
                  <button
                    type="button"
                    className="mt-4 w-full shrink-0"
                    disabled={
                      disabled ||
                      checkoutBusy ||
                      !sessionEmail ||
                      postPaymentPolling ||
                      upgradePayBlocked(id)
                    }
                    onClick={() => void startCheckoutForPlan(id)}
                    style={{
                      minHeight: overLimitPaySlotMinPx,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: "none",
                      background:
                        disabled ||
                        checkoutBusy ||
                        !sessionEmail ||
                        postPaymentPolling ||
                        upgradePayBlocked(id)
                          ? "rgba(255,255,255,0.12)"
                          : growthHero
                            ? "rgba(16,185,129,0.98)"
                            : "rgba(52,211,153,0.92)",
                      color:
                        disabled ||
                        checkoutBusy ||
                        !sessionEmail ||
                        postPaymentPolling ||
                        upgradePayBlocked(id)
                          ? "rgba(255,255,255,0.4)"
                          : "#0b0b10",
                      fontWeight: 800,
                      fontSize: growthHero ? (compact ? 13 : fsModal ? 15 : 14) : compact ? 12 : fsModal ? 14 : 13,
                      cursor:
                        disabled ||
                        checkoutBusy ||
                        !sessionEmail ||
                        postPaymentPolling ||
                        upgradePayBlocked(id)
                          ? "not-allowed"
                          : "pointer",
                      flexShrink: 0,
                      boxSizing: "border-box",
                    }}
                  >
                    {preparingCheckout
                      ? "Подготовка оплаты…"
                      : checkoutBusy && !preparingCheckout
                        ? "Обработка…"
                        : `Оплатить · ${BILLING_PLAN_LABELS[id]}`}
                  </button>
                  {renderDueTodayUnderPlan(id)}
                </div>
              );
            })}
          </>
        ) : compact ? (
          PRICING_PLAN_IDS.map((id) => {
            const active = selectedPlan === id;
            const showRec = id === recommendedPlanId;
            return (
              <button
                key={id}
                type="button"
                disabled={controlsLocked}
                onClick={() => setSelectedPlan(id)}
                style={{
                  padding: pad,
                  borderRadius: 12,
                  border: active
                    ? "1px solid rgba(52,211,153,0.65)"
                    : "1px solid rgba(255,255,255,0.12)",
                  background: active ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)",
                  color: "white",
                  textAlign: "left",
                  cursor: controlsLocked ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                  position: "relative",
                }}
              >
                {showRec ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      fontSize: 9,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "rgba(52,211,153,0.95)",
                      border: "1px solid rgba(52,211,153,0.45)",
                      borderRadius: 6,
                      padding: "2px 6px",
                      background: "rgba(52,211,153,0.12)",
                    }}
                  >
                    Рекомендуем
                  </span>
                ) : null}
                <div style={{ fontWeight: 800, fontSize: 13, paddingRight: showRec ? 72 : 0 }}>
                  {BILLING_PLAN_LABELS[id]}
                </div>
                <div style={{ fontSize: 11, marginTop: 4, color: "rgba(255,255,255,0.7)" }}>
                  {formatBillingPriceLabel(id, displayBilling)}
                </div>
                {renderPeriodPlanHints(id, "rgba(255,255,255,0.45)")}
                <div
                  style={{
                    fontSize: 10,
                    marginTop: 6,
                    lineHeight: 1.35,
                    color: "rgba(255,255,255,0.5)",
                  }}
                >
                  {INLINE_PLAN_TAGLINE[id]}
                </div>
              </button>
            );
          })
        ) : useWideDefaultGrid ? (
          PRICING_PLAN_IDS.map((id) => {
            const isCurrent =
              (paddleSrc
                ? paddleSrc.plan === id && paddleSrc.billing === billing
                : subscriptionUiSlice
                  ? subscriptionUiSlice.plan === id && subscriptionUiSlice.billing === billing
                  : false);
            const tierBlocked = upgradePayBlocked(id);
            const payLocked = disabled || checkoutBusy || !sessionEmail || postPaymentPolling;

            if (isCurrent) {
              return (
                <div
                  key={id}
                  className="flex h-full min-h-0 min-w-0 flex-col"
                  style={{
                    padding: widePlanCardPad,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.03)",
                    color: "rgba(255,255,255,0.65)",
                    textAlign: "left",
                    cursor: "default",
                    opacity: 0.52,
                    position: "relative",
                    boxSizing: "border-box",
                  }}
                >
                  <div className="min-w-0 shrink-0">
                    <span
                      style={{
                        display: "inline-block",
                        marginBottom: 10,
                        fontSize: compact ? 9 : fsModal ? 10 : 9,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "rgba(255,255,255,0.45)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: 6,
                        padding: "2px 6px",
                        background: "rgba(255,255,255,0.06)",
                      }}
                    >
                      Ваш текущий тариф
                    </span>
                    <div style={{ fontWeight: 800, fontSize: compact ? 13 : fsModal ? 15 : 14 }}>
                      {BILLING_PLAN_LABELS[id]}
                    </div>
                    <div
                      style={{
                        fontSize: compact ? 11 : fsModal ? 13 : 12,
                        marginTop: useWideDefaultGrid ? 6 : 4,
                        color: "rgba(255,255,255,0.45)",
                      }}
                    >
                      Текущий: <span style={{ color: "rgba(255,255,255,0.88)" }}>{planSummary}</span>
                    </div>
                    <div
                      style={{
                        fontSize: compact ? 11 : fsModal ? 13 : 12,
                        marginTop: useWideDefaultGrid ? 6 : 4,
                        color: "rgba(255,255,255,0.45)",
                      }}
                    >
                      {formatBillingPriceLabel(id, displayBilling)}
                    </div>
                    <div className="mt-1 text-xs text-white/50">
                      Оплата: {realBilling === "yearly" ? "раз в год" : "раз в месяц"}
                    </div>
                    {renderPeriodPlanHints(id, "rgba(255,255,255,0.34)", displayBilling)}
                    {renderModalWidePlanTaglines(id)}
                  </div>
                  <div className="min-h-0 flex-1 basis-0" aria-hidden />
                  <button
                    type="button"
                    className={`${widePayBtnMt} w-full shrink-0`}
                    disabled
                    style={{
                      minHeight: overLimitPaySlotMinPx,
                      padding: widePayBtnPad,
                      borderRadius: 10,
                      border: "none",
                      background: "rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.4)",
                      fontWeight: 800,
                      fontSize: compact ? 12 : fsModal ? 14 : 13,
                      cursor: "not-allowed",
                      flexShrink: 0,
                      boxSizing: "border-box",
                    }}
                  >
                    Текущий тариф
                  </button>
                  {renderDueTodayUnderPlan(id)}
                </div>
              );
            }

            const showRec = suggestPlan ? suggestPlan === id : id === recommendedPlanId;
            const growthHero = id === "growth";
            const highlighted = showRec || growthHero;
            const hovered = hoverUpgrade === id;
            return (
              <div
                key={id}
                className="flex h-full min-h-0 min-w-0 flex-col"
                onMouseEnter={() => setHoverUpgrade(id)}
                onMouseLeave={() => setHoverUpgrade(null)}
                style={{
                  padding: widePlanCardPad,
                  borderRadius: 14,
                  border: growthHero
                    ? "2px solid rgba(52,211,153,0.88)"
                    : highlighted
                      ? "1px solid rgba(52,211,153,0.65)"
                      : hovered
                        ? "1px solid rgba(255,255,255,0.22)"
                        : "1px solid rgba(255,255,255,0.12)",
                  background: growthHero
                    ? "rgba(52,211,153,0.14)"
                    : highlighted
                      ? "rgba(52,211,153,0.1)"
                      : hovered
                        ? "rgba(255,255,255,0.07)"
                        : "rgba(255,255,255,0.04)",
                  color: "white",
                  textAlign: "left",
                  position: "relative",
                  boxSizing: "border-box",
                  transition: "border-color 0.12s ease, background 0.12s ease, transform 0.12s ease",
                  transform: growthHero ? "scale(1.03)" : undefined,
                  zIndex: growthHero ? 1 : undefined,
                  boxShadow: growthHero ? "0 12px 40px rgba(0,0,0,0.35)" : undefined,
                  opacity: disabled ? 0.55 : tierBlocked ? 0.42 : 1,
                }}
              >
                {showRec || growthHero ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      fontSize: compact ? 9 : fsModal ? 10 : 9,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "rgba(52,211,153,0.95)",
                      border: "1px solid rgba(52,211,153,0.45)",
                      borderRadius: 6,
                      padding: "2px 6px",
                      background: "rgba(52,211,153,0.12)",
                    }}
                  >
                    Рекомендуем
                  </span>
                ) : null}
                <div className="min-w-0 shrink-0">
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: growthHero
                        ? compact
                          ? 14
                          : fsModal
                            ? 16
                            : 15
                        : compact
                          ? 13
                          : fsModal
                            ? 15
                            : 14,
                      paddingRight: showRec || growthHero ? 72 : 0,
                    }}
                  >
                    {BILLING_PLAN_LABELS[id]}
                  </div>
                  <div
                    style={{
                      fontSize: compact ? 11 : fsModal ? 13 : 12,
                      marginTop: useWideDefaultGrid ? 6 : 4,
                      color: "rgba(255,255,255,0.7)",
                    }}
                  >
                    {formatBillingPriceLabel(id, displayBilling)}
                  </div>
                  {renderPeriodPlanHints(id, "rgba(255,255,255,0.48)")}
                  {renderModalWidePlanTaglines(id)}
                </div>
                <div className="min-h-0 flex-1 basis-0" aria-hidden />
                <button
                  type="button"
                  className={`${widePayBtnMt} w-full shrink-0`}
                  disabled={payLocked || tierBlocked || controlsLocked}
                  onClick={() => {
                    if (tierBlocked) return;
                    setSelectedPlan(id);
                    void startCheckoutForPlan(id);
                  }}
                  style={{
                    minHeight: overLimitPaySlotMinPx,
                    padding: widePayBtnPad,
                    borderRadius: 10,
                    border: "none",
                    background:
                      payLocked || tierBlocked || controlsLocked
                        ? "rgba(255,255,255,0.12)"
                        : growthHero
                          ? "rgba(16,185,129,0.98)"
                          : "rgba(52,211,153,0.92)",
                    color:
                      payLocked || tierBlocked || controlsLocked ? "rgba(255,255,255,0.4)" : "#0b0b10",
                    fontWeight: 800,
                    fontSize: growthHero ? (compact ? 13 : fsModal ? 15 : 14) : compact ? 12 : fsModal ? 14 : 13,
                    cursor: payLocked || tierBlocked || controlsLocked ? "not-allowed" : "pointer",
                    flexShrink: 0,
                    boxSizing: "border-box",
                  }}
                >
                  {tierBlocked
                    ? "Недоступно"
                    : preparingCheckout
                      ? "Подготовка оплаты…"
                      : checkoutBusy && !preparingCheckout
                        ? "Обработка…"
                        : `Оплатить · ${BILLING_PLAN_LABELS[id]}`}
                </button>
                {renderDueTodayUnderPlan(id)}
              </div>
            );
          })
        ) : (
          PRICING_PLAN_IDS.map((id) => {
            const active = selectedPlan === id;
            const showRec = id === recommendedPlanId;
            const tierBlocked = upgradePayBlocked(id);
            return (
              <button
                key={id}
                type="button"
                disabled={controlsLocked || tierBlocked}
                onClick={() => {
                  if (!tierBlocked) setSelectedPlan(id);
                }}
                style={{
                  padding: pad,
                  borderRadius: 12,
                  border: active
                    ? "1px solid rgba(52,211,153,0.65)"
                    : "1px solid rgba(255,255,255,0.12)",
                  background: active ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)",
                  color: "white",
                  textAlign: "left",
                  cursor: controlsLocked || tierBlocked ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : tierBlocked ? 0.42 : 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  height: "100%",
                  minHeight: 0,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: subscribeShellMinimal ? 15 : 14,
                      lineHeight: 1.25,
                      minWidth: 0,
                      flex: "1 1 auto",
                    }}
                  >
                    {BILLING_PLAN_LABELS[id]}
                  </div>
                  {showRec ? (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 9,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "rgba(52,211,153,0.95)",
                        border: "1px solid rgba(52,211,153,0.45)",
                        borderRadius: 6,
                        padding: "3px 8px",
                        background: "rgba(52,211,153,0.12)",
                        lineHeight: 1.2,
                        maxWidth: "min(100%, 118px)",
                        textAlign: "center",
                      }}
                    >
                      Рекомендуем
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    marginTop: subscribeShellMinimal ? 8 : 4,
                    color: "rgba(255,255,255,0.7)",
                  }}
                >
                  {formatBillingPriceLabel(id, displayBilling)}
                </div>
                {renderPeriodPlanHints(id, "rgba(255,255,255,0.45)")}
                <div
                  style={{
                    flex: 1,
                    minHeight: subscribeShellMinimal ? 8 : 4,
                  }}
                  aria-hidden
                />
                <div
                  style={{
                    fontSize: subscribeShellMinimal ? 11 : 10,
                    lineHeight: 1.45,
                    color: "rgba(255,255,255,0.52)",
                  }}
                >
                  {INLINE_PLAN_TAGLINE[id]}
                </div>
              </button>
            );
          })
        )}
      </div>

      {!isOverLimit && (compact || !useWideDefaultGrid) ? (
        <button
          type="button"
          disabled={
            disabled ||
            checkoutBusy ||
            !sessionEmail ||
            upgradePayBlocked(selectedPlan)
          }
          onClick={() => void startCheckout()}
          style={{
            width: "100%",
            marginTop: subscribeShellMinimal ? 40 : 0,
            padding: compact ? "10px 14px" : subscribeShellMinimal ? "14px 18px" : "12px 16px",
            borderRadius: 12,
            border: "none",
            background:
              disabled || checkoutBusy || !sessionEmail
                ? "rgba(255,255,255,0.12)"
                : "rgba(52,211,153,0.92)",
            color: disabled || checkoutBusy || !sessionEmail ? "rgba(255,255,255,0.4)" : "#0b0b10",
            fontWeight: 800,
            cursor: disabled || checkoutBusy || !sessionEmail ? "not-allowed" : "pointer",
            fontSize: compact ? 13 : fsModal ? 15 : 14,
          }}
        >
          {primaryLabel}
        </button>
      ) : null}
      {!isOverLimit && (compact || !useWideDefaultGrid) ? renderDueTodayUnderPlan(selectedPlan) : null}

      {upgradeDraft ? (
        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid rgba(52,211,153,0.35)",
            background: "rgba(52,211,153,0.08)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14, color: "rgba(220,255,235,0.98)", marginBottom: 8 }}>
            Подтверждение изменения подписки
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "rgba(255,255,255,0.88)", lineHeight: 1.45 }}>
            Текущий: {upgradeDraft.api.preview.current_label}
          </p>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "rgba(255,255,255,0.88)", lineHeight: 1.45 }}>
            Новый: {upgradeDraft.api.preview.target_label}
          </p>
          {upgradeDraft.sourceMonthly && upgradeDraft.targetBilling === "yearly" ? (
            <>
              <p style={{ margin: "0 0 6px", fontSize: 12, color: "rgba(220,240,255,0.98)", lineHeight: 1.45 }}>
                Остаток текущего периода будет учтён в оплате.
              </p>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "rgba(200,230,255,0.92)", lineHeight: 1.45 }}>
                Paddle применит кредит за неиспользованное время текущего периода к счёту за новый тариф.
              </p>
            </>
          ) : null}
          {upgradeDraft.api.preview.credit_label ? (
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "rgba(180,255,210,0.95)", lineHeight: 1.45 }}>
              Кредит к оплате (из расчёта Paddle): <strong style={{ color: "white" }}>{upgradeDraft.api.preview.credit_label}</strong>
            </p>
          ) : null}
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>
            Дальнейшие списания см. в деталях подписки Paddle. Изменение применяется к текущей подписке, новая не
            создаётся.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              disabled={subscriptionUpgradeApplying || disabled}
              onClick={() => void confirmSubscriptionUpgrade()}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background:
                  subscriptionUpgradeApplying || disabled ? "rgba(255,255,255,0.12)" : "rgba(52,211,129,0.92)",
                color: subscriptionUpgradeApplying || disabled ? "rgba(255,255,255,0.4)" : "#0b0b10",
                fontWeight: 800,
                fontSize: 13,
                cursor: subscriptionUpgradeApplying || disabled ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {subscriptionUpgradeApplying ? (
                <>
                  <span
                    aria-hidden
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      border: "2px solid rgba(11,11,16,0.35)",
                      borderTopColor: "#0b0b10",
                      animation: "billing-spin 0.7s linear infinite",
                    }}
                  />
                  Обновляем подписку…
                </>
              ) : (
                "Подтвердить и оплатить"
              )}
            </button>
            <button
              type="button"
              disabled={subscriptionUpgradeApplying}
              onClick={() => setUpgradeDraft(null)}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "white",
                fontWeight: 600,
                fontSize: 13,
                cursor: subscriptionUpgradeApplying ? "not-allowed" : "pointer",
              }}
            >
              Позже
            </button>
          </div>
        </div>
      ) : null}

      {postPaymentPolling || postPaymentStuck ? (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(52,211,153,0.35)",
            background: "rgba(52,211,153,0.08)",
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "rgba(220,255,235,0.98)", fontWeight: 600 }}>
            {postPaymentStuck ? BILLING_SOFT_PAYMENT_HEADLINE : `${BILLING_SOFT_PAYMENT_HEADLINE}…`}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.45 }}>
            {postPaymentStuck ? BILLING_SOFT_PAYMENT_DETAIL : `${BILLING_SOFT_PAYMENT_DETAIL} Автоопрос — до 60 секунд.`}
          </p>
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              disabled={postPaymentReconcileBusy}
              onClick={() => {
                void (async () => {
                  setPostPaymentReconcileBusy(true);
                  setPostPaymentReconcileHint(null);
                  try {
                    const { accessReady, json } = await postBillingReconcileLatestCheckout({
                      checkoutAttemptId: readCheckoutAttemptIdForTracing(),
                    });
                    const recJson = json && isBootstrapResponseValid(json) ? (json as ReconcileLatestCheckoutJson) : null;
                    if (recJson) {
                      writeLastKnownBootstrap(recJson);
                    }
                    await reloadBootstrap();
                    if (accessReady) {
                      const fresh = recJson?.resolved_ui_state ?? null;
                      if (fresh && !isBillingBlocking(fresh, billingBlockingOpts)) {
                        emitBillingFunnelEvent("billing_access_unblocked", {
                          checkout_attempt_id: readCheckoutAttemptIdForTracing(),
                          organization_id: recJson?.primary_org_id ?? null,
                          user_id: sessionUserId,
                          plan: recJson?.subscription?.plan ?? recJson?.plan_feature_matrix?.plan ?? null,
                          billing_period: recJson?.subscription?.billing_period ?? null,
                          source: "in_app",
                          via: "reconcile",
                        });
                        await finishUnlockedNavigation(fresh);
                      }
                    } else {
                      const r = recJson?.reconcile;
                      setPostPaymentReconcileHint(
                        r && !r.has_billing_subscription_row
                          ? "В базе пока нет записи подписки — webhook может ещё обрабатываться."
                          : "Доступ ещё не обновился. Попробуйте снова через минуту или напишите в поддержку."
                      );
                    }
                  } finally {
                    setPostPaymentReconcileBusy(false);
                  }
                })();
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid rgba(52,211,129,0.55)",
                background: "rgba(52,211,129,0.2)",
                color: "rgba(220,255,235,0.98)",
                fontWeight: 700,
                fontSize: 12,
                cursor: postPaymentReconcileBusy ? "wait" : "pointer",
                opacity: postPaymentReconcileBusy ? 0.65 : 1,
              }}
            >
              Проверить оплату
            </button>
            <button
              type="button"
              disabled={manualRefreshBusy}
              onClick={() => void onManualRefreshStatus()}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid rgba(52,211,129,0.45)",
                background: "rgba(52,211,129,0.15)",
                color: "rgba(220,255,235,0.98)",
                fontWeight: 700,
                fontSize: 13,
                cursor: manualRefreshBusy ? "not-allowed" : "pointer",
                opacity: manualRefreshBusy ? 0.65 : 1,
              }}
            >
              Обновить статус
            </button>
          </div>
          {postPaymentReconcileHint ? (
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,220,200,0.92)", lineHeight: 1.45 }}>
              {postPaymentReconcileHint}
            </p>
          ) : null}
        </div>
      ) : null}

      {paymentIncomplete ? (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,200,120,0.35)",
            background: "rgba(255,180,80,0.08)",
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,230,200,0.98)", fontWeight: 600 }}>
            Оплата не завершена
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.45 }}>
            Окно было закрыто или произошла ошибка. Вы можете попробовать снова — текущий экран и данные не затронуты.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (isOverLimit) {
                const p =
                  suggestPlan && upgradePlanIds.includes(suggestPlan)
                    ? suggestPlan
                    : (upgradePlanIds[0] ?? selectedPlan);
                void startCheckoutForPlan(p);
              } else {
                void startCheckout();
              }
            }}
            style={{
              marginTop: 10,
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(52,211,153,0.45)",
              background: "rgba(52,211,153,0.15)",
              color: "rgba(220,255,235,0.98)",
              fontWeight: 700,
              fontSize: 13,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Попробовать снова
          </button>
        </div>
      ) : null}

      {checkoutError ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,180,160,0.95)" }}>
          <p style={{ margin: 0 }}>{checkoutError}</p>
          {checkoutError.startsWith(BILLING_CHECKOUT_MISSING_ORG_MESSAGE) ? (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.65)" }}>
              <Link href="/app/projects/new" style={{ color: "rgba(167,243,208,0.95)", textDecoration: "underline" }}>
                Создать проект
              </Link>
              {" · "}
              <Link href="/app/projects" style={{ color: "rgba(167,243,208,0.95)", textDecoration: "underline" }}>
                Мои проекты
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <p
        style={{
          marginTop: remedialOverLimitModal
            ? remedialModalVGap
            : useWideDefaultGrid
              ? wideSectionGap + 12
              : subscribeShellMinimal
                ? 14
                : 10,
          fontSize: fsModal ? 12 : 11,
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        Доступ восстановится автоматически после успешной оплаты — обновлять страницу вручную не нужно. Обычно это
        занимает 5–10 секунд. Если за 60 секунд статус не обновится, нажмите «Обновить статус» в баннере.
      </p>
      {!isOverLimit && !widePlanGrid && !subscribeShellMinimal ? (
        <p
          style={{
            marginTop: 8,
            fontSize: fsModal ? 12 : 11,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.45)",
          }}
        >
          Условия возврата — в{" "}
          <Link href="/refund-policy" style={{ color: "rgba(120,160,255,0.9)", fontWeight: 600 }}>
            политике возврата
          </Link>
          .
        </p>
      ) : null}

      {showComparisonLink ? (
        <div
          style={{
            marginTop: remedialOverLimitModal
              ? remedialModalVGap
              : isOverLimit
                ? 16
                : useWideDefaultGrid
                  ? wideSectionGap
                  : subscribeShellMinimal
                    ? 16
                    : 12,
            textAlign: "center",
          }}
        >
          <Link
            href="/pricing-comparison"
            style={{
              display: "inline-block",
              fontSize: fsModal ? 13 : 12,
              color: isOverLimit ? "rgba(255,255,255,0.55)" : "rgba(120,160,255,0.95)",
              fontWeight: 600,
              textDecoration: "underline",
              textDecorationColor: isOverLimit ? "rgba(255,255,255,0.22)" : "rgba(120,160,255,0.45)",
              textUnderlineOffset: 4,
            }}
          >
            Полное сравнение тарифов →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

const pricingSuspenseFallback = (
  <div style={{ padding: "14px 0", fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
    Загрузка тарифов…
  </div>
);

/** Обёртка с Suspense: внутри используется useSearchParams() (требование Next.js App Router). */
export function BillingInlinePricingSuspended(props: Props) {
  return <Suspense fallback={pricingSuspenseFallback}><BillingInlinePricing {...props} /></Suspense>;
}
