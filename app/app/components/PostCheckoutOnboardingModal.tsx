"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { broadcastBillingBootstrapInvalidate } from "@/app/lib/billingBootstrapClient";
import { emitBillingFunnelEvent } from "@/app/lib/billingFunnelAnalytics";
import { COMPANY_SIZE_VALUES, getCompanySizeSelectOptions } from "@/app/lib/companySize";
import { COMPANY_SPHERE_KEYS, getCompanySphereGroupedSelect } from "@/app/lib/companySphere";
import { resolveBootstrapPlanAnalyticsSlug } from "@/app/lib/billingBootstrapPlanLabel";
import { useBillingBootstrap } from "./BillingBootstrapProvider";

const DEFAULT_COMPANY_SIZE = COMPANY_SIZE_VALUES[0];
const DEFAULT_COMPANY_SPHERE = COMPANY_SPHERE_KEYS[0] ?? "";

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

type Gate = "boot" | "skip" | "flow" | "success";

function primaryCtaStyle(loading: boolean, enabled: boolean): CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: 12,
    border: "none",
    background: enabled && !loading ? "rgba(120,120,255,0.55)" : "rgba(120,120,255,0.28)",
    color: "white",
    fontWeight: 700,
    fontSize: 14,
    cursor: loading || !enabled ? "not-allowed" : "pointer",
    minHeight: 44,
  };
}

function secondaryCtaStyle(loading: boolean): CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "transparent",
    color: "white",
    fontWeight: 600,
    fontSize: 14,
    cursor: loading ? "not-allowed" : "pointer",
    minHeight: 44,
  };
}

function FieldHint({ children }: { children: string }) {
  return (
    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>{children}</span>
  );
}

/** Post-checkout onboarding UI только на первом продуктовом входе (список проектов / подложка onboarding). */
export function isPostCheckoutOnboardingModalHostPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/app/projects" || pathname === "/app/projects/onboarding";
}

