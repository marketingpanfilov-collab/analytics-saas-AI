"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";
import { useBillingBootstrap } from "../../../components/BillingBootstrapProvider";

const TRANSFER_EMAIL_MISMATCH_CODE = "TRANSFER_EMAIL_MISMATCH";

type TransferInfo = {
  success: true;
  organization_id: string;
  organization_name: string | null;
  invite_email: string | null;
  expires_at: string;
  invite_type: string;
  account_exists: boolean | null;
};

function acceptPath(token: string) {
  return `/app/transfer/accept?token=${encodeURIComponent(token)}`;
}

export default function TransferAcceptClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { reloadBootstrap } = useBillingBootstrap();
  const token = searchParams.get("token")?.trim() ?? "";

  const [state, setState] = useState<
    "loading" | "ready" | "expired" | "invalid" | "revoked" | "used"
  >(() => (token ? "loading" : "invalid"));
  const [info, setInfo] = useState<TransferInfo | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);

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
        setInfo({
          success: true,
          organization_id: json.organization_id,
          organization_name: json.organization_name ?? null,
          invite_email: typeof json.invite_email === "string" ? json.invite_email : null,
          expires_at: json.expires_at,
          invite_type: String(json.invite_type ?? "email"),
          account_exists: typeof json.account_exists === "boolean" ? json.account_exists : null,
        });
        setState("ready");
        return;
      }

      if (json?.reason === "expired" || json?.error === "expired") {
        setState("expired");
        return;
      }
      if (json?.reason === "cancelled") {
        setState("revoked");
        return;
      }
      if (json?.reason === "completed") {
        setState("used");
        return;
      }
      setState("invalid");
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  // Новый получатель без аккаунта: сразу на экран пароля (ссылка из письма ведёт на accept).
  useEffect(() => {
    if (state !== "ready" || !info || !token) return;
    if (user) return;
    const isEmailInvite = info.invite_type === "email" && Boolean(info.invite_email);
    if (!isEmailInvite || info.account_exists !== false) return;
    router.replace(`/app/transfer/set-password?token=${encodeURIComponent(token)}`);
  }, [state, info, token, user, router]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (!mounted) return;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleAccept = useCallback(async () => {
    if (!token || !user) return;
    setError(null);
    setAccepting(true);

    const res = await fetch("/api/org/transfer-request/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    setAccepting(false);

    if (json?.success && json?.organization_id) {
      try {
        await reloadBootstrap();
      } catch {
        /* ignore */
      }
      router.replace("/app/projects");
      return;
    }
    if (json?.error === "expired" || json?.reason === "expired") {
      setState("expired");
      return;
    }
    if (json?.reason === "completed" || (typeof json?.error === "string" && json.error.includes("завершена"))) {
      setState("used");
      return;
    }
    if (json?.code === TRANSFER_EMAIL_MISMATCH_CODE) {
      setError(typeof json?.error === "string" ? json.error : "Email аккаунта не совпадает с письмом.");
      return;
    }
    setError(json?.error ?? "Не удалось получить доступ");
  }, [token, user, router, reloadBootstrap]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a]/95 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <div className="mx-auto h-10 w-48 rounded-xl bg-white/[0.06]" />
          <p className="mt-4 text-sm text-zinc-400">Проверка ссылки…</p>
        </div>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-500/25 bg-[#12121a]/95 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <p className="text-lg font-semibold text-white">Ссылка устарела</p>
          <p className="mt-2 text-sm text-zinc-400">
            Срок действия ссылки истёк. Попросите владельца организации отправить передачу повторно.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15"
          >
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (state === "revoked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a]/95 p-8 text-center">
          <p className="text-lg font-semibold text-white">Запрос отменён</p>
          <p className="mt-2 text-sm text-zinc-400">Эта передача была отменена. Запросите новую ссылку у владельца.</p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (state === "used") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-md rounded-2xl border border-emerald-500/20 bg-[#12121a]/95 p-8 text-center">
          <p className="text-lg font-semibold text-white">Передача уже завершена</p>
          <p className="mt-2 text-sm text-zinc-400">Эта ссылка уже была использована. Войдите в аккаунт, если вы новый владелец.</p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-emerald-600/90 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500">
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a]/95 p-8 text-center">
          <p className="text-lg font-semibold text-white">Недействительная ссылка</p>
          <p className="mt-2 text-sm text-zinc-400">Проверьте адрес из письма или запросите передачу снова.</p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15">
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (state !== "ready" || !info) return null;

  const nextEnc = encodeURIComponent(acceptPath(token));
  const loginUrl = `/login?next=${nextEnc}`;
  const loginInviteSignupUrl = `/login?invite=1&signup=1&next=${nextEnc}`;
  const setPasswordUrl = `/app/transfer/set-password?token=${encodeURIComponent(token)}`;

  const isEmailInvite = info.invite_type === "email" && info.invite_email;
  const emailMismatch =
    !!user &&
    isEmailInvite &&
    info.invite_email &&
    (user.email ?? "").trim().toLowerCase() !== info.invite_email;

  const showNewUserPasswordCta = !user && isEmailInvite && info.account_exists === false;
  const showExistingUserLogin = !user && isEmailInvite && info.account_exists === true;
  const showEmailUnknown = !user && isEmailInvite && info.account_exists === null;
  const showFallbackAuth = !user && !showNewUserPasswordCta && !showExistingUserLogin && !showEmailUnknown;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-md rounded-2xl border border-emerald-500/30 bg-[#12121a]/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <h1 className="text-xl font-semibold text-white">Передача организации</h1>
        {info.organization_name ? (
          <p className="mt-3 text-lg font-medium text-emerald-100/95">{info.organization_name}</p>
        ) : null}

        {!user ? (
          <div className="mt-6 space-y-3">
            {showNewUserPasswordCta ? (
              <>
                <p className="text-sm text-zinc-400">
                  Для адреса <span className="text-zinc-200">{info.invite_email}</span> ещё нет аккаунта. Создайте пароль,
                  затем вы сможете получить доступ к организации.
                </p>
                <Link
                  href={setPasswordUrl}
                  className="block w-full rounded-xl bg-emerald-600/90 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Создать пароль
                </Link>
                <p className="text-center text-xs text-zinc-500">Уже есть аккаунт на этот email?</p>
                <Link
                  href={loginUrl}
                  className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-zinc-200 hover:bg-white/[0.04]"
                >
                  Войти
                </Link>
              </>
            ) : null}

            {showExistingUserLogin ? (
              <>
                <p className="text-sm text-zinc-400">
                  Войдите под адресом <span className="text-zinc-200">{info.invite_email}</span>, чтобы подтвердить
                  получение организации.
                </p>
                <Link
                  href={loginUrl}
                  className="block w-full rounded-xl bg-emerald-600/90 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Войти
                </Link>
              </>
            ) : null}

            {showEmailUnknown ? (
              <>
                <p className="text-sm text-zinc-400">
                  Не удалось проверить, есть ли уже аккаунт. Если вы новый пользователь — создайте пароль; если аккаунт
                  есть — войдите.
                </p>
                <Link href={setPasswordUrl} className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15">
                  Создать пароль
                </Link>
                <Link href={loginUrl} className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-zinc-200 hover:bg-white/[0.04]">
                  Войти
                </Link>
              </>
            ) : null}

            {showFallbackAuth ? (
              <>
                <p className="text-sm text-zinc-400">Войдите или создайте аккаунт, чтобы продолжить.</p>
                <Link href={loginUrl} className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15">
                  Войти
                </Link>
                <Link
                  href={loginInviteSignupUrl}
                  className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-zinc-200 hover:bg-white/[0.04]"
                >
                  Регистрация
                </Link>
              </>
            ) : null}
          </div>
        ) : emailMismatch && isEmailInvite ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-amber-200/95">
              Вы вошли как <span className="font-medium">{user.email}</span>. Передача отправлена на{" "}
              <span className="font-medium">{info.invite_email}</span>. Выйдите и войдите под нужным email.
            </p>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut().then(() => router.refresh())}
              className="w-full rounded-xl bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/15"
            >
              Выйти из аккаунта
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100/95">
              После подтверждения вы станете <strong className="text-white">владельцем</strong> организации и получите
              полный контроль. Доступ прежнего владельца к этой организации и её проектам будет завершён.
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={accepting}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {accepting ? "Обработка…" : "Получить доступ"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
