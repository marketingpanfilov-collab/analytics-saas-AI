"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPricingPlanId } from "../lib/auth/loginPurchaseUrl";
import { supabase } from "../lib/supabaseClient";

type Mode = "login" | "signup";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // С лендинга по кнопке «Приобрести»: открываем сразу вкладку «Регистрация».
  useEffect(() => {
    const signup = searchParams.get("signup");
    const plan = searchParams.get("plan");
    const openSignup = signup === "1" || signup === "true" || isValidPricingPlanId(plan);
    if (openSignup) setMode("signup");
  }, [searchParams]);

  const onSubmit = async () => {
    if (loading) return;
    setMsg("");

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

      if (!data.session) {
        setMsg("✅ Аккаунт создан. Проверь почту и подтвердите email, затем войдите.");
        setMode("login");
        setLoading(false);
        return;
      }

      router.replace(nextPath);
      // Оставляем loading=true до ухода со страницы после успешного перехода.
    } catch {
      setMsg("Не удалось выполнить запрос. Попробуйте ещё раз.");
      setLoading(false);
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

  return (
    <main className="min-h-screen bg-[#0b0b10] text-white">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
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
                  Board online
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
              className={`flex min-h-[52px] ${
                mode === "login" ? "items-center" : "items-start"
              }`}
            >
              {mode === "login" ? (
                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={loading}
                  className="cursor-pointer text-left text-sm font-medium text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
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

            {msg ? (
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

            <p className="text-center text-xs text-zinc-500">© 2026 Analytics SaaS — Все права защищены.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
