"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPricingPlanId, parsePricingPlanId, type PricingPlanId } from "../lib/auth/loginPurchaseUrl";
import {
  broadcastBillingBootstrapInvalidate,
  clearBillingRouteStorage,
  isBillingBlocking,
  isBootstrapResponseValid,
  validateBillingReturnPath,
  writeLastKnownBootstrap,
} from "../lib/billingBootstrapClient";
import {
  clearCheckoutAttemptSession,
  newCheckoutAttemptId,
  persistCheckoutAttemptForSession,
} from "../lib/billingCheckoutAttempt";
import { emitBillingFunnelEvent } from "../lib/billingFunnelAnalytics";
import {
  BILLING_SOFT_PAYMENT_DETAIL,
  BILLING_SOFT_PAYMENT_HEADLINE,
  clearPaymentWebhookGrace,
  markPaymentWebhookGrace,
} from "../lib/billingPaymentWebhookGrace";
import {
  postBillingReconcileLatestCheckout,
  type ReconcileLatestCheckoutJson,
} from "../lib/billingReconcileClient";
import {
  clearLoginCheckoutFinalizeOrg,
  persistLoginCheckoutFinalizeOrg,
} from "../lib/billingLoginCheckoutClient";
import { waitUntilPostPaymentUnblocked, fetchBillingBootstrapPack } from "../lib/billingPostPaymentPoll";
import { subscribeMetaInitiateCheckoutWhenCheckoutLoaded } from "../lib/metaInitiateCheckoutSchedule";
import { fireMetaPurchasePixelFromPaddleEvent } from "../lib/metaPixelBrowser";
import { addPaddleEventListener, getPaddle } from "../lib/paddle";
import { getPaddlePriceId, getPaddleProductId, type BillingPeriod } from "../lib/paddlePriceMap";
import { supabase } from "../lib/supabaseClient";

/** Абсолютный URL для письма подтверждения (Supabase redirect allow-list). */
function buildEmailConfirmRedirectUrl(): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const next = encodeURIComponent("/app/projects");
  return `${origin.replace(/\/$/, "")}/auth/callback?next=${next}`;
}

