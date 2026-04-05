"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { useBillingBootstrap } from "../../../components/BillingBootstrapProvider";

type LoadState = "loading" | "ready" | "expired" | "invalid" | "revoked" | "used" | "has_account";

type Meta = {
  organization_name: string | null;
  invite_email: string | null;
};

const MIN_LEN = 8;
const TRANSFER_EMAIL_MISMATCH_CODE = "TRANSFER_EMAIL_MISMATCH";

export default function TransferSetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { reloadBootstrap } = useBillingBootstrap();
  const token = searchParams.get("token")?.trim() ?? "";

  const [load, setLoad] = useState<LoadState>(() => (token ? "loading" : "invalid"));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let mounted = true;

    (async () => {
      const res = await fetch(`/api/org/transfer-request/by-token?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!mounted) return;

      if (json?.success && json?.organization_id) {
        if (json.account_exists === true) {
          setLoad("has_account");
          setMeta({
            organization_name: json.organization_name ?? null,
            invite_email: json.invite_email ?? null,
          });
          return;
        }
        setMeta({
          organization_name: json.organization_name ?? null,
          invite_email: json.invite_email ?? null,
        });
        setLoad("ready");
        return;
      }

      if (json?.reason === "expired" || json?.error === "expired") {
        setLoad("expired");
        return;
      }
      if (json?.reason === "cancelled") {
        setLoad("revoked");
        return;
      }
      if (json?.reason === "completed") {
        setLoad("used");
        return;
      }
      setLoad("invalid");
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  const acceptUrl = `/app/transfer/accept?token=${encodeURIComponent(token)}`;

  const onSubmit = useCallback(async () => {
    if (!token || load !== "ready") return;
    setError(null);

    if (password.length < MIN_LEN) {
      setError(`Пароль не короче ${MIN_LEN} символов`);
      return;
    }
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/org/transfer-request/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();

      if (!res.ok || !json?.success) {
        if (json?.code === "USER_ALREADY_EXISTS") {
          setLoad("has_account");
          setSubmitting(false);
          return;
        }
        if (json?.reason === "expired" || json?.error === "expired") {
          setLoad("expired");
          setSubmitting(false);
          return;
        }
        setError(typeof json?.error === "string" ? json.error : "Не удалось создать аккаунт");
        setSubmitting(false);
        return;
      }

      const email = typeof json.email === "string" ? json.email.trim() : "";
      if (!email) {
        setError("Не удалось определить email из запроса передачи");
        setSubmitting(false);
        return;
      }

      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) {
        setError(signErr.message);
        setSubmitting(false);
        return;
      }

      const acceptRes = await fetch("/api/org/transfer-request/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const acceptJson = (await acceptRes.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        code?: string;
        reason?: string;
      };
      if (!acceptRes.ok || !acceptJson?.success) {
        if (acceptJson?.code === TRANSFER_EMAIL_MISMATCH_CODE) {
          setError(
            typeof acceptJson.error === "string"
              ? acceptJson.error
              : "Войдите под email, на который отправлена передача организации."
          );
        } else if (acceptJson?.reason === "completed" || (typeof acceptJson.error === "string" && acceptJson.error.includes("завершена"))) {
          setLoad("used");
        } else if (acceptJson?.reason === "expired" || acceptJson?.error === "expired") {
          setLoad("expired");
        } else {
          setError(typeof acceptJson.error === "string" ? acceptJson.error : "Не удалось завершить передачу организации");
        }
        setSubmitting(false);
        return;
      }

      try {
        await reloadBootstrap();
      } catch {
        /* continue */
      }
      router.replace("/app/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setSubmitting(false);
    }
  }, [token, load, password, password2, router, reloadBootstrap]);

  const shell = (inner: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a]/95 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        {inner}
      </div>
    </div>
  );

  if (load === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a]/95 p-8 text-center">
          <div className="mx-auto h-10 w-48 rounded-xl bg-white/[0.06]" />
          <p className="mt-4 text-sm text-zinc-400">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (load === "expired") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Ссылка устарела</p>
        <p className="mt-2 text-sm text-zinc-400">Срок действия ссылки истёк. Попросите владельца отправить передачу снова.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load === "revoked") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Запрос отменён</p>
        <p className="mt-2 text-sm text-zinc-400">Эта передача больше не действует.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load === "used") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Передача уже завершена</p>
        <p className="mt-2 text-sm text-zinc-400">Эта ссылка уже была использована.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load === "invalid" || !token) {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Недействительная ссылка</p>
        <p className="mt-2 text-sm text-zinc-400">Проверьте адрес из письма.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load === "has_account") {
    const loginUrl = `/login?next=${encodeURIComponent(acceptUrl)}`;
    return shell(
      <>
        <p className="text-lg font-medium text-white">Аккаунт уже есть</p>
        <p className="mt-2 text-sm text-zinc-400">
          {meta?.invite_email
            ? `Для ${meta.invite_email} уже есть вход. Войдите и подтвердите передачу.`
            : "Для этого email уже есть аккаунт. Войдите и подтвердите передачу."}
        </p>
        <Link href={loginUrl} className="mt-6 inline-block rounded-xl bg-emerald-600/90 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
          Войти
        </Link>
      </>
    );
  }

  if (load !== "ready" || !meta) return null;

  const inputClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder-zinc-500 focus:border-emerald-500/40 focus:outline-none";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-md rounded-2xl border border-emerald-500/25 bg-[#12121a]/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <h1 className="text-xl font-semibold text-white">Создайте пароль, чтобы получить доступ</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Вам передали управление организацией
          {meta.organization_name ? ` «${meta.organization_name}»` : ""}. Задайте пароль для этого аккаунта — после
          этого передача будет завершена автоматически.
        </p>
        {meta.invite_email ? (
          <p className="mt-3 text-sm text-zinc-300">
            Email: <span className="font-medium text-white">{meta.invite_email}</span>
          </p>
        ) : null}

        <div className="mt-6">
          <label htmlFor="tr-pw1" className="block text-sm font-medium text-zinc-300">
            Пароль
          </label>
          <input
            id="tr-pw1"
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={`не короче ${MIN_LEN} символов`}
          />
        </div>
        <div className="mt-4">
          <label htmlFor="tr-pw2" className="block text-sm font-medium text-zinc-300">
            Подтверждение пароля
          </label>
          <input
            id="tr-pw2"
            type="password"
            className={inputClass}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={submitting}
          className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? "Сохранение…" : "Создать пароль и получить доступ"}
        </button>
      </div>
    </div>
  );
}
