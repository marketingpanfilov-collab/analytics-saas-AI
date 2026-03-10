"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

function parseHashParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const hash = window.location.hash?.slice(1) || "";
  const params: Record<string, string> = {};
  hash.split("&").forEach((pair) => {
    const [k, v] = pair.split("=");
    if (k && v) params[k] = decodeURIComponent(v);
  });
  return params;
}

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [msgType, setMsgType] = useState<"error" | "success">("error");
  const [hasRecoveryToken, setHasRecoveryToken] = useState<boolean | null>(null);

  useEffect(() => {
    const params = parseHashParams();
    const accessToken = params.access_token;
    const type = params.type;
    setHasRecoveryToken(!!(accessToken && type === "recovery"));
  }, []);

  const onSubmit = async () => {
    setMsg("");
    setMsgType("error");

    if (!password.trim()) {
      setMsg("Введите новый пароль");
      return;
    }
    if (password.length < 6) {
      setMsg("Пароль должен быть не менее 6 символов");
      return;
    }
    if (password !== confirmPassword) {
      setMsg("Пароли не совпадают");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: password.trim() });

      if (error) {
        setMsg(error.message);
        return;
      }

      setMsgType("success");
      setMsg("Пароль успешно обновлён. Перенаправление на страницу входа…");
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Произошла ошибка");
    } finally {
      setLoading(false);
    }
  };

  const messageStyle =
    msgType === "success"
      ? { ...styles.message, borderColor: "rgba(90, 255, 150, 0.35)", background: "rgba(90, 255, 150, 0.08)" }
      : styles.message;

  if (hasRecoveryToken === null) {
    return (
      <div style={styles.page}>
        <div style={styles.bgGlow} />
        <div style={styles.card}>
          <div style={{ ...styles.h1, marginBottom: 12 }}>Сброс пароля</div>
          <div style={{ ...styles.sub, opacity: 0.8 }}>Загрузка…</div>
        </div>
      </div>
    );
  }

  if (hasRecoveryToken === false) {
    return (
      <div style={styles.page}>
        <div style={styles.bgGlow} />
        <div style={styles.card}>
          <div style={styles.headerRow}>
            <div>
              <div style={styles.h1}>Сброс пароля</div>
              <div style={styles.sub}>
                Недействительная или просроченная ссылка. Запросите новый сброс пароля на странице входа.
              </div>
            </div>
          </div>
          <a href="/login" style={{ ...styles.linkBtn, display: "inline-block", marginTop: 16 }}>
            Вернуться на страницу входа
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow} />

      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.h1}>Новый пароль</div>
            <div style={styles.sub}>
              Введите новый пароль для вашего аккаунта. После сохранения вы сможете войти с новым паролем.
            </div>
          </div>
        </div>

        <div style={styles.form}>
          <label style={styles.label}>Новый пароль</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />

          <label style={styles.label}>Подтвердите пароль</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
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
            {loading ? "Подождите…" : "Сохранить пароль"}
          </button>

          {msg ? <div style={messageStyle}>{msg}</div> : null}

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
    background: "linear-gradient(90deg, rgba(106,117,255,0.95), rgba(88,255,202,0.95))",
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
