"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";
import { useBillingBootstrap } from "../../../components/BillingBootstrapProvider";

const INVITE_EMAIL_MISMATCH_CODE = "INVITE_EMAIL_MISMATCH";

const ROLE_LABELS: Record<string, string> = {
  project_admin: "Админ проекта",
  marketer: "Маркетолог",
  viewer: "Наблюдатель",
};

type InviteInfo = {
  success: true;
  project_id: string;
  project_name: string | null;
  role: string;
  expires_at: string;
  invite_type: string;
  invite_email: string | null;
  account_exists: boolean | null;
};

function acceptPath(token: string) {
  return `/app/invite/accept?token=${encodeURIComponent(token)}`;
}

export default function InviteAcceptClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { reloadBootstrap } = useBillingBootstrap();
  const token = searchParams.get("token")?.trim() ?? "";

  const [state, setState] = useState<
    "loading" | "ready" | "expired" | "invalid" | "revoked" | "used"
  >(() => (token ? "loading" : "invalid"));
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);

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
        setInvite({
          success: true,
          project_id: json.project_id,
          project_name: json.project_name ?? null,
          role: json.role,
          expires_at: json.expires_at,
          invite_type: String(json.invite_type ?? "email"),
          invite_email: typeof json.invite_email === "string" ? json.invite_email : null,
          account_exists: typeof json.account_exists === "boolean" ? json.account_exists : null,
        });
        setState("ready");
        return;
      }

      if (json?.reason === "expired" || json?.error === "expired") {
        setState("expired");
        return;
      }
      if (json?.reason === "revoked" || json?.status === "revoked") {
        setState("revoked");
        return;
      }
      if (json?.reason === "accepted" || json?.status === "accepted") {
        setState("used");
        return;
      }
      setState("invalid");
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

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

    const res = await fetch("/api/project-invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    setAccepting(false);

    if (json?.success && json?.project_id) {
      router.replace(`/app?project_id=${encodeURIComponent(json.project_id)}`);
      return;
    }
    if (json?.error === "expired" || json?.reason === "expired") {
      setState("expired");
      return;
    }
    if (json?.error === "invalid" || json?.reason === "revoked") {
      setState("revoked");
      return;
    }
    if (json?.code === INVITE_EMAIL_MISMATCH_CODE) {
      setError(typeof json?.error === "string" ? json.error : "Email аккаунта не совпадает с приглашением.");
      return;
    }
    setError(json?.error ?? "Ошибка принятия приглашения");
  }, [token, user, router, reloadBootstrap]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <div className="mx-auto h-10 w-48 rounded-xl bg-white/[0.06]" />
          <p className="mt-4 text-sm text-zinc-400">Проверка приглашения…</p>
        </div>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-lg font-medium text-white">Приглашение истекло</p>
          <p className="mt-2 text-sm text-zinc-400">
            Срок действия ссылки истёк (30 минут). Запросите новое приглашение у владельца проекта.
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
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-lg font-medium text-white">Приглашение отозвано</p>
          <p className="mt-2 text-sm text-zinc-400">Это приглашение было отозвано и больше не действует.</p>
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

  if (state === "used") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-lg font-medium text-white">Приглашение уже использовано</p>
          <p className="mt-2 text-sm text-zinc-400">
            Эта ссылка больше не активна. Если вы уже в проекте — войдите в аккаунт.
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

  if (state === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-lg font-medium text-white">Недействительное приглашение</p>
          <p className="mt-2 text-sm text-zinc-400">
            Ссылка не найдена или некорректна. Проверьте URL или запросите новое приглашение.
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

  if (state !== "ready" || !invite) return null;

  const nextEnc = encodeURIComponent(acceptPath(token));
  const loginUrl = `/login?next=${nextEnc}`;
  const loginInviteSignupUrl = `/login?invite=1&signup=1&next=${nextEnc}`;
  const setPasswordUrl = `/app/invite/set-password?token=${encodeURIComponent(token)}`;

  const isEmailInvite = invite.invite_type === "email" && invite.invite_email;
  const emailMismatch =
    !!user &&
    isEmailInvite &&
    invite.invite_email &&
    (user.email ?? "").trim().toLowerCase() !== invite.invite_email;

  const showNewUserPasswordCta = !user && isEmailInvite && invite.account_exists === false;
  const showExistingUserLogin = !user && isEmailInvite && invite.account_exists === true;
  const showEmailUnknown = !user && isEmailInvite && invite.account_exists === null;
  const showLinkInvite = !user && invite.invite_type === "link";
  const showFallbackAuth =
    !user &&
    !showNewUserPasswordCta &&
    !showExistingUserLogin &&
    !showEmailUnknown &&
    !showLinkInvite;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <h1 className="text-xl font-semibold text-white">Приглашение в проект</h1>
        {invite.project_name && <p className="mt-2 text-lg text-zinc-200">{invite.project_name}</p>}
        <p className="mt-1 text-sm text-zinc-400">Роль: {ROLE_LABELS[invite.role] ?? invite.role}</p>

        {!user ? (
          <div className="mt-6 space-y-3">
            {showNewUserPasswordCta ? (
              <>
                <p className="text-sm text-zinc-400">
                  Для адреса <span className="text-zinc-200">{invite.invite_email}</span> ещё нет аккаунта. Создайте
                  пароль, чтобы завершить регистрацию и принять приглашение.
                </p>
                <Link
                  href={setPasswordUrl}
                  className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15"
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
                  Войдите под адресом <span className="text-zinc-200">{invite.invite_email}</span>, чтобы принять
                  приглашение.
                </p>
                <Link
                  href={loginUrl}
                  className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15"
                >
                  Войти и принять
                </Link>
              </>
            ) : null}

            {showEmailUnknown ? (
              <>
                <p className="text-sm text-zinc-400">
                  Не удалось проверить, есть ли уже аккаунт для этого email. Если вы новый пользователь — создайте
                  пароль; если аккаунт уже есть — войдите.
                </p>
                <Link
                  href={setPasswordUrl}
                  className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15"
                >
                  Создать пароль
                </Link>
                <Link
                  href={loginUrl}
                  className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-zinc-200 hover:bg-white/[0.04]"
                >
                  Войти
                </Link>
              </>
            ) : null}

            {showLinkInvite ? (
              <>
                <p className="text-sm text-zinc-400">
                  Войдите в существующий аккаунт или зарегистрируйтесь без выбора тарифа, чтобы принять приглашение по
                  ссылке.
                </p>
                <Link
                  href={loginUrl}
                  className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15"
                >
                  Войти
                </Link>
                <Link
                  href={loginInviteSignupUrl}
                  className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-zinc-200 hover:bg-white/[0.04]"
                >
                  Создать аккаунт (по приглашению)
                </Link>
              </>
            ) : null}

            {showFallbackAuth ? (
              <>
                <p className="text-sm text-zinc-400">Войдите или создайте аккаунт, чтобы принять приглашение.</p>
                <Link
                  href={loginUrl}
                  className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15"
                >
                  Войти
                </Link>
                <Link
                  href={loginInviteSignupUrl}
                  className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-zinc-200 hover:bg-white/[0.04]"
                >
                  Создать аккаунт (по приглашению)
                </Link>
              </>
            ) : null}
          </div>
        ) : emailMismatch && isEmailInvite ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-amber-200/95">
              Вы вошли как <span className="font-medium">{user.email}</span>. Приглашение отправлено на{" "}
              <span className="font-medium">{invite.invite_email}</span>. Выйдите и войдите под нужным email или
              обратитесь к владельцу проекта.
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
          <div className="mt-6 space-y-3">
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handleAccept}
              disabled={accepting}
              className="w-full rounded-xl bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
            >
              {accepting ? "Принятие…" : "Принять приглашение"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
