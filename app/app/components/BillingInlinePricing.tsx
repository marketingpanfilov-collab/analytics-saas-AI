"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRICING_PLAN_IDS,
  type PricingPlanId,
} from "@/app/lib/auth/loginPurchaseUrl";
import {
  BILLING_PLAN_LABELS,
  defaultInlinePlanId,
  formatBillingPriceLabel,
  INLINE_PLAN_TAGLINE,
  recommendedInlinePlanId,
} from "@/app/lib/billingPlanDisplay";
import {
  broadcastBillingBootstrapInvalidate,
  clearBillingRouteStorage,
  isBillingBlocking,
  resolvePostPaymentRedirect,
  storeOriginRoute,
  validateBillingReturnPath,
} from "@/app/lib/billingBootstrapClient";
import {
  billingPayloadFromResolved,
  emitBillingCjmEvent,
} from "@/app/lib/billingCjmAnalytics";
import { openPaddleSubscriptionCheckout } from "@/app/lib/paddleCheckoutClient";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";
import { supabase } from "@/app/lib/supabaseClient";
import type { ResolvedUiStateV1 } from "@/app/lib/billingUiContract";
import { useBillingBootstrap } from "./BillingBootstrapProvider";

const POST_PAYMENT_POLL_MS = 2500;
const POST_PAYMENT_MAX_ATTEMPTS = 22;
const POST_PAYMENT_TIMEOUT_MS = 55_000;

function billingPollDebug(
  message: string,
  data: { attempt?: number; blocking?: boolean; stop?: string }
): void {
  const enabled =
    (typeof process !== "undefined" && process.env.NODE_ENV === "development") ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BILLING_DEBUG === "1");
  if (enabled) console.debug(`[billing_post_payment] ${message}`, data);
}

const BILLING_OPTIONS: { value: BillingPeriod; label: string }[] = [
  { value: "monthly", label: "Месяц" },
  { value: "yearly", label: "Год" },
];

type Props = {
  disabled?: boolean;
  suggestPlan?: PricingPlanId | null;
  compact?: boolean;
  showComparisonLink?: boolean;
  projectId?: string | null;
  onAfterCheckoutCompleted?: () => void;
};

