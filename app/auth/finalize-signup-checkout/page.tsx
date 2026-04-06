"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";
import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";

function resolveSafeNext(nextRaw: string | null): string {
  if (typeof window === "undefined") return "/app/projects/onboarding";
  return safeAppNextTarget(nextRaw, window.location.origin) ?? "/app/projects/onboarding";
}

function FinalizeSignupCheckoutInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get("next");
  const finalizeError = searchParams.get("finalize_error");

  const [status, setStatus] = useState<"working" | "retry_webhook" | "error">("working");
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollCountRef = useRef(0);
  const tryFinalizeRef = useRef<() => Promise<boolean>>(async () => false);

  const tryFinalize = useCallback(async (): Promise<boolean> => {
    const safeNext = resolveSafeNext(nextRaw);
    setBusy(true);
    setDetail(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        router.replace(`/login?next=${encodeURIComponent(safeNext)}`);
        return false;
      }
      const res = await fetch("/api/auth/finalize-login-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        code?: string;
      };
      if (res.ok && j.success) {
        router.replace(safeNext);
        return true;
      }
      if (j.code === "subscription_not_active_yet" || res.status === 409) {
        setStatus("retry_webhook");
        setDetail(j.error ?? "Подтверждаем оплату на сервере — обычно до минуты.");
        return false;
      }
      setStatus("error");
      setDetail(
        j.error ??
          (finalizeError ? `Код: ${finalizeError}.` : "Не удалось подключить организацию к аккаунту.")
      );
      return false;
    } catch {
      setStatus("error");
      setDetail("Сеть недоступна. Проверьте соединение и попробуйте снова.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [finalizeError, nextRaw, router]);

  tryFinalizeRef.current = tryFinalize;

  useEffect(() => {
    void tryFinalizeRef.current();
  }, []);

  useEffect(() => {
    if (status !== "retry_webhook") return;
    const id = window.setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current > 45) {
        window.clearInterval(id);
        setStatus("error");
        setDetail("Оплата всё ещё не подтверждена. Напишите в поддержку или попробуйте позже.");
        return;
      }
      void tryFinalizeRef.current();
    }, 4000);
    return () => window.clearInterval(id);
  }, [status]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0b0b10",
        color: "rgba(245,245,250,0.92)",
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Завершаем подключение аккаунта
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(245,245,250,0.7)", marginBottom: 20 }}>
          {status === "working" && !detail && "Связываем ваш аккаунт с оплаченной организацией…"}
          {detail}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "stretch" }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void tryFinalize()}
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              border: "none",
              background: "rgba(99,102,241,0.85)",
              color: "white",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Подождите…" : "Повторить"}
          </button>
          <Link
            href="/app/support"
            style={{
              fontSize: 13,
              color: "rgba(180,200,255,0.95)",
              textDecoration: "underline",
            }}
          >
            Поддержка
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function FinalizeSignupCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0b0b10",
            color: "rgba(245,245,250,0.92)",
          }}
        >
          Загрузка…
        </div>
      }
    >
      <FinalizeSignupCheckoutInner />
    </Suspense>
  );
}
