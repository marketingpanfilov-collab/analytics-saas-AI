"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  broadcastBillingBootstrapInvalidate,
  type BillingBootstrapApiOk,
} from "@/app/lib/billingBootstrapClient";
import { emitBillingFunnelEvent } from "@/app/lib/billingFunnelAnalytics";
import { getCompanySizeSelectOptions } from "@/app/lib/companySize";
import { getCompanySphereGroupedSelect } from "@/app/lib/companySphere";
import { useBillingBootstrap } from "./BillingBootstrapProvider";

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
  padding: 20,
};

const panelStyle: CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(700px 320px at 50% 0%, rgba(96,96,180,0.22), transparent 55%), rgba(14,14,22,0.98)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  maxWidth: 520,
  width: "100%",
  maxHeight: "min(90vh, 720px)",
  overflowY: "auto",
  padding: "24px 22px 22px",
};

const inputBase: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(15,15,25,0.95)",
  color: "white",
  fontSize: 14,
  boxSizing: "border-box",
};

function planLabel(plan: string | null | undefined): string {
  const p = String(plan ?? "").toLowerCase();
  if (p === "starter") return "Starter";
  if (p === "growth") return "Growth";
  if (p === "scale" || p === "agency") return "Scale";
  return p || "—";
}

function resolvePlanDisplayName(b: BillingBootstrapApiOk | null): string {
  if (!b) return "—";
  const ep = b.effective_plan;
  if (ep && ep !== "unknown") return planLabel(String(ep));
  const sp = b.subscription?.plan;
  if (sp) return planLabel(sp);
  const matrix = b.plan_feature_matrix?.plan;
  if (matrix && matrix !== "unknown") return planLabel(String(matrix));
  return "—";
}

function resolvePlanForAnalytics(b: BillingBootstrapApiOk | null): string | null {
  if (!b) return null;
  const ep = b.effective_plan;
  if (ep && ep !== "unknown") return String(ep);
  if (b.subscription?.plan) return String(b.subscription.plan);
  const matrix = b.plan_feature_matrix?.plan;
  if (matrix && matrix !== "unknown") return String(matrix);
  return null;
}

