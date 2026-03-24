"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPricingPlanId, type PricingPlanId } from "../lib/auth/loginPurchaseUrl";
import { getPaddle, setPaddleEventHandler } from "../lib/paddle";
import { getPaddlePriceId, type BillingPeriod } from "../lib/paddlePriceMap";
import { supabase } from "../lib/supabaseClient";

type Mode = "login" | "signup";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");
  const billingParam = searchParams.get("billing");
  const billing: BillingPeriod = billingParam === "yearly" ? "yearly" : "monthly";

  // Post-login: project selection first; never default to /app (dashboard without project_id).
  // Если пользователь пришел с тарифа, сохраняем plan/billing в next-path.
  const nextPath = useMemo(() => {
    const n = searchParams.get("next");
    let path = !n || !n.startsWith("/") ? "/app/projects" : n;
    if (path === "/app" || path === "/app/") path = "/app/projects";

    const plan = searchParams.get("plan");
    const billing = searchParams.get("billing");
    if (isValidPricingPlanId(plan) && (billing === "monthly" || billing === "yearly")) {
      try {
        const u = new URL(path.startsWith("/") ? path : `/${path}`, "http://localhost");
        u.searchParams.set("plan", plan);
        u.searchParams.set("billing", billing);
        return `${u.pathname}${u.search}`;
      } catch {
        return path;
      }
    }
    return path;
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(true);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [selectedPlan, setSelectedPlan] = useState<PricingPlanId | null>(
    isValidPricingPlanId(planParam) ? planParam : null
  );
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [modalBilling, setModalBilling] = useState<BillingPeriod>(billing);

  const checkoutStateRef = useRef<null | {
    paid: boolean;
    onPaid: () => void;
    onNotPaid: () => void;
  }>(null);
  const checkoutTimeoutRef = useRef<number | null>(null);
  const continueAfterPlanSelectRef = useRef(false);

  const PLAN_LABELS: Record<PricingPlanId, string> = {
    starter: "Starter",
    growth: "Growth",
    agency: "Agency",
  };

  const MONTHLY_USD: Record<PricingPlanId, number> = {
    starter: 39,
    growth: 99,
    agency: 249,
  };

  const YEARLY_DISCOUNT_PERCENT: Record<PricingPlanId, number> = {
    starter: 10,
    growth: 15,
    agency: 20,
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
    const openSignup = signup === "1" || signup === "true" || isValidPricingPlanId(plan);
    if (openSignup) setMode("signup");
    if (isValidPricingPlanId(plan)) setSelectedPlan(plan);
  }, [searchParams]);

  useEffect(() => {
    if (showPlanModal) setModalBilling(billing);
  }, [billing, showPlanModal]);

  useEffect(() => {
    setPaddleEventHandler((event) => {
      const ctx = checkoutStateRef.current;
      if (!ctx) return;

      const name = event?.name;
      if (name === "checkout.completed") {
        ctx.paid = true;
        checkoutStateRef.current = null;
        if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
        ctx.onPaid();
        return;
      }

      if (name === "checkout.closed" || name === "checkout.failed" || name === "checkout.error") {
        if (!ctx.paid) {
          checkoutStateRef.current = null;
          if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
          ctx.onNotPaid();
        }
      }
    });

    return () => setPaddleEventHandler(null);
  }, []);

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

      // signup
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }

      const priceId = getPaddlePriceId(effectivePlan, effectiveBilling);
      if (!priceId) {
        setMsg("Не удалось определить цену тарифа. Попробуйте снова.");
        setLoading(false);
        return;
      }

      const paddle = await getPaddle();
      if (!paddle) {
        setMsg("Не удалось инициализировать оплату. Попробуйте позже.");
        setLoading(false);
        return;
      }

      const ctx = {
        paid: false,
        onPaid: () => {
          setMsg(
            "✅ Вы успешно зарегистрировались. Вам выслали письмо на email для подтверждения. Подтвердите письмо в почте и затем войдите."
          );
          setMode("login");
          setLoading(false);
        },
        onNotPaid: () => {
          setMsg("Регистрация возможна только после оплаты. Если вы отменили оплату — завершите её в Paddle и повторите попытку.");
          setMode("signup");
          setLoading(false);
        },
      };

      checkoutStateRef.current = ctx;

      if (checkoutTimeoutRef.current) window.clearTimeout(checkoutTimeoutRef.current);
      checkoutTimeoutRef.current = window.setTimeout(() => {
        const current = checkoutStateRef.current;
        if (!current) return;
        if (!current.paid) {
          checkoutStateRef.current = null;
          current.onNotPaid();
        }
      }, 20000);

      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email: email.trim() },
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
        redirectTo: "http://localhost:3000/reset",
      });

      if (error) return setMsg(error.message);

      setMsg("✅ Письмо для сброса пароля отправлено. Проверь почту.");
    } finally {
      setLoading(false);
    }
  };

  const signupBlocked = mode === "signup" && !acceptTerms;

  const inputClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none";

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/#pricing");
  };

  return (
    <main className="min-h-screen bg-[#0b0b10] text-white">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-flex h-11 items-center self-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[14px] font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white"
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
            <path d="M11.5 5.5L7 10l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="inline-block -translate-y-[1px] leading-none">Вернуться назад</span>
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
                  {mode === "signup" && selectedPlan ? PLAN_LABELS[selectedPlan] : "Dashboard online"}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-400">
                {mode === "login"
                  ? "Зайдите, чтобы открыть панель отчётности и подключить рекламные аккаунты."
                  : "Создайте аккаунт, чтобы начать собирать отчётность по рекламе в одном месте."}
              </p>
            </div>

            <div className="flex shrink-0 gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10">
              <button
                type="button"
                onClick={() => setMode("login")}
                disabled={loading}
                className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
                className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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

            {msg &&
            !(
              mode === "login" &&
              msg.startsWith("Регистрация возможна только после оплаты")
            ) ? (
              <p
                className={
                  msg.startsWith("✅")
                    ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
                    : "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                }
              >
                {msg}
              </p>
            ) : null}

            <div
              className={`text-center -mt-2 ${
                mode === "signup" ? "" : "invisible pointer-events-none"
              }`}
            >
              <button
                type="button"
                onClick={() => setShowPlanModal(true)}
                disabled={loading}
                className="cursor-pointer text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200 hover:drop-shadow-[0_0_14px_rgba(52,211,153,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Сменить тариф
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
                {(["starter", "growth", "agency"] as const).map((plan) => {
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
                            <span className="rounded-md border border-red-400/60 bg-red-500/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300">
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
