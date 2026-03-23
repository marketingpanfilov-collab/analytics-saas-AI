"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getPaddle } from "@/lib/paddle";
import { getPriceIdByPlan, normalizePlanId } from "@/lib/billing/plans";
import { supabase } from "@/app/lib/supabaseClient";

type Props = {
  plan: string | null;
  billing: "monthly" | "yearly";
};

const PLAN_LABELS: Record<"starter" | "growth" | "agency", string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency",
};

export default function RegisterWithCheckout({ plan, billing }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedPlan = useMemo(() => normalizePlanId(plan), [plan]);
  const priceId = useMemo(() => getPriceIdByPlan(plan, billing), [plan, billing]);

  const handleRegisterAndPay = async () => {
    if (loading) return;
    setError(null);

    if (!email.trim()) return setError("Введите email");
    if (!password.trim()) return setError("Введите пароль");
    if (password.length < 8) return setError("Пароль должен быть не менее 8 символов");
    if (!normalizedPlan || !priceId) return setError("Невалидный тариф. Вернитесь на страницу тарифов.");
    if (!acceptTerms) return setError("Для регистрации необходимо принять пользовательское соглашение.");

    setLoading(true);
    try {
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          plan: normalizedPlan,
        }),
      });

      const registerData = (await registerRes.json().catch(() => null)) as
        | { success?: boolean; user?: { id?: string; email?: string }; error?: string }
        | null;

      if (!registerRes.ok || !registerData?.success || !registerData.user?.id) {
        throw new Error(registerData?.error || "Регистрация не удалась");
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        throw new Error("Пользователь создан, но вход не выполнен. Попробуйте войти и повторить оплату.");
      }

      const paddle = await getPaddle();
      if (!paddle) throw new Error("Paddle не инициализировался. Попробуйте позже.");

      // Диагностика параметров checkout для прод-разбора ошибок Paddle.
      console.info("[Paddle] opening checkout", {
        plan: normalizedPlan,
        billing,
        priceId,
        email: email.trim(),
      });

      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email: email.trim() },
        customData: {
          appUserId: registerData.user.id,
          selectedPlan: normalizedPlan,
          selectedBilling: billing,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b0b10] text-white">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">Регистрация</h1>
            {normalizedPlan ? (
              <span className="inline-flex items-center rounded-lg border border-emerald-400/60 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                {PLAN_LABELS[normalizedPlan]}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            После успешной регистрации откроется оплата тарифа через Paddle.
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium text-zinc-300">
                Имя
              </label>
              <input
                id="register-name"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                placeholder="Ваше имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id="register-email"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-zinc-300">
                Пароль
              </label>
              <input
                id="register-password"
                type="password"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                placeholder="Минимум 8 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

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
                <Link href="/terms" className="text-zinc-300 underline-offset-2 hover:text-white hover:underline">
                  пользовательским соглашением
                </Link>
                .
              </span>
            </label>

            <button
              type="button"
              onClick={handleRegisterAndPay}
              disabled={loading || !normalizedPlan || !priceId}
              className="h-11 w-full cursor-pointer rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Подождите..." : "Зарегистрироваться и перейти к оплате"}
            </button>

            {error ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
