"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { useBillingBootstrap } from "../../../components/BillingBootstrapProvider";

type LoadState = "loading" | "ready" | "expired" | "invalid" | "revoked" | "used" | "wrong_type" | "has_account";

type InviteMeta = {
  project_name: string | null;
  invite_email: string | null;
};

const MIN_LEN = 8;

export default function InviteSetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { reloadBootstrap } = useBillingBootstrap();
  const token = searchParams.get("token")?.trim() ?? "";

  const [load, setLoad] = useState<LoadState>(() => (token ? "loading" : "invalid"));
  const [meta, setMeta] = useState<InviteMeta | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let mounted = true;

    (async () => {
      const res = await fetch(`/api/project-invites/by-token?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!mounted) return;

      if (json?.success && json?.project_id) {
        const inviteType = String(json.invite_type ?? "email");
        if (inviteType !== "email") {
          setLoad("wrong_type");
          return;
        }
        if (json.account_exists === true) {
          setLoad("has_account");
          setMeta({
            project_name: json.project_name ?? null,
            invite_email: json.invite_email ?? null,
          });
          return;
        }
        setMeta({
          project_name: json.project_name ?? null,
          invite_email: json.invite_email ?? null,
        });
        setLoad("ready");
        return;
      }

      if (json?.reason === "expired" || json?.error === "expired") {
        setLoad("expired");
        return;
      }
      if (json?.reason === "revoked" || json?.status === "revoked") {
        setLoad("revoked");
        return;
      }
      if (json?.reason === "accepted" || json?.status === "accepted") {
        setLoad("used");
        return;
      }
      setLoad("invalid");
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  const acceptUrl = `/app/invite/accept?token=${encodeURIComponent(token)}`;

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
      const res = await fetch("/api/project-invites/register", {
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
        setError("Не удалось определить email приглашения");
        setSubmitting(false);
        return;
      }

      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) {
        setError(signErr.message);
        setSubmitting(false);
        return;
      }

      try {
        await reloadBootstrap();
      } catch {
        /* продолжаем на accept */
      }
      router.replace(acceptUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setSubmitting(false);
    }
  }, [token, load, password, password2, router, acceptUrl, reloadBootstrap]);

  const shell = (inner: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">{inner}</div>
    </div>
  );

  if (load === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <div className="mx-auto h-10 w-48 rounded-xl bg-white/[0.06]" />
          <p className="mt-4 text-sm text-zinc-400">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (load === "expired") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Приглашение истекло</p>
        <p className="mt-2 text-sm text-zinc-400">
          Срок действия ссылки истёк. Запросите новое приглашение у владельца проекта.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15"
        >
          Войти
        </Link>
      </>
    );
  }

  if (load === "revoked") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Приглашение отозвано</p>
        <p className="mt-2 text-sm text-zinc-400">Это приглашение больше не действует.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load === "used") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Приглашение уже использовано</p>
        <p className="mt-2 text-sm text-zinc-400">С этой ссылкой вход в проект уже был выполнен или приглашение снято.</p>
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
        <p className="mt-2 text-sm text-zinc-400">Проверьте адрес из письма или запросите новое приглашение.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load === "wrong_type") {
    return shell(
      <>
        <p className="text-lg font-medium text-white">Неверный тип приглашения</p>
        <p className="mt-2 text-sm text-zinc-400">Создание пароля по ссылке доступно только для приглашений на email.</p>
        <Link href={acceptUrl} className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          К приглашению
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
            ? `Для ${meta.invite_email} уже зарегистрирован вход. Войдите и примите приглашение.`
            : "Для этого email уже есть аккаунт. Войдите и примите приглашение."}
        </p>
        <Link href={loginUrl} className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
          Войти
        </Link>
      </>
    );
  }

  if (load !== "ready" || !meta) return null;

  const inputClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <h1 className="text-xl font-semibold text-white">Завершите регистрацию</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Вас пригласили в проект{meta.project_name ? ` «${meta.project_name}»` : ""}. Установите пароль для входа.
        </p>
        {meta.invite_email ? (
          <p className="mt-3 text-sm text-zinc-300">
            Email: <span className="font-medium text-white">{meta.invite_email}</span>
          </p>
        ) : null}

        <div className="mt-6">
          <label htmlFor="inv-pw1" className="block text-sm font-medium text-zinc-300">
            Пароль
          </label>
          <input
            id="inv-pw1"
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={`не короче ${MIN_LEN} символов`}
          />
        </div>
        <div className="mt-4">
          <label htmlFor="inv-pw2" className="block text-sm font-medium text-zinc-300">
            Повторите пароль
          </label>
          <input
            id="inv-pw2"
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
          className="mt-6 w-full rounded-xl bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
        >
          {submitting ? "Сохранение…" : "Создать пароль и продолжить"}
        </button>
      </div>
    </div>
  );
}
