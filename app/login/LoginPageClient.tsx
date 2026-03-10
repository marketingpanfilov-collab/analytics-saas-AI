"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

type Mode = "login" | "signup";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Куда редиректить после логина (middleware часто ставит ?next=/app)
  const nextPath = useMemo(() => {
    const n = searchParams.get("next");
    return n && n.startsWith("/") ? n : "/app";
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const onSubmit = async () => {
    setMsg("");

    if (!email.trim()) return setMsg("Введите email");
    if (!password.trim()) return setMsg("Введите пароль");

    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) return setMsg(error.message);

        router.replace(nextPath);
        return;
      }

      // signup
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) return setMsg(error.message);

      // Если в Supabase включено подтверждение почты — сессии сразу не будет.
      // Тогда покажем подсказку.
      if (!data.session) {
        setMsg("✅ Аккаунт создан. Проверь почту и подтвердите email, затем войдите.");
        setMode("login");
        return;
      }

      router.replace(nextPath);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setMsg("");

    if (!email.trim()) return setMsg("Введите email для восстановления пароля");

    setLoading(true);
    try {
      // На локалке так нормально. Потом для продакшена заменишь домен.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "http://localhost:3000/reset",
      });

      if (error) return setMsg(error.message);

      setMsg("✅ Письмо для сброса пароля отправлено. Проверь почту.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow} />

      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.h1}>{mode === "login" ? "Вход в аккаунт" : "Регистрация"}</div>
            <div style={styles.sub}>
              {mode === "login"
                ? "Зайдите, чтобы открыть панель отчётности и подключить рекламные аккаунты."
                : "Создайте аккаунт, чтобы начать собирать отчётность по рекламе в одном месте."}
            </div>
          </div>

          <div style={styles.segment}>
            <button
              type="button"
              onClick={() => setMode("login")}
              style={{
                ...styles.segmentBtn,
                ...(mode === "login" ? styles.segmentBtnActive : {}),
              }}
              disabled={loading}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              style={{
                ...styles.segmentBtn,
                ...(mode === "signup" ? styles.segmentBtnActive : {}),
              }}
              disabled={loading}
            >
              Регистрация
            </button>
          </div>
        </div>

        <div style={styles.form}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <label style={styles.label}>Пароль</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          <button
            type="button"
            onClick={onSubmit}
            style={{
              ...styles.primaryBtn,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            disabled={loading}
          >
            {loading ? "Подождите..." : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>

          <button
            type="button"
            onClick={resetPassword}
            style={styles.linkBtn}
            disabled={loading}
          >
            Забыли пароль?
          </button>

          {msg ? <div style={styles.message}>{msg}</div> : null}

          <div style={styles.footerNote}>© 2026 Analytics SaaS — Internal MVP</div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    background: "radial-gradient(1200px 700px at 70% 30%, rgba(88, 255, 202, 0.10), transparent 60%), #0b0b10",
    color: "rgba(255,255,255,0.92)",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    position: "relative",
    overflow: "hidden",
  },
  bgGlow: {
    position: "absolute",
    inset: -200,
    background:
      "radial-gradient(700px 700px at 20% 30%, rgba(106, 117, 255, 0.16), transparent 60%), radial-gradient(800px 800px at 80% 60%, rgba(88, 255, 202, 0.14), transparent 60%)",
    filter: "blur(20px)",
    pointerEvents: "none",
  },
  card: {
    width: "min(920px, 100%)",
    borderRadius: 28,
    background: "rgba(20, 20, 30, 0.72)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
    backdropFilter: "blur(14px)",
    padding: 28,
    position: "relative",
  },
  headerRow: {
    display: "flex",
    gap: 20,
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: 18,
  },
  h1: {
    fontSize: 34,
    fontWeight: 750,
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  sub: {
    maxWidth: 560,
    fontSize: 16,
    lineHeight: 1.5,
    opacity: 0.75,
  },
  segment: {
    display: "inline-flex",
    gap: 6,
    padding: 6,
    borderRadius: 999,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  segmentBtn: {
    border: "none",
    padding: "10px 14px",
    borderRadius: 999,
    background: "transparent",
    color: "rgba(255,255,255,0.72)",
    cursor: "pointer",
    fontWeight: 650,
  },
  segmentBtnActive: {
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.95)",
  },
  form: {
    display: "grid",
    gap: 12,
    paddingTop: 6,
    maxWidth: 520,
  },
  label: {
    fontSize: 14,
    opacity: 0.75,
    marginTop: 6,
  },
  input: {
    width: "100%",
    borderRadius: 14,
    padding: "14px 14px",
    background: "rgba(10,10,14,0.45)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
    fontSize: 16,
  },
  primaryBtn: {
    marginTop: 10,
    width: "100%",
    border: "none",
    borderRadius: 16,
    padding: "14px 16px",
    fontSize: 16,
    fontWeight: 800,
    color: "rgba(10,10,14,0.95)",
    background:
      "linear-gradient(90deg, rgba(106,117,255,0.95), rgba(88,255,202,0.95))",
  },
  linkBtn: {
    marginTop: 4,
    border: "none",
    background: "transparent",
    color: "rgba(168, 190, 255, 0.95)",
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    fontSize: 14,
    opacity: 0.95,
  },
  message: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(255, 90, 90, 0.20)",
    background: "rgba(255, 90, 90, 0.08)",
    fontSize: 14,
    opacity: 0.95,
  },
  footerNote: {
    marginTop: 12,
    fontSize: 12,
    opacity: 0.45,
  },
};