export default function BillingInlinePricing({
  disabled = false,
  suggestPlan = null,
  compact = false,
  showComparisonLink = true,
  projectId = null,
  onAfterCheckoutCompleted,
}: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const currentAppPath = useMemo(() => {
    const q = searchParams.toString();
    return q ? `${pathname}?${q}` : pathname;
  }, [pathname, searchParams]);

  const { bootstrap, reloadBootstrap, resolvedUi } = useBillingBootstrap();
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
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
  const postPaymentStartedRef = useRef(false);
  const postPaymentGenRef = useRef(0);
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);

  const matrixPlan = bootstrap?.plan_feature_matrix?.plan;
  const recommendedPlanId = useMemo(() => recommendedInlinePlanId(matrixPlan), [matrixPlan]);

  useEffect(() => {
    return () => {
      postPaymentGenRef.current += 1;
    };
  }, []);

  const finishUnlockedNavigation = useCallback(
    async (freshResolved: ResolvedUiStateV1) => {
      setPostPaymentPolling(false);
      setPostPaymentStuck(false);
      postPaymentStartedRef.current = false;
      const rawTarget = resolvePostPaymentRedirect(freshResolved, { currentPath: currentAppPath });
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
    [currentAppPath, onAfterCheckoutCompleted, router]
  );

  const runPostPaymentPollingLoop = useCallback(
    (generation: number) => {
      void (async () => {
        const startedAt = Date.now();
        for (let attempt = 1; ; attempt++) {
          if (postPaymentGenRef.current !== generation) return;
          const fresh = await reloadBootstrap();
          if (postPaymentGenRef.current !== generation) return;
          const blocking = fresh ? isBillingBlocking(fresh) : true;
          billingPollDebug("tick", { attempt, blocking });
          if (fresh && !blocking) {
            billingPollDebug("stop", { attempt, stop: "unlock" });
            await finishUnlockedNavigation(fresh);
            return;
          }
          if (attempt >= POST_PAYMENT_MAX_ATTEMPTS) {
            billingPollDebug("stop", { attempt, stop: "max_attempts" });
            setPostPaymentStuck(true);
            return;
          }
          if (Date.now() - startedAt >= POST_PAYMENT_TIMEOUT_MS) {
            billingPollDebug("stop", { attempt, stop: "timeout" });
            setPostPaymentStuck(true);
            return;
          }
          await new Promise((r) => setTimeout(r, POST_PAYMENT_POLL_MS));
        }
      })();
    },
    [finishUnlockedNavigation, reloadBootstrap]
  );

  const onManualRefreshStatus = useCallback(async () => {
    if (manualRefreshBusy) return;
    setManualRefreshBusy(true);
    try {
      const fresh = await reloadBootstrap();
      if (fresh && !isBillingBlocking(fresh)) await finishUnlockedNavigation(fresh);
    } finally {
      setManualRefreshBusy(false);
    }
  }, [finishUnlockedNavigation, manualRefreshBusy, reloadBootstrap]);

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

  const planSummary = useMemo(() => {
    const m = bootstrap?.plan_feature_matrix;
    const st = bootstrap?.subscription?.status;
    const pl = bootstrap?.subscription?.plan;
    const parts: string[] = [];
    if (pl) parts.push(String(pl));
    if (st) parts.push(String(st));
    if (m?.plan && m.plan !== "unknown") parts.push(`матрица: ${m.plan}`);
    return parts.length ? parts.join(" · ") : "—";
  }, [bootstrap]);

  const startCheckout = useCallback(async () => {
    if (disabled || checkoutBusy) return;
    postPaymentGenRef.current += 1;
    postPaymentStartedRef.current = false;
    setPostPaymentPolling(false);
    setPostPaymentStuck(false);
    setCheckoutError(null);
    setPaymentIncomplete(false);
    const email = sessionEmail.trim();
    if (!email) {
      setCheckoutError("Не удалось определить email сессии.");
      return;
    }
    setCheckoutBusy(true);
    setPreparingCheckout(true);
    try {
      storeOriginRoute(currentAppPath || pathname);
      const r = await openPaddleSubscriptionCheckout({
        plan: selectedPlan,
        billing,
        email,
        userId: sessionUserId,
        pwCustomerId,
        primaryOrgId: bootstrap?.primary_org_id ?? null,
        projectId,
        onCompleted: () => {
          if (postPaymentStartedRef.current) return;
          postPaymentStartedRef.current = true;
          setPreparingCheckout(false);
          setCheckoutBusy(false);
          setPaymentIncomplete(false);
          setPostPaymentPolling(true);
          setPostPaymentStuck(false);
          broadcastBillingBootstrapInvalidate();
          emitBillingCjmEvent(
            "checkout_success",
            billingPayloadFromResolved(resolvedUi, {
              plan: selectedPlan,
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
              plan: selectedPlan,
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
        emitBillingCjmEvent(
          "checkout_opened",
          billingPayloadFromResolved(resolvedUi, {
            plan: selectedPlan,
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
  }, [
    disabled,
    checkoutBusy,
    sessionEmail,
    sessionUserId,
    selectedPlan,
    billing,
    pwCustomerId,
    resolvedUi,
    bootstrap?.primary_org_id,
    projectId,
    currentAppPath,
    pathname,
    runPostPaymentPollingLoop,
  ]);

  const controlsLocked = disabled || checkoutBusy || postPaymentPolling;
  const gap = compact ? 8 : 12;
  const pad = compact ? "10px 12px" : "12px 14px";

  const primaryLabel = (() => {
    if (preparingCheckout) return "Подготовка оплаты…";
    if (checkoutBusy && !preparingCheckout) return "Завершите оплату в окне Paddle…";
    return `Оплатить · ${BILLING_PLAN_LABELS[selectedPlan]}`;
  })();

  return (
    <div style={{ marginTop: compact ? 12 : 18 }}>
      <div
        style={{
          fontSize: compact ? 11 : 12,
          fontWeight: 700,
          color: "rgba(255,255,255,0.55)",
          marginBottom: 8,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Тариф
      </div>
      <div style={{ fontSize: compact ? 13 : 14, color: "rgba(255,255,255,0.85)", marginBottom: gap }}>
        Текущий: <span style={{ color: "white" }}>{planSummary}</span>
      </div>

      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: gap, lineHeight: 1.45 }}>
        Кратко: Starter — старт; Growth — для роста (рекомендуем большинству); Agency — максимум возможностей.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: gap }}>
        {BILLING_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={controlsLocked}
            onClick={() => setBilling(o.value)}
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border:
                billing === o.value
                  ? "1px solid rgba(52,211,153,0.55)"
                  : "1px solid rgba(255,255,255,0.16)",
              background: billing === o.value ? "rgba(52,211,153,0.12)" : "transparent",
              color: "white",
              cursor: controlsLocked ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "repeat(auto-fill, minmax(148px, 1fr))",
          gap: compact ? 8 : 10,
          marginBottom: gap,
        }}
      >
        {PRICING_PLAN_IDS.map((id) => {
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
              <div style={{ fontWeight: 800, fontSize: compact ? 13 : 14, paddingRight: showRec ? 72 : 0 }}>
                {BILLING_PLAN_LABELS[id]}
              </div>
              <div style={{ fontSize: compact ? 11 : 12, marginTop: 4, color: "rgba(255,255,255,0.7)" }}>
                {formatBillingPriceLabel(id, billing)}
              </div>
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
        })}
      </div>

      <button
        type="button"
        disabled={disabled || checkoutBusy || !sessionEmail}
        onClick={() => void startCheckout()}
        style={{
          width: "100%",
          padding: compact ? "10px 14px" : "12px 16px",
          borderRadius: 12,
          border: "none",
          background:
            disabled || checkoutBusy || !sessionEmail
              ? "rgba(255,255,255,0.12)"
              : "rgba(52,211,153,0.92)",
          color: disabled || checkoutBusy || !sessionEmail ? "rgba(255,255,255,0.4)" : "#0b0b10",
          fontWeight: 800,
          cursor: disabled || checkoutBusy || !sessionEmail ? "not-allowed" : "pointer",
          fontSize: compact ? 13 : 14,
        }}
      >
        {primaryLabel}
      </button>

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
            {postPaymentStuck ? "Статус подписки ещё обновляется" : "Платёж обрабатывается…"}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.45 }}>
            {postPaymentStuck
              ? "Платёж принят, но подтверждение на сервере может задержаться до минуты. Нажмите «Обновить статус» или подождите — доступ включится автоматически."
              : "Обычно это 5–10 секунд. Мы проверяем статус подписки автоматически."}
          </p>
          <button
            type="button"
            disabled={manualRefreshBusy}
            onClick={() => void onManualRefreshStatus()}
            style={{
              marginTop: 10,
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(52,211,153,0.45)",
              background: "rgba(52,211,153,0.15)",
              color: "rgba(220,255,235,0.98)",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Обновить статус
          </button>
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
            onClick={() => void startCheckout()}
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
        <p style={{ marginTop: 10, fontSize: 12, color: "rgba(255,180,160,0.95)" }}>{checkoutError}</p>
      ) : null}

      <p
        style={{
          marginTop: 10,
          fontSize: 11,
          lineHeight: 1.45,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        Доступ восстановится автоматически после успешной оплаты — обновлять страницу вручную не нужно. Обычно это
        занимает 5–10 секунд. Если статус задержится до минуты, нажмите «Обновить статус» в баннере.
      </p>
      <p
        style={{
          marginTop: 8,
          fontSize: 11,
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

      {showComparisonLink ? (
        <div style={{ marginTop: 12 }}>
          <Link
            href="/pricing-comparison"
            style={{ fontSize: 12, color: "rgba(120,160,255,0.95)", fontWeight: 600 }}
          >
            Полное сравнение тарифов →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
