"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD ($)" },
  { value: "KZT", label: "KZT (₸)" },
];

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";

  const [currency, setCurrency] = useState<string>("USD");
  const [initialCurrency, setInitialCurrency] = useState<string>("USD");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          if (!mounted) return;
          setError(json?.error ?? "Не удалось загрузить валюту проекта");
          return;
        }
        if (!mounted) return;
        const curr = typeof json.currency === "string" ? json.currency.toUpperCase() : "USD";
        setCurrency(curr);
        setInitialCurrency(curr);
      } catch (e) {
        if (!mounted) return;
        setError("Не удалось загрузить валюту проекта");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  async function handleSave() {
    if (!projectId) return;
    if (currency === initialCurrency) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/projects/currency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, currency }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Не удалось сохранить валюту проекта");
        return;
      }
      setInitialCurrency(currency);
      setSavedMessage("Валюта проекта сохранена.");
      setTimeout(() => setSavedMessage(null), 2500);
    } catch (e) {
      setError("Не удалось сохранить валюту проекта");
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>⚙️ Настройки</h1>
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(15,15,25,0.95)",
            fontSize: 14,
            color: "rgba(255,255,255,0.8)",
          }}
        >
          Сначала выберите проект. Откройте страницу так: <code>/app/settings?project_id=...`</code>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>⚙️ Настройки проекта</h1>

      <section
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(10,10,18,0.96)",
          padding: 20,
          maxWidth: 520,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Валюта проекта</h2>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}>
          Выберите валюту отображения для бюджета, расходов и выручки в интерфейсе проекта.
        </p>

        {loading ? (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Загрузка…</div>
        ) : (
          <>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Валюта</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={saving}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(15,15,25,0.95)",
                  color: "white",
                  fontSize: 14,
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {error && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.5)",
                  background: "rgba(239,68,68,0.12)",
                  fontSize: 12,
                  color: "rgba(255,200,200,0.95)",
                }}
              >
                {error}
              </div>
            )}

            {savedMessage && !error && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(34,197,94,0.5)",
                  background: "rgba(34,197,94,0.12)",
                  fontSize: 12,
                  color: "rgba(209,250,229,0.95)",
                }}
              >
                {savedMessage}
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || currency === initialCurrency}
              style={{
                marginTop: 14,
                padding: "9px 16px",
                borderRadius: 10,
                border: "none",
                background:
                  saving || currency === initialCurrency
                    ? "rgba(120,120,255,0.25)"
                    : "rgba(120,120,255,0.45)",
                color: "white",
                fontWeight: 600,
                fontSize: 14,
                cursor: saving || currency === initialCurrency ? "default" : "pointer",
              }}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