export default function PostCheckoutOnboardingModal() {
  const router = useRouter();
  const { showPostCheckoutModal, bootstrap, loading: bootstrapLoading, reloadBootstrap } =
    useBillingBootstrap();
  const suppressBootstrapSyncRef = useRef(false);
  const postCheckoutStartedEmittedRef = useRef(false);
  /** Уже показывали модалку пост-чекаута: не прятать её при reloadBootstrap (bootstrapLoading). */
  const postCheckoutFlowActiveRef = useRef(false);
  const postCheckoutCompleteSubmittedRef = useRef(false);
  const [gate, setGate] = useState<"loading" | "skip" | "modal" | "success">("loading");
  const [step, setStep] = useState(1);
  const [accountEmail, setAccountEmail] = useState("");
  const [planName, setPlanName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [companySphere, setCompanySphere] = useState("");
  const [companySize, setCompanySize] = useState("");

  const companySphereGrouped = useMemo(
    () => getCompanySphereGroupedSelect(companySphere === ""),
    [companySphere]
  );
  const companySizeOptions = useMemo(() => getCompanySizeSelectOptions(false), []);

  const syncFromBootstrap = useCallback(async () => {
    setErr(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      setAccountEmail(u.user?.email ?? "");
    } catch {
      setAccountEmail("");
    }
    if (suppressBootstrapSyncRef.current) {
      return;
    }
    if (bootstrapLoading) {
      if (showPostCheckoutModal && postCheckoutFlowActiveRef.current) {
        return;
      }
      setGate("loading");
      return;
    }
    if (!showPostCheckoutModal) {
      postCheckoutFlowActiveRef.current = false;
      setGate("skip");
      return;
    }
    postCheckoutFlowActiveRef.current = true;
    setGate("modal");
    const fromProgress = bootstrap?.onboarding_progress?.step;
    const s = Math.min(
      3,
      Math.max(
        1,
        typeof fromProgress === "number" ? fromProgress : Number(bootstrap?.post_checkout_onboarding_step) || 1
      )
    );
    setStep((prev) => Math.min(3, Math.max(prev, s)));
    setPlanName(resolvePlanDisplayName(bootstrap ?? null));
  }, [bootstrap, bootstrapLoading, showPostCheckoutModal]);

  useEffect(() => {
    void syncFromBootstrap();
  }, [syncFromBootstrap]);

  useEffect(() => {
    if (gate !== "modal" || !showPostCheckoutModal || postCheckoutStartedEmittedRef.current) return;
    postCheckoutStartedEmittedRef.current = true;
    const plan = resolvePlanForAnalytics(bootstrap ?? null);
    void supabase.auth.getUser().then(({ data: u }) => {
      emitBillingFunnelEvent("billing_post_checkout_onboarding_started", {
        user_id: u.user?.id ?? null,
        organization_id: bootstrap?.primary_org_id ?? null,
        plan,
        billing_period: bootstrap?.subscription?.billing_period ?? null,
        source: "in_app",
      });
    });
  }, [
    gate,
    showPostCheckoutModal,
    bootstrap?.primary_org_id,
    bootstrap?.effective_plan,
    bootstrap?.plan_feature_matrix?.plan,
    bootstrap?.subscription?.plan,
    bootstrap?.subscription?.billing_period,
  ]);

  useEffect(() => {
    if (gate !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [gate]);

  const postJson = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/billing/post-checkout-onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error((j as { error?: string }).error ?? "Запрос не выполнен");
    }
    return j;
  };

  const onAdvance = async (next: number) => {
    setSaving(true);
    setErr(null);
    try {
      await postJson({ action: "advance_step", step: next });
      setStep(next);
      await reloadBootstrap();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onSaveCompany = async () => {
    setSaving(true);
    setErr(null);
    try {
      await postJson({
        action: "save_company",
        name: companyName.trim(),
        owner_full_name: ownerFullName.trim(),
        contact_phone: contactPhone.trim(),
        company_sphere: companySphere,
        company_size: companySize,
      });
      setStep(3);
      await reloadBootstrap();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onComplete = async () => {
    if (postCheckoutCompleteSubmittedRef.current) return;
    setSaving(true);
    setErr(null);
    try {
      await postJson({ action: "complete" });
      postCheckoutCompleteSubmittedRef.current = true;
      suppressBootstrapSyncRef.current = true;
      postCheckoutFlowActiveRef.current = false;
      const pack = await reloadBootstrap();
      const fresh = pack.bootstrap;
      const { data: u } = await supabase.auth.getUser();
      const plan = resolvePlanForAnalytics(fresh ?? bootstrap);
      emitBillingFunnelEvent("billing_post_checkout_onboarding_completed", {
        user_id: u.user?.id ?? null,
        organization_id: fresh?.primary_org_id ?? bootstrap?.primary_org_id ?? null,
        plan,
        billing_period: fresh?.subscription?.billing_period ?? bootstrap?.subscription?.billing_period ?? null,
        source: "in_app",
      });
      setPlanName(resolvePlanDisplayName(fresh ?? bootstrap));
      setGate("success");
      broadcastBillingBootstrapInvalidate();
      void reloadBootstrap();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const exitSuccessToProduct = async (path: string) => {
    suppressBootstrapSyncRef.current = false;
    setGate("skip");
    await reloadBootstrap();
    void router.refresh();
    router.replace(path);
  };

  const step2Valid =
    companyName.trim().length > 0 &&
    ownerFullName.trim().length > 0 &&
    companySphere.trim().length > 0 &&
    companySize.trim().length > 0;

  if (gate === "skip" || gate === "loading") return null;

  if (gate === "success") {
    return (
      <div
        style={overlayStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-checkout-success-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(52,211,153,0.2)",
              border: "1px solid rgba(52,211,153,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 26,
            }}
            aria-hidden
          >
            ✓
          </div>
          <h2 id="post-checkout-success-title" style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px", textAlign: "center" }}>
            Готово
          </h2>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.55, margin: "0 0 8px", textAlign: "center" }}>
            Подписка подключена. Организация готова к работе.
          </p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.45, margin: "0 0 22px", textAlign: "center" }}>
            Можно переходить к проектам или дашборду.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              type="button"
              onClick={() => void exitSuccessToProduct("/app/projects")}
              style={{
                padding: "12px 18px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, rgba(99,102,241,0.85), rgba(52,211,153,0.5))",
                color: "white",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Открыть проекты
            </button>
            <button
              type="button"
              onClick={() => void exitSuccessToProduct("/app")}
              style={{
                padding: "12px 18px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Перейти в дашборд
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-checkout-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
          Шаг {step} из 3
        </div>

        {step === 1 && (
          <>
            <h2 id="post-checkout-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px" }}>
              Спасибо, подписка оформлена
            </h2>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.5, marginBottom: 14 }}>
              Ваш тариф: <strong style={{ color: "white" }}>{planName}</strong>. Осталось несколько шагов, чтобы
              настроить рабочее пространство.
            </p>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(120,120,255,0.12)",
                border: "1px solid rgba(120,120,255,0.25)",
                fontSize: 13,
                color: "rgba(226,232,255,0.95)",
                marginBottom: 20,
              }}
            >
              Дальше — профиль компании и краткая инструкция. Это не оплата и не ошибка доступа, а стартовая
              настройка после покупки.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => onAdvance(2)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "rgba(120,120,255,0.5)",
                  color: "white",
                  fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                Далее
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 id="post-checkout-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px" }}>
              Данные компании
            </h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", marginBottom: 16 }}>
              Те же поля, что в разделе «Настройки → Компания». Email аккаунта подставляется автоматически.
            </p>

            <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Email</span>
              <input type="email" value={accountEmail} readOnly disabled style={{ ...inputBase, opacity: 0.7 }} />
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Название компании</span>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                style={inputBase}
                autoComplete="organization"
              />
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>ФИО контактного лица</span>
              <input
                type="text"
                value={ownerFullName}
                onChange={(e) => setOwnerFullName(e.target.value)}
                style={inputBase}
              />
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Телефон</span>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                style={inputBase}
                autoComplete="tel"
              />
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Сфера компании</span>
              <select
                className="settings-page-select"
                value={companySphere}
                onChange={(e) => setCompanySphere(e.target.value)}
                style={{ ...inputBase, cursor: "pointer" }}
              >
                {companySphereGrouped.includeUnset && <option value="">Выберите…</option>}
                {companySphereGrouped.groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 16 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Количество сотрудников</span>
              <select
                className="settings-page-select"
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                style={{ ...inputBase, cursor: "pointer" }}
              >
                {companySizeOptions.map((opt) => (
                  <option key={opt.value || "e"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {err && (
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.5)",
                  background: "rgba(239,68,68,0.12)",
                  fontSize: 12,
                  color: "rgba(255,200,200,0.95)",
                  marginBottom: 12,
                }}
              >
                {err}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => onAdvance(1)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "white",
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                Назад
              </button>
              <button
                type="button"
                disabled={saving || !step2Valid}
                onClick={() => void onSaveCompany()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: !step2Valid ? "rgba(120,120,255,0.25)" : "rgba(120,120,255,0.5)",
                  color: "white",
                  fontWeight: 600,
                  cursor: saving || !step2Valid ? "not-allowed" : "pointer",
                }}
              >
                Далее
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 id="post-checkout-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px" }}>
              Как начать
            </h2>
            <ul
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.78)",
                lineHeight: 1.55,
                paddingLeft: 18,
                margin: "0 0 16px",
              }}
            >
              <li>Создайте первый проект и выберите его в интерфейсе.</li>
              <li>Подключите рекламные кабинеты (Meta, Google, TikTok) в настройках интеграций.</li>
              <li>Нажмите обновление данных на дашборде, чтобы подтянуть статистику.</li>
            </ul>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 18 }}>
              Полный гид по продукту можно добавить позже на странице помощи — здесь главное, с чего начать.
            </p>
            {err && (
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.5)",
                  background: "rgba(239,68,68,0.12)",
                  fontSize: 12,
                  color: "rgba(255,200,200,0.95)",
                  marginBottom: 12,
                }}
              >
                {err}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onAdvance(2)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "white",
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                Назад
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onComplete()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "rgba(34,197,94,0.45)",
                  color: "white",
                  fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                Перейти в продукт
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
