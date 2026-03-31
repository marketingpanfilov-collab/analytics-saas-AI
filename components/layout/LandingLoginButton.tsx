"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/app/lib/supabaseClient";
import { cn } from "@/components/landing/BaseButton";

type Variant = "primary" | "primaryEmerald" | "secondary" | "outline";

export function LandingLoginButton({
  variant = "outline",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setIsAuthed(Boolean(data.session));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleClick = useCallback(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase.auth.getSession();
      const hasSession = Boolean(data.session);
      setIsAuthed(hasSession);
      router.push(hasSession ? "/app/projects" : "/login");
    })();
  }, [router]);

  const label = loading ? (isAuthed ? "Авторизация..." : "Подождите…") : "Войти";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "relative inline-flex h-12 cursor-pointer items-center justify-center rounded-xl px-6",
        "text-sm font-extrabold transition",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
        "min-w-[148px]",
        variant === "primary" &&
          "border border-[rgba(34,197,94,0.36)] bg-[rgba(34,197,94,0.18)] text-white shadow-[0_10px_30px_rgba(34,197,94,0.14)] hover:bg-[rgba(34,197,94,0.26)] hover:shadow-[0_0_30px_rgba(34,197,94,0.18)]",
        variant === "primaryEmerald" &&
          "border border-emerald-400/40 bg-emerald-500/[0.18] text-white shadow-[0_10px_30px_rgba(16,185,129,0.16)] hover:bg-emerald-500/[0.28] hover:shadow-[0_0_30px_rgba(16,185,129,0.22)]",
        variant === "secondary" &&
          "border border-white/12 bg-white/8 text-white/92 hover:bg-white/12",
        variant === "outline" &&
          "border border-white/12 bg-transparent text-white/78 hover:bg-white/6",
        className
      )}
    >
      <span className="invisible">Авторизация...</span>
      <span className="absolute inset-0 inline-flex items-center justify-center">{label}</span>
    </button>
  );
}
