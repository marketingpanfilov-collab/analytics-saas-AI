"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

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
};

export default function InviteAcceptClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [state, setState] = useState<"loading" | "ready" | "expired" | "invalid" | "revoked">(
    () => (token ? "loading" : "invalid")
  );
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (!token) return;

    let mounted = true;

    (async () => {
      const res = await fetch(
        `/api/project-invites/by-token?token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();

      if (!mounted) return;

      if (json?.success && json?.project_id) {
        setInvite({
          success: true,
          project_id: json.project_id,
          project_name: json.project_name ?? null,
          role: json.role,
          expires_at: json.expires_at,
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
      setState("invalid");
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (mounted) setUser(u ? { id: u.id } : null);
    });
    return () => { mounted = false; };
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
    setError(json?.error ?? "Ошибка принятия приглашения");
  }, [token, user, router]);

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
          <p className="mt-2 text-sm text-zinc-400">
            Это приглашение было отозвано и больше не действует.
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

  const loginUrl = `/login?next=${encodeURIComponent(`/app/invite/accept?token=${encodeURIComponent(token)}`)}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <h1 className="text-xl font-semibold text-white">Приглашение в проект</h1>
        {invite.project_name && (
          <p className="mt-2 text-lg text-zinc-200">{invite.project_name}</p>
        )}
        <p className="mt-1 text-sm text-zinc-400">
          Роль: {ROLE_LABELS[invite.role] ?? invite.role}
        </p>

        {!user ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-zinc-400">
              Войдите в аккаунт, чтобы принять приглашение.
            </p>
            <Link
              href={loginUrl}
              className="block w-full rounded-xl bg-white/10 py-3 text-center text-sm font-medium text-white hover:bg-white/15"
            >
              Войти и принять
            </Link>
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
