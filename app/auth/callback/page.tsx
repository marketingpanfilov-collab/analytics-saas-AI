"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";

const DEFAULT_NEXT = "/app/projects";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hint, setHint] = useState("Завершение входа…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const origin = window.location.origin;
      const nextRaw = searchParams.get("next");
      const safeNext = safeAppNextTarget(nextRaw, origin) ?? DEFAULT_NEXT;

      const err = searchParams.get("error");
      const errDesc = searchParams.get("error_description");
      if (err) {
        const login = new URL("/login", origin);
        login.searchParams.set("auth_error", err);
        if (errDesc) login.searchParams.set("auth_error_description", errDesc.slice(0, 400));
        login.searchParams.set("next", safeNext);
        router.replace(`${login.pathname}${login.search}`);
        return;
      }

      try {
        await supabase.auth.initialize();
      } catch {
        const login = new URL("/login", origin);
        login.searchParams.set("auth_error", "exchange_failed");
        login.searchParams.set("next", safeNext);
        router.replace(`${login.pathname}${login.search}`);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!session?.user) {
        const login = new URL("/login", origin);
        login.searchParams.set("auth_hint", "missing_code");
        login.searchParams.set("next", safeNext);
        router.replace(`${login.pathname}${login.search}`);
        return;
      }

      setHint("Подключаем аккаунт…");
      const cont = await fetch("/api/auth/email-callback-continue", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next: nextRaw }),
      });
      const j = (await cont.json().catch(() => null)) as { ok?: boolean; redirect?: string } | null;
      if (cancelled) return;
      if (!cont.ok || !j?.ok || !j.redirect) {
        router.replace(safeNext);
        return;
      }
      router.replace(j.redirect.startsWith("/") ? j.redirect : safeNext);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-400">
      <p className="text-zinc-200">{hint}</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">Загрузка…</div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