function PostCheckoutOnboardingModalInner() {
  const router = useRouter();
  const { bootstrap, loading: bootstrapLoading, reloadBootstrap } = useBillingBootstrap();
  const suppressBootstrapSyncRef = useRef(false);
  const postCheckoutStartedEmittedRef = useRef(false);
  const postCheckoutFlowActiveRef = useRef(false);
  const postCheckoutCompleteSubmittedRef = useRef(false);
  const step2SubmitLockRef = useRef(false);

  const [gate, setGate] = useState<Gate>("boot");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [companySphere, setCompanySphere] = useState(DEFAULT_COMPANY_SPHERE);
  const [companySize, setCompanySize] = useState<string>(DEFAULT_COMPANY_SIZE);

  const companySphereGrouped = useMemo(
    () => getCompanySphereGroupedSelect(false),
    []
  );
  const companySizeOptions = useMemo(() => getCompanySizeSelectOptions(false), []);

  const syncFromBootstrap = useCallback(() => {
    setErr(null);
    if (suppressBootstrapSyncRef.current) return;

    if (bootstrapLoading) {
      if (postCheckoutFlowActiveRef.current) return;
      setGate("boot");
      return;
    }

    if (bootstrap?.requires_post_checkout_onboarding === false) {
      postCheckoutFlowActiveRef.current = false;
      setGate("skip");
      return;
    }

    if (bootstrap?.requires_post_checkout_onboarding === true) {
      postCheckoutFlowActiveRef.current = true;
      setGate((g) => (g === "success" ? g : "flow"));
      const fromProgress = bootstrap.onboarding_progress?.step;
      const s = Math.min(
        3,
        Math.max(
          1,
          typeof fromProgress === "number" ? fromProgress : Number(bootstrap.post_checkout_onboarding_step) || 1
        )
      );
      setStep((prev) => Math.min(3, Math.max(prev, s)));
    }
  }, [bootstrap, bootstrapLoading]);

  useEffect(() => {
    syncFromBootstrap();
  }, [syncFromBootstrap]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data: u }) => {
      const n = u.user?.user_metadata?.full_name;
      if (typeof n === "string" && n.trim()) setOwnerFullName((prev) => (prev.trim() ? prev : n.trim()));
    });
  }, []);

  useEffect(() => {
    if (gate !== "flow" || postCheckoutStartedEmittedRef.current) return;
    if (bootstrap?.requires_post_checkout_onboarding !== true) return;
    postCheckoutStartedEmittedRef.current = true;
    const plan = resolveBootstrapPlanAnalyticsSlug(bootstrap ?? null);
    void supabase.auth.getUser().then(({ data: u }) => {
      emitBillingFunnelEvent("billing_post_checkout_onboarding_started", {
        user_id: u.user?.id ?? null,
        organization_id: bootstrap?.primary_org_id ?? null,
        plan,
        billing_period: bootstrap?.subscription?.billing_period ?? null,
        source: "in_app",
      });
    });
  }, [gate, bootstrap]);

  useEffect(() => {
    if (gate !== "flow") return;
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

  const onStep1Continue = () => {
    if (saving) return;
    setStep(2);
  };

  const onSaveCompany = async () => {
    if (saving || step2SubmitLockRef.current || !step2Valid) return;
    step2SubmitLockRef.current = true;
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      step2SubmitLockRef.current = false;
    }
  };

  const onStep3Finish = async () => {
    if (postCheckoutCompleteSubmittedRef.current || saving) return;
    postCheckoutCompleteSubmittedRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      await postJson({ action: "complete" });
      suppressBootstrapSyncRef.current = true;
      let pack = await reloadBootstrap();
      if (pack.bootstrap?.requires_post_checkout_onboarding !== false) {
        await new Promise((r) => setTimeout(r, 450));
        pack = await reloadBootstrap();
      }
      if (pack.bootstrap?.requires_post_checkout_onboarding !== false) {
        throw new Error("Не удалось подтвердить завершение. Обновите страницу.");
      }
      postCheckoutFlowActiveRef.current = false;
      const { data: u } = await supabase.auth.getUser();
      const plan = resolveBootstrapPlanAnalyticsSlug(pack.bootstrap ?? bootstrap);
      emitBillingFunnelEvent("billing_post_checkout_onboarding_completed", {
        user_id: u.user?.id ?? null,
        organization_id: pack.bootstrap?.primary_org_id ?? bootstrap?.primary_org_id ?? null,
        plan,
        billing_period:
          pack.bootstrap?.subscription?.billing_period ?? bootstrap?.subscription?.billing_period ?? null,
        source: "in_app",
      });
      setGate("success");
      broadcastBillingBootstrapInvalidate();
    } catch (e) {
      postCheckoutCompleteSubmittedRef.current = false;
      suppressBootstrapSyncRef.current = false;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const exitSuccessToProjects = async () => {
    if (saving) return;
    setSaving(true);
    try {
      suppressBootstrapSyncRef.current = false;
      setGate("skip");
      await router.refresh();
      router.replace("/app/projects");
    } finally {
      setSaving(false);
    }
  };

  const step2Valid =
    companyName.trim().length > 0 &&
    ownerFullName.trim().length > 0 &&
    companySphere.trim().length > 0 &&
    companySize.trim().length > 0;

  if (gate === "skip") return null;

  if (gate === "boot") {
    return (
      <div style={overlayStyle} role="dialog" aria-modal="true" aria-busy="true" aria-label="Загрузка">
        <div style={panelStyle}>
          <p style={{ margin: 0, textAlign: "center", fontSize: 15, color: "rgba(255,255,255,0.75)" }}>
            Подождите…
          </p>
        </div>
      </div>
    );
  }

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
          <h2
            id="post-checkout-success-title"
            style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px", textAlign: "center" }}
          >
            Готово
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.78)",
              lineHeight: 1.55,
              margin: "0 0 24px",
              textAlign: "center",
            }}
          >
            Рабочее пространство создано. Можно переходить к настройке проекта.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void exitSuccessToProjects()}
            style={{ ...primaryCtaStyle(saving, true), width: "100%" }}
          >
            {saving ? "Подождите…" : "Открыть проекты"}
          </button>
        </div>
      </div>
    );
  }

  const errBox =
    err != null ? (
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
    ) : null;

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-checkout-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>Шаг {step} из 3</div>

        <div className="pco-onboarding-step" key={step}>
          {step === 1 && (
            <>
              <h2 id="post-checkout-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>
                Подписка активирована
              </h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.55, margin: "0 0 24px" }}>
                Остался один шаг — настроим рабочее пространство под ваш бизнес.
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={onStep1Continue}
                style={{ ...primaryCtaStyle(saving, true), width: "100%" }}
              >
                {saving ? "Подождите…" : "Продолжить настройку"}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 id="post-checkout-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>
                Настройка рабочего пространства
              </h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.72)", lineHeight: 1.55, margin: "0 0 18px" }}>
                Эти данные помогут корректно настроить аналитику и структуру проектов.
              </p>

              <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 14 }}>
                <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 600 }}>Название компании</span>
                <FieldHint>Как будет отображаться в системе</FieldHint>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  style={inputBase}
                  autoComplete="organization"
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 14 }}>
                <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 600 }}>Контактное лицо</span>
                <FieldHint>Кто отвечает за работу с аналитикой</FieldHint>
                <input
                  type="text"
                  value={ownerFullName}
                  onChange={(e) => setOwnerFullName(e.target.value)}
                  style={inputBase}
                  autoComplete="name"
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 14 }}>
                <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 600 }}>Телефон</span>
                <FieldHint>Нужен только для связи при необходимости</FieldHint>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  style={inputBase}
                  autoComplete="tel"
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 14 }}>
                <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 600 }}>Сфера бизнеса</span>
                <FieldHint>Выберите направление</FieldHint>
                <select
                  className="settings-page-select"
                  value={companySphere}
                  onChange={(e) => setCompanySphere(e.target.value)}
                  style={{ ...inputBase, cursor: "pointer" }}
                >
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

              <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 16 }}>
                <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 600 }}>Размер команды</span>
                <FieldHint>Влияет на рекомендации внутри системы</FieldHint>
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

              {errBox}

              <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStep(1)}
                  style={secondaryCtaStyle(saving)}
                >
                  {saving ? "Подождите…" : "Назад"}
                </button>
                <button
                  type="button"
                  disabled={saving || !step2Valid}
                  onClick={() => void onSaveCompany()}
                  style={primaryCtaStyle(saving, step2Valid)}
                >
                  {saving ? "Подождите…" : "Далее"}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 id="post-checkout-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>
                Вы готовы к работе
              </h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.55, margin: "0 0 14px" }}>
                Выполните несколько шагов, чтобы запустить аналитику и получать точные данные:
              </p>
              <ul
                style={{
                  fontSize: 14,
                  color: "rgba(255,255,255,0.82)",
                  lineHeight: 1.55,
                  margin: "0 0 22px",
                  padding: 0,
                  listStyle: "none",
                  display: "grid",
                  gap: 10,
                }}
              >
                {[
                  "Создайте первый проект",
                  "Подключите рекламные источники (Meta, Google, TikTok)",
                  "Установите Pixel на сайт",
                  "Настройте передачу событий (регистрация, покупки)",
                ].map((text) => (
                  <li
                    key={text}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      margin: 0,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        flexShrink: 0,
                        width: 6,
                        height: 6,
                        marginTop: "0.45em",
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.55)",
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
                  </li>
                ))}
              </ul>
              {errBox}
              <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStep(2)}
                  style={secondaryCtaStyle(saving)}
                >
                  {saving ? "Подождите…" : "Назад"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onStep3Finish()}
                  style={primaryCtaStyle(saving, true)}
                >
                  {saving ? "Подождите…" : "Перейти к проектам"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PostCheckoutOnboardingModal() {
  const pathname = usePathname();
  if (!isPostCheckoutOnboardingModalHostPath(pathname)) return null;
  return <PostCheckoutOnboardingModalInner />;
}