function buildPasswordResetRedirectUrl(): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${origin.replace(/\/$/, "")}/reset`;
}

type Mode = "login" | "signup";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");
  const billingParam = searchParams.get("billing");
  const billing: BillingPeriod = billingParam === "monthly" ? "monthly" : "yearly";
  const isInviteOnlySignup = searchParams.get("invite") === "1";

  // Post-login: project selection first; never default to /app (dashboard without project_id).
  // Если пользователь пришел с тарифа, сохраняем plan/billing в next-path.
  const nextPath = useMemo(() => {
    const n = searchParams.get("next");
    let path = !n || !n.startsWith("/") ? "/app/projects" : n;
    if (path === "/app" || path === "/app/") path = "/app/projects";

    const plan = searchParams.get("plan");
    const billingRaw = searchParams.get("billing");
    const parsedPlan = parsePricingPlanId(plan);
    if (parsedPlan) {
      const effectiveBilling: BillingPeriod =
        billingRaw === "monthly" ? "monthly" : "yearly";
      try {
        const u = new URL(path.startsWith("/") ? path : `/${path}`, "http://localhost");
        u.searchParams.set("plan", parsedPlan);
        u.searchParams.set("billing", effectiveBilling);
        return `${u.pathname}${u.search}`;
      } catch {
        return path;
      }
    }
    return path;
  }, [searchParams]);

  const authCallbackHint = useMemo(() => {
    const err = searchParams.get("auth_error");
    const hint = searchParams.get("auth_hint");
    if (hint === "missing_code") {
      return "Ссылка подтверждения недействительна или устарела. Запросите новое письмо или войдите вручную.";
    }
    if (err === "exchange_failed") {
      return "Не удалось завершить подтверждение. Попробуйте войти с email и паролем.";
    }
    if (err) {
      return "Подтверждение email не удалось. Попробуйте войти или запросите письмо снова.";
    }
    return null;
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(true);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [loginPaymentRecovery, setLoginPaymentRecovery] = useState(false);
  const [loginReconcileBusy, setLoginReconcileBusy] = useState(false);
  const [loginReconcileHint, setLoginReconcileHint] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PricingPlanId | null>(() => parsePricingPlanId(planParam));
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [modalBilling, setModalBilling] = useState<BillingPeriod>(billing);

  const checkoutStateRef = useRef<null | {
    paid: boolean;
    onPaid: () => void;
    onNotPaid: () => void;
  }>(null);
  const checkoutTimeoutRef = useRef<number | null>(null);
  const checkoutClosedGraceTimerRef = useRef<number | null>(null);
  const continueAfterPlanSelectRef = useRef(false);
  const lastSignupCheckoutRef = useRef<{
    checkoutAttemptId: string;
    organizationId: string;
    statusToken: string;
    emailNormalized: string;
    plan: PricingPlanId;
    billing: BillingPeriod;
  } | null>(null);

  const PLAN_LABELS: Record<PricingPlanId, string> = {
    starter: "Starter",
    growth: "Growth",
    scale: "Scale",
  };

  const MONTHLY_USD: Record<PricingPlanId, number> = {
    starter: 39,
    growth: 99,
    scale: 249,
  };

  const YEARLY_DISCOUNT_PERCENT: Record<PricingPlanId, number> = {
    starter: 10,
    growth: 15,
    scale: 20,
  };

  const yearlyTotalDiscountedUsd = (plan: PricingPlanId) => {
    const monthly = MONTHLY_USD[plan];
    const discountPercent = YEARLY_DISCOUNT_PERCENT[plan];
    return Math.round(monthly * 12 * (1 - discountPercent / 100));
  };

  const yearlySavingsUsd = (plan: PricingPlanId) => {
    return MONTHLY_USD[plan] * 12 - yearlyTotalDiscountedUsd(plan);
  };

  const priceText = (plan: PricingPlanId) => {
    if (modalBilling === "monthly") return `${MONTHLY_USD[plan]} $ / мес`;
    return `${yearlyTotalDiscountedUsd(plan)} $ / год`;
  };

  // С лендинга по кнопке «Приобрести»: открываем сразу вкладку «Регистрация».
  useEffect(() => {
    const signup = searchParams.get("signup");
    const plan = searchParams.get("plan");
    const openSignup =
      signup === "1" || signup === "true" || isValidPricingPlanId(plan) || searchParams.get("invite") === "1";
    if (openSignup) setMode("signup");
    const parsed = parsePricingPlanId(plan);
    if (parsed) setSelectedPlan(parsed);
  }, [searchParams]);

  useEffect(() => {
    setModalBilling(billing);
  }, [billing]);

  async function fetchLoginCheckoutReadyOnce(
    organizationId: string,
    emailNorm: string,
    statusToken: string,
    checkoutAttemptId: string
  ): Promise<boolean> {
    const u = new URL("/api/billing/login-checkout-status", window.location.origin);
    u.searchParams.set("organization_id", organizationId);
    u.searchParams.set("email", emailNorm);
    u.searchParams.set("status_token", statusToken);
    u.searchParams.set("checkout_attempt_id", checkoutAttemptId);
    try {
      const r = await fetch(u.toString(), { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { ready?: boolean } | null;
      return !!(r.ok && j?.ready);
    } catch {
      return false;
    }
  }

  useEffect(() => {
    return addPaddleEventListener((event) => {
      const ctx = checkoutStateRef.current;
      if (!ctx) return;

      const name = event?.name;
      if (name === "checkout.completed") {
        fireMetaPurchasePixelFromPaddleEvent(event);
        if (checkoutClosedGraceTimerRef.current) {
          window.clearTimeout(checkoutClosedGraceTimerRef.current);
          checkoutClosedGraceTimerRef.current = null;
        }
        ctx.paid = true;
        checkoutStateRef.current = null;
        if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
        ctx.onPaid();
        return;
      }

      if (name === "checkout.closed") {
        if (ctx.paid) return;
        if (checkoutClosedGraceTimerRef.current) {
          window.clearTimeout(checkoutClosedGraceTimerRef.current);
          checkoutClosedGraceTimerRef.current = null;
        }
        checkoutClosedGraceTimerRef.current = window.setTimeout(() => {
          checkoutClosedGraceTimerRef.current = null;
          void (async () => {
            if (ctx.paid) return;
            const cur = checkoutStateRef.current;
            if (cur !== ctx) return;
            const snap = lastSignupCheckoutRef.current;
            const ready =
              !!snap &&
              (await fetchLoginCheckoutReadyOnce(
                snap.organizationId,
                snap.emailNormalized,
                snap.statusToken,
                snap.checkoutAttemptId
              ));
            if (ready) {
              ctx.paid = true;
              checkoutStateRef.current = null;
              if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
              ctx.onPaid();
              return;
            }
            checkoutStateRef.current = null;
            if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
            ctx.onNotPaid();
          })();
        }, 3000);
        return;
      }

      if (name === "checkout.failed" || name === "checkout.error") {
        if (checkoutClosedGraceTimerRef.current) {
          window.clearTimeout(checkoutClosedGraceTimerRef.current);
          checkoutClosedGraceTimerRef.current = null;
        }
        if (!ctx.paid) {
          checkoutStateRef.current = null;
          if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
          ctx.onNotPaid();
        }
      }
    });
  }, []);

  async function waitForLoginCheckoutPaid(
    organizationId: string,
    emailNorm: string,
    statusToken: string,
    checkoutAttemptId: string,
    timeoutMs = 90000
  ): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await fetchLoginCheckoutReadyOnce(organizationId, emailNorm, statusToken, checkoutAttemptId)) return true;
      await new Promise((w) => setTimeout(w, 2000));
    }
    return false;
  }

  async function completeLoginSignupAfterPaid(args: {
    organizationId: string;
    checkoutAttemptId: string;
    plan: PricingPlanId;
    billing: BillingPeriod;
  }) {
    const { organizationId, checkoutAttemptId, plan: effectivePlan, billing: effectiveBilling } = args;
    const signUpRes = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: buildEmailConfirmRedirectUrl() },
    });
    let data = signUpRes.data;
    if (signUpRes.error) {
      const em = signUpRes.error.message.toLowerCase();
      if (em.includes("already") || em.includes("registered")) {
        const inRes = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (inRes.error || !inRes.data.session) {
          setMsg("Аккаунт с этим email уже создан. Войдите с паролем, чтобы продолжить.");
          setLoading(false);
          return;
        }
        data = { user: inRes.data.user, session: inRes.data.session };
      } else {
        setMsg(signUpRes.error.message);
        setLoading(false);
        return;
      }
    }

    let session = data.session;
    if (!session) {
      const { data: sessWrap } = await supabase.auth.getSession();
      session = sessWrap.session;
    }
    const userId = session?.user?.id ?? data.user?.id ?? null;

    if (session && userId) {
      const fin = await fetch("/api/auth/finalize-login-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId }),
      });
      if (!fin.ok) {
        persistLoginCheckoutFinalizeOrg(organizationId);
        const j = (await fin.json().catch(() => null)) as { error?: string } | null;
        setMsg(j?.error ?? "Оплата получена, но не удалось привязать организацию. Обновите страницу или напишите в поддержку.");
        setLoading(false);
        return;
      }
      clearLoginCheckoutFinalizeOrg();
    } else {
      persistLoginCheckoutFinalizeOrg(organizationId);
      setMsg(
        "✅ Оплата прошла успешно. На ваш email отправлено письмо для подтверждения — перейдите по ссылке, чтобы открыть настройку аккаунта."
      );
      setLoading(false);
      return;
    }

    const pack = await waitUntilPostPaymentUnblocked({
      reload: () => fetchBillingBootstrapPack(),
    });
    if (pack.bootstrap) writeLastKnownBootstrap(pack.bootstrap);
    const target = validateBillingReturnPath(nextPath) ?? "/app/projects";
    const stillBlocking = pack.resolved ? isBillingBlocking(pack.resolved) : true;
    if (stillBlocking) {
      emitBillingFunnelEvent("billing_checkout_stuck_timeout", {
        checkout_attempt_id: checkoutAttemptId,
        organization_id: organizationId,
        user_id: userId,
        plan: effectivePlan,
        billing_period: effectiveBilling,
        source: "login",
      });
      setLoginPaymentRecovery(true);
      setMsg(`${BILLING_SOFT_PAYMENT_HEADLINE}. ${BILLING_SOFT_PAYMENT_DETAIL}`);
    } else {
      emitBillingFunnelEvent("billing_access_unblocked", {
        checkout_attempt_id: checkoutAttemptId,
        organization_id: organizationId,
        user_id: userId,
        plan: effectivePlan,
        billing_period: effectiveBilling,
        source: "login",
      });
      setMsg("");
      setLoginPaymentRecovery(false);
      clearBillingRouteStorage();
      clearPaymentWebhookGrace();
      clearCheckoutAttemptSession();
    }
    router.replace(target);
    setLoading(false);
  }

  const inviteOnlySignup = async () => {
    if (!email.trim()) return setMsg("Введите email");
    if (!password.trim()) return setMsg("Введите пароль");
    if (!acceptTerms) {
      return setMsg("Для регистрации необходимо принять пользовательское соглашение.");
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: buildEmailConfirmRedirectUrl() },
      });
      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }
      router.replace(nextPath);
    } catch (e) {
      console.error("[Login invite signup] error", e);
      setMsg(e instanceof Error ? e.message : "Не удалось выполнить запрос. Попробуйте ещё раз.");
      setLoading(false);
    }
  };

  const submitWithPlan = async (plan: PricingPlanId, period: BillingPeriod) => {
    if (loading) return;
    setMsg("");

    const effectivePlan = plan;
    const effectiveBilling = period;

    if (!email.trim()) return setMsg("Введите email");
    if (!password.trim()) return setMsg("Введите пароль");
    if (mode === "signup" && !acceptTerms) {
      return setMsg("Для регистрации необходимо принять пользовательское соглашение.");
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setMsg(error.message);
          setLoading(false);
          return;
        }

        router.replace(nextPath);
        // Оставляем loading=true до ухода со страницы после успешного перехода.
        return;
      }

      // signup — оплата до Auth: org из prepare, signUp и письмо только после webhook подписки.
      const prepRes = await fetch("/api/billing/login-signup-checkout-prepare", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const prepBody = (await prepRes.json().catch(() => null)) as {
        success?: boolean;
        organization_id?: string;
        status_token?: string;
        error?: string;
      } | null;
      if (!prepRes.ok || !prepBody?.success || !prepBody.organization_id || !prepBody.status_token) {
        setMsg(prepBody?.error ?? "Не удалось подготовить оплату. Попробуйте снова.");
        setLoading(false);
        return;
      }
      const organizationId = String(prepBody.organization_id).trim();
      const statusToken = String(prepBody.status_token).trim();
      const emailNormalized = email.trim().toLowerCase();

      const priceId = getPaddlePriceId(effectivePlan, effectiveBilling);
      if (!priceId) {
        setMsg("Не удалось определить цену тарифа. Попробуйте снова.");
        setLoading(false);
        return;
      }

      const productId = getPaddleProductId(effectivePlan, effectiveBilling);

      const paddle = await getPaddle();
      if (!paddle) {
        setMsg("Не удалось инициализировать оплату. Попробуйте позже.");
        setLoading(false);
        return;
      }

      const checkoutAttemptId = newCheckoutAttemptId();
      persistCheckoutAttemptForSession(checkoutAttemptId);
      lastSignupCheckoutRef.current = {
        checkoutAttemptId,
        organizationId,
        statusToken,
        emailNormalized,
        plan: effectivePlan,
        billing: effectiveBilling,
      };

      const bindRes = await fetch("/api/billing/login-checkout-bind-attempt", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          email: emailNormalized,
          status_token: statusToken,
          checkout_attempt_id: checkoutAttemptId,
        }),
      });
      const bindBody = (await bindRes.json().catch(() => null)) as { error?: string } | null;
      if (!bindRes.ok) {
        setMsg(
          bindBody?.error === "Already finalized"
            ? "Регистрация для этого email уже завершена. Войдите."
            : "Не удалось начать оплату. Обновите страницу и попробуйте снова."
        );
        setLoading(false);
        return;
      }

      const ctx = {
        paid: false,
        onPaid: () => {
          void (async () => {
            setLoginPaymentRecovery(false);
            setLoginReconcileHint(null);
            setMsg(`${BILLING_SOFT_PAYMENT_HEADLINE}. Обычно до 30 секунд, иногда до минуты.`);
            markPaymentWebhookGrace({ checkoutAttemptId, source: "login" });
            emitBillingFunnelEvent("billing_checkout_completed_client", {
              checkout_attempt_id: checkoutAttemptId,
              organization_id: organizationId,
              user_id: null,
              plan: effectivePlan,
              billing_period: effectiveBilling,
              source: "login",
            });
            broadcastBillingBootstrapInvalidate();
            const ready = await waitForLoginCheckoutPaid(
              organizationId,
              emailNormalized,
              statusToken,
              checkoutAttemptId,
              90000
            );
            if (!ready) {
              emitBillingFunnelEvent("billing_checkout_stuck_timeout", {
                checkout_attempt_id: checkoutAttemptId,
                organization_id: organizationId,
                user_id: null,
                plan: effectivePlan,
                billing_period: effectiveBilling,
                source: "login",
              });
              setLoginPaymentRecovery(true);
              setMsg(`${BILLING_SOFT_PAYMENT_HEADLINE}. ${BILLING_SOFT_PAYMENT_DETAIL}`);
              setLoading(false);
              return;
            }
            await completeLoginSignupAfterPaid({
              organizationId,
              checkoutAttemptId,
              plan: effectivePlan,
              billing: effectiveBilling,
            });
          })();
        },
        onNotPaid: () => {
          setMsg("Регистрация возможна только после оплаты. Если вы отменили оплату — завершите её в Paddle и повторите попытку.");
          setMode("signup");
          setLoading(false);
        },
      };

      if (checkoutClosedGraceTimerRef.current) {
        window.clearTimeout(checkoutClosedGraceTimerRef.current);
        checkoutClosedGraceTimerRef.current = null;
      }

      checkoutStateRef.current = ctx;

      if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
      checkoutTimeoutRef.current = window.setTimeout(() => {
        void (async () => {
          const current = checkoutStateRef.current;
          if (!current) return;
          if (current.paid) return;
          const snap = lastSignupCheckoutRef.current;
          if (
            snap &&
            (await fetchLoginCheckoutReadyOnce(
              snap.organizationId,
              snap.emailNormalized,
              snap.statusToken,
              snap.checkoutAttemptId
            ))
          ) {
            current.paid = true;
            checkoutStateRef.current = null;
            current.onPaid();
            return;
          }
          checkoutStateRef.current = null;
          current.onNotPaid();
        })();
      }, 180000);

      let cancelMeta: (() => void) | null = null;
      if (typeof window !== "undefined") {
        cancelMeta = subscribeMetaInitiateCheckoutWhenCheckoutLoaded(checkoutAttemptId, {
          plan: effectivePlan,
          billingPeriod: effectiveBilling,
          email: email.trim(),
          appUserId: null,
        });
      }
      try {
        paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customer: { email: email.trim() },
          customData: {
            ...(productId ? { paddle_product_id: productId } : {}),
            plan: effectivePlan,
            billing_period: effectiveBilling,
            app_email: emailNormalized,
            app_organization_id: organizationId,
            primary_org_id: organizationId,
            checkout_attempt_id: checkoutAttemptId,
          },
        });
      } catch (openErr) {
        cancelMeta?.();
        throw openErr;
      }
      emitBillingFunnelEvent("billing_checkout_opened", {
        checkout_attempt_id: checkoutAttemptId,
        organization_id: organizationId,
        user_id: null,
        plan: effectivePlan,
        billing_period: effectiveBilling,
        source: "login",
      });
    } catch (e) {
      console.error("[Login signup + Paddle] error", e);
      setMsg(e instanceof Error ? e.message : "Не удалось выполнить запрос. Попробуйте ещё раз.");
      setLoading(false);
    }
  };

  const onSubmit = async () => {
    if (loading) return;
    setMsg("");

    if (mode === "signup" && isInviteOnlySignup) {
      await inviteOnlySignup();
      return;
    }

    if (mode === "signup" && !selectedPlan) {
      continueAfterPlanSelectRef.current = true;
      setShowPlanModal(true);
      setLoading(false);
      return;
    }

    if (mode === "login") {
      if (!email.trim()) return setMsg("Введите email");
      if (!password.trim()) return setMsg("Введите пароль");
      setLoading(true);
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setMsg(error.message);
          setLoading(false);
          return;
        }
        router.replace(nextPath);
        return;
      } catch (e) {
        console.error("[Login] error", e);
        setMsg(e instanceof Error ? e.message : "Не удалось выполнить запрос. Попробуйте ещё раз.");
        setLoading(false);
      }
      return;
    }

    if (mode === "signup" && selectedPlan) {
      await submitWithPlan(selectedPlan, billing);
    }
  };

  const resetPassword = async () => {
    setMsg("");

    if (!email.trim()) return setMsg("Введите email для восстановления пароля");

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: buildPasswordResetRedirectUrl(),
      });

      if (error) return setMsg(error.message);

      setMsg("✅ Письмо для сброса пароля отправлено. Проверь почту.");
    } finally {
      setLoading(false);
    }
  };

  const signupBlocked = mode === "signup" && !acceptTerms;

  const inputClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none";

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/#pricing");
  };

  return (
    <main className="min-h-screen bg-[#0b0b10] text-white" data-login-page>
      {/*
        Без justify-center: при появлении статуса высота карточки растёт и flex перецентрирует колонку — визуальный «прыжок» вверх.
        Отступ сверху от vh, не от контента — положение стабильно при смене msg / оплаты.
      */}
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 pb-12 pt-[clamp(2rem,10vh,5.5rem)] sm:pt-[clamp(2.5rem,12vh,6rem)]">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-flex h-11 cursor-pointer items-center self-start rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[14px] font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white"
        >
          <span className="inline-flex items-center gap-2">
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
              <path d="M11.5 5.5L7 10l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="leading-none">Вернуться назад</span>
          </span>
        </button>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  {mode === "login" ? "Вход в аккаунт" : "Регистрация"}
                </h1>
                <span
                  className="inline-flex shrink-0 items-center rounded-lg border-2 border-emerald-400/90 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.45)] animate-pulse"
                  aria-label="Board online"
                >
                  {mode === "signup" && selectedPlan && !isInviteOnlySignup
                    ? `ТАРИФ: ${PLAN_LABELS[selectedPlan]}`
                    : isInviteOnlySignup && mode === "signup"
                      ? "По приглашению"
                      : "Dashboard online"}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-400">
                {mode === "login"
                  ? "Зайдите, чтобы открыть панель отчётности и подключить рекламные аккаунты."
                  : isInviteOnlySignup
                    ? "Регистрация без выбора тарифа: после входа вы сможете принять приглашение в проект."
                    : "Создайте аккаунт, чтобы начать собирать отчётность по рекламе в одном месте."}
              </p>
            </div>

            <div className="flex w-full shrink-0 gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10 sm:w-auto">
              <button
                type="button"
                onClick={() => setMode("login")}
                disabled={loading}
                className={`w-1/2 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
                  mode === "login"
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Вход
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                disabled={loading}
                className={`w-1/2 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
                  mode === "signup"
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Регистрация
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {authCallbackHint ? (
              <div
                className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100/95"
                role="status"
              >
                {authCallbackHint}
              </div>
            ) : null}
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id="login-email"
                className={inputClass}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-zinc-300">
                Пароль
              </label>
              <input
                id="login-password"
                className={inputClass}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || signupBlocked}
              className="h-11 w-full cursor-pointer rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Подождите..." : mode === "login" ? "Войти" : "Создать аккаунт"}
            </button>

            <div
              className="flex min-h-[52px] items-start"
            >
              {mode === "login" ? (
                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={loading}
                  className="cursor-pointer mt-0.5 translate-x-[4px] text-left text-sm font-medium text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Забыли пароль?
                </button>
              ) : (
                <label className="flex cursor-pointer gap-3 text-sm leading-snug text-zinc-400">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    disabled={loading}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/[0.04] text-emerald-500 focus:ring-emerald-500/40 disabled:cursor-not-allowed"
                  />
                  <span className="min-w-0">
                    Регистрируясь, вы соглашаетесь с{" "}
                    <Link
                      href="/terms"
                      className="cursor-pointer text-zinc-300 underline-offset-2 hover:text-white hover:underline"
                    >
                      пользовательским соглашением
                    </Link>
                    .
                  </span>
                </label>
              )}
            </div>

            {loginPaymentRecovery ? (
              <div className="rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-4 py-3">
                <p className="text-sm leading-relaxed text-indigo-100/95">{msg}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={loginReconcileBusy}
                    onClick={() => {
                      void (async () => {
                        const snap = lastSignupCheckoutRef.current;
                        if (!snap) return;
                        setLoginReconcileBusy(true);
                        setLoginReconcileHint(null);
                        try {
                          if (snap.statusToken) {
                            const ready = await waitForLoginCheckoutPaid(
                              snap.organizationId,
                              snap.emailNormalized,
                              snap.statusToken,
                              snap.checkoutAttemptId,
                              60000
                            );
                            if (!ready) {
                              setLoginReconcileHint(
                                "В базе пока нет записи подписки — webhook может ещё обрабатываться."
                              );
                              return;
                            }
                            setLoginPaymentRecovery(false);
                            await completeLoginSignupAfterPaid({
                              organizationId: snap.organizationId,
                              checkoutAttemptId: snap.checkoutAttemptId,
                              plan: snap.plan,
                              billing: snap.billing,
                            });
                            return;
                          }
                          const { accessReady, json } = await postBillingReconcileLatestCheckout({
                            checkoutAttemptId: snap.checkoutAttemptId,
                          });
                          const recJson =
                            json && isBootstrapResponseValid(json) ? (json as ReconcileLatestCheckoutJson) : null;
                          if (recJson) {
                            writeLastKnownBootstrap(recJson);
                          }
                          if (accessReady) {
                            setLoginPaymentRecovery(false);
                            clearBillingRouteStorage();
                            clearPaymentWebhookGrace();
                            clearCheckoutAttemptSession();
                            router.replace(validateBillingReturnPath(nextPath) ?? "/app/projects");
                          } else {
                            const r = recJson?.reconcile;
                            setLoginReconcileHint(
                              r && !r.has_billing_subscription_row
                                ? "В базе пока нет записи подписки — webhook может ещё обрабатываться."
                                : "Доступ ещё не обновился. Подождите или откройте приложение и нажмите «Обновить статус»."
                            );
                          }
                        } finally {
                          setLoginReconcileBusy(false);
                        }
                      })();
                    }}
                    className="cursor-pointer rounded-lg border border-emerald-400/45 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    Проверить оплату
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      router.replace(validateBillingReturnPath(nextPath) ?? "/app/projects")
                    }
                    className="cursor-pointer rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
                  >
                    Открыть приложение
                  </button>
                </div>
                {loginReconcileHint ? (
                  <p className="mt-2 text-xs text-amber-200/95">{loginReconcileHint}</p>
                ) : null}
              </div>
            ) : null}

            {!loginPaymentRecovery &&
            msg &&
            !(
              mode === "login" &&
              msg.startsWith("Регистрация возможна только после оплаты")
            ) ? (
              <p
                className={
                  msg.startsWith("✅")
                    ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
                    : msg.startsWith(BILLING_SOFT_PAYMENT_HEADLINE) || msg.includes("Подключаем")
                      ? "rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100/95"
                      : "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                }
              >
                {msg}
              </p>
            ) : null}

            <div
              className={`text-center -mt-2 ${
                mode === "signup" && !isInviteOnlySignup ? "" : "invisible pointer-events-none"
              }`}
            >
              <button
                type="button"
                onClick={() => setShowPlanModal(true)}
                disabled={loading}
                className="cursor-pointer text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200 hover:drop-shadow-[0_0_14px_rgba(52,211,153,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedPlan ? "Сменить тариф" : "Выбрать тариф"}
              </button>
            </div>

            <p className="text-center text-xs text-zinc-500">© 2026 Analytics SaaS — Все права защищены.</p>
          </div>
        </div>

        {showPlanModal ? (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/65 p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f14] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
              <h2 className="text-lg font-semibold text-white">Выберите тариф</h2>
              <p className="mt-2 text-sm text-zinc-400">Сначала выберите тариф и период оплаты, затем продолжите регистрацию и оплату.</p>

              {/* Период оплаты (как на главной) */}
              <div className="mt-4 flex justify-center">
                <div
                  className="grid w-full grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10"
                  role="group"
                  aria-label="Период оплаты"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setModalBilling("monthly");
                      const p = new URLSearchParams(searchParams.toString());
                      p.set("billing", "monthly");
                      p.set("signup", "1");
                      router.replace(`/login?${p.toString()}`);
                    }}
                    className={`flex-1 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-300 ease-out ${
                      modalBilling === "monthly"
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    1 месяц
                  </button>
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => {
                        setModalBilling("yearly");
                        const p = new URLSearchParams(searchParams.toString());
                        p.set("billing", "yearly");
                        p.set("signup", "1");
                        router.replace(`/login?${p.toString()}`);
                      }}
                      className={`w-full cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-300 ease-out ${
                        modalBilling === "yearly"
                          ? "bg-white/10 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      1 год
                    </button>
                    <span
                      className="pointer-events-none absolute right-0 top-0 z-10 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-emerald-500/35 text-[11px] font-bold leading-none text-emerald-100 ring-1 ring-emerald-400/50"
                      aria-hidden
                    >
                      %
                    </span>
                  </span>
                </div>
              </div>

              {/* Тариф */}
              <div className="mt-4 grid grid-cols-1 gap-2">
                {(["starter", "growth", "scale"] as const).map((plan) => {
                  const isActive = selectedPlan === plan;
                  return (
                    <button
                      key={plan}
                      type="button"
                      onClick={() => {
                        setSelectedPlan(plan);
                        const p = new URLSearchParams(searchParams.toString());
                        p.set("plan", plan);
                        p.set("billing", modalBilling);
                        p.set("signup", "1");
                        router.replace(`/login?${p.toString()}`);
                        setShowPlanModal(false);
                        if (continueAfterPlanSelectRef.current) {
                          continueAfterPlanSelectRef.current = false;
                          void submitWithPlan(plan, modalBilling);
                        }
                      }}
                      className={`h-11 cursor-pointer rounded-xl border px-4 text-sm font-semibold transition ${
                        isActive
                          ? "border-emerald-400/35 bg-emerald-500/[0.16] text-white"
                          : "border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span>{PLAN_LABELS[plan]}</span>
                          {plan === "growth" ? (
                            <span className="rounded-md border border-emerald-400/60 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                              Рекомендуем
                            </span>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-white/70">{priceText(plan)}</div>
                          {modalBilling === "yearly" ? (
                            <div className="text-[11px] font-semibold text-red-400">
                              Экономия ${yearlySavingsUsd(plan)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                className="mt-3 h-10 w-full cursor-pointer rounded-xl border border-white/12 bg-white/[0.04] text-sm text-zinc-300 transition hover:bg-white/[0.08]"
              >
                Закрыть
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
