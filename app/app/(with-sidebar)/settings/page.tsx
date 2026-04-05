"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";
import { getCompanySizeSelectOptions } from "@/app/lib/companySize";
import { getCompanySphereGroupedSelect } from "@/app/lib/companySphere";
import SettingsAccessSection from "./SettingsAccessSection";
import { SETTINGS_WIDE_SECTION_MAX_PX } from "./settingsSectionLayout";

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD ($)" },
  { value: "KZT", label: "KZT (₸)" },
];

const API_ACCESS_CALL_VOLUME_OPTIONS = [
  { value: "lt_10k", label: "до 10 000 вызовов в месяц" },
  { value: "10k_100k", label: "10 000 – 100 000 в месяц" },
  { value: "100k_1m", label: "100 000 – 1 000 000 в месяц" },
  { value: "gt_1m", label: "более 1 000 000 в месяц" },
  { value: "unknown", label: "пока не определились" },
] as const;

const SECTIONS = [
  { id: "general", label: "Общая информация" },
  { id: "access", label: "Управление доступом" },
  { id: "currency", label: "Курс валют" },
  { id: "api", label: "API" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function isSectionId(v: string | null): v is SectionId {
  return v === "general" || v === "access" || v === "currency" || v === "api";
}

function tabButtonStyle(active: boolean) {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: active ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    color: "white",
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: "pointer" as const,
    whiteSpace: "nowrap" as const,
  };
}

function panelStyle(maxWidth: number = 560) {
  return {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(10,10,18,0.96)",
    padding: 20,
    maxWidth,
  };
}

const inputBase = {
  width: "100%" as const,
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(15,15,25,0.95)",
  color: "white",
  fontSize: 14,
  boxSizing: "border-box" as const,
};

function SettingsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const { resolvedUi } = useBillingBootstrap();

  const sectionFromUrl = searchParams.get("section");
  const activeSection: SectionId = isSectionId(sectionFromUrl) ? sectionFromUrl : "general";

  const setSection = useCallback(
    (id: SectionId) => {
      if (!projectId) return;
      router.replace(`/app/settings?project_id=${encodeURIComponent(projectId)}&section=${id}`, {
        scroll: false,
      });
    },
    [projectId, router]
  );

  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState<string | null>(null);
  const [canEditOrg, setCanEditOrg] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState<string>("");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [ownerFullName, setOwnerFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [companySphere, setCompanySphere] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [profileInitial, setProfileInitial] = useState<string | null>(null);

  const companySphereGrouped = useMemo(
    () => getCompanySphereGroupedSelect(companySphere === ""),
    [companySphere]
  );

  const companySizeSelectOptions = useMemo(
    () => getCompanySizeSelectOptions(companySize === ""),
    [companySize]
  );

  const [currency, setCurrency] = useState<string>("USD");
  const [initialCurrency, setInitialCurrency] = useState<string>("USD");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [spotRate, setSpotRate] = useState<number | null>(null);
  const [spotRateDate, setSpotRateDate] = useState<string | null>(null);
  const [spotUpdatedAt, setSpotUpdatedAt] = useState<string | null>(null);
  const [spotMessage, setSpotMessage] = useState<string | null>(null);
  const [spotLoading, setSpotLoading] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);

  const [apiAccessName, setApiAccessName] = useState("");
  const [apiAccessPhone, setApiAccessPhone] = useState("");
  const [apiAccessCallVolume, setApiAccessCallVolume] = useState<string>("");
  const [apiAccessDescription, setApiAccessDescription] = useState("");
  const [apiAccessSubmitting, setApiAccessSubmitting] = useState(false);
  const [apiAccessSuccess, setApiAccessSuccess] = useState(false);
  const [apiAccessError, setApiAccessError] = useState<string | null>(null);
  const [pickProjectTried, setPickProjectTried] = useState(false);

  useEffect(() => {
    if (projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success || !Array.isArray(json.projects) || json.projects.length === 0) {
          setPickProjectTried(true);
          return;
        }
        const first = json.projects[0]?.id;
        if (typeof first !== "string" || !first) {
          setPickProjectTried(true);
          return;
        }
        const sec =
          sectionFromUrl && isSectionId(sectionFromUrl)
            ? `&section=${encodeURIComponent(sectionFromUrl)}`
            : "";
        router.replace(`/app/settings?project_id=${encodeURIComponent(first)}${sec}`);
      } catch {
        if (!cancelled) setPickProjectTried(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, router, sectionFromUrl]);

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
      } catch {
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

  useEffect(() => {
    if (!projectId || activeSection !== "currency") return;
    let mounted = true;
    (async () => {
      setSpotLoading(true);
      setSpotError(null);
      setSpotMessage(null);
      try {
        const res = await fetch(
          `/api/exchange/usd-kzt/latest?project_id=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok || !json?.success) {
          setSpotError(json?.error ?? "Не удалось загрузить курс");
          setSpotRate(null);
          setSpotRateDate(null);
          setSpotUpdatedAt(null);
          return;
        }
        if (json.rate == null) {
          setSpotRate(null);
          setSpotRateDate(null);
          setSpotUpdatedAt(null);
          setSpotMessage(typeof json.message === "string" ? json.message : "Курс пока недоступен.");
          return;
        }
        setSpotRate(Number(json.rate));
        setSpotRateDate(typeof json.rate_date === "string" ? json.rate_date : null);
        setSpotUpdatedAt(typeof json.updated_at === "string" ? json.updated_at : null);
      } catch {
        if (mounted) {
          setSpotError("Не удалось загрузить курс");
          setSpotRate(null);
        }
      } finally {
        if (mounted) setSpotLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectId, activeSection]);

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    (async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = await res.json();
        if (!mounted || !res.ok || !json?.success || !Array.isArray(json.projects)) return;
        const p = json.projects.find((x: { id: string }) => x.id === projectId);
        setProjectName(p?.name ?? null);
      } catch {
        if (mounted) setProjectName(null);
      } finally {
        if (mounted) setProjectsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    (async () => {
      setProfileLoading(true);
      setProfileError(null);
      setProfileOk(null);
      try {
        const res = await fetch(
          `/api/organizations/profile?project_id=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok || !json?.success) {
          setProfileError(json?.error ?? "Не удалось загрузить профиль организации");
          return;
        }
        const o = json.organization as {
          name?: string;
          owner_full_name?: string;
          contact_phone?: string;
          company_size?: string | null;
          company_sphere?: string | null;
        };
        setCanEditOrg(!!json.can_edit);
        setOwnerEmail(typeof json.owner_email === "string" ? json.owner_email : "");
        setOwnerFullName(o.owner_full_name ?? "");
        setCompanyName(o.name ?? "");
        setContactPhone(o.contact_phone ?? "");
        setCompanySphere(o.company_sphere ?? "");
        setCompanySize(o.company_size ?? "");
        setProfileInitial(
          JSON.stringify({
            owner_full_name: o.owner_full_name ?? "",
            name: o.name ?? "",
            contact_phone: o.contact_phone ?? "",
            company_sphere: o.company_sphere ?? "",
            company_size: o.company_size ?? "",
          })
        );
      } catch {
        if (mounted) setProfileError("Не удалось загрузить профиль организации");
      } finally {
        if (mounted) setProfileLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  const handleSaveProfile = useCallback(async () => {
    if (!projectId || !canEditOrg) return;
    if (!billingActionAllowed(resolvedUi, ActionId.navigate_settings)) return;
    const snapshot = JSON.stringify({
      owner_full_name: ownerFullName,
      name: companyName,
      contact_phone: contactPhone,
      company_size: companySize || "",
    });
    if (snapshot === profileInitial) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileOk(null);
    try {
      const res = await fetch("/api/organizations/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: companyName.trim(),
          owner_full_name: ownerFullName,
          contact_phone: contactPhone,
          company_sphere: companySphere || null,
          company_size: companySize || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setProfileError(json?.error ?? "Не удалось сохранить");
        return;
      }
      if (json.organization) {
        const o = json.organization as {
          name?: string;
          about_company?: string;
          owner_full_name?: string;
          contact_phone?: string;
          company_sphere?: string | null;
          company_size?: string | null;
        };
        setProfileInitial(
          JSON.stringify({
            about_company: o.about_company ?? "",
            owner_full_name: o.owner_full_name ?? "",
            name: o.name ?? "",
            contact_phone: o.contact_phone ?? "",
            company_sphere: o.company_sphere ?? "",
            company_size: o.company_size ?? "",
          })
        );
      }
      setProfileOk("Данные сохранены.");
    } catch {
      setProfileError("Не удалось сохранить");
    } finally {
      setProfileSaving(false);
    }
  }, [
    projectId,
    canEditOrg,
    ownerFullName,
    companyName,
    contactPhone,
    companySphere,
    companySize,
    profileInitial,
    resolvedUi,
  ]);

  const handleSave = useCallback(async () => {
    if (!projectId) return;
    if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) return;
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
      if (currency === "KZT") {
        if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) {
          setError("Обновление курса недоступно при текущем статусе подписки");
          return;
        }
        const rateRes = await fetch("/api/system/update-rates", { method: "POST" });
        const rateJson = await rateRes.json().catch(() => null);
        if (!rateRes.ok || !rateJson?.success) {
          setError(rateJson?.error ?? "Валюта сохранена, но курс USD→KZT не обновился");
          return;
        }
      }
      setInitialCurrency(currency);
      setSavedMessage("Валюта проекта сохранена.");
      setTimeout(() => {
        if (typeof window !== "undefined") window.location.reload();
      }, 350);
    } catch {
      setError("Не удалось сохранить валюту проекта");
    } finally {
      setSaving(false);
    }
  }, [projectId, currency, initialCurrency, resolvedUi]);

  const handleApiAccessSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!billingActionAllowed(resolvedUi, ActionId.support)) {
        setApiAccessError("Отправка заявки недоступна при текущем статусе подписки.");
        return;
      }
      setApiAccessError(null);
      setApiAccessSuccess(false);
      const desc = apiAccessDescription.trim();
      if (!apiAccessName.trim() || !apiAccessPhone.trim() || !apiAccessCallVolume || desc.length < 20) {
        setApiAccessError("Заполните все поля. В поле описания — не менее 20 символов.");
        return;
      }
      setApiAccessSubmitting(true);
      try {
        const res = await fetch("/api/contact/api-access-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: apiAccessName.trim(),
            phone: apiAccessPhone.trim(),
            callVolume: apiAccessCallVolume,
            description: desc,
            projectId: projectId || undefined,
            projectName: projectName?.trim() ? projectName.trim() : undefined,
          }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) {
          const err = json?.error;
          if (err === "smtp_not_configured") {
            setApiAccessError("Не удалось отправить заявку. Напишите нам на marketing.panfilov@gmail.com");
          } else if (typeof err === "string" && err.startsWith("rate_limited_")) {
            setApiAccessError("Слишком много попыток. Подождите минуту и попробуйте снова.");
          } else {
            setApiAccessError("Не удалось отправить заявку. Попробуйте позже.");
          }
          return;
        }
        setApiAccessSuccess(true);
        setApiAccessName("");
        setApiAccessPhone("");
        setApiAccessCallVolume("");
        setApiAccessDescription("");
      } catch {
        setApiAccessError("Не удалось отправить заявку. Попробуйте позже.");
      } finally {
        setApiAccessSubmitting(false);
      }
    },
    [apiAccessName, apiAccessPhone, apiAccessCallVolume, apiAccessDescription, projectId, projectName, resolvedUi]
  );

  if (!projectId) {
    if (!pickProjectTried) {
      return (
        <div style={{ padding: 24, color: "rgba(255,255,255,0.85)", fontSize: 14 }}>
          Загружаем настройки…
        </div>
      );
    }
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
          Нет доступных проектов или не удалось подобрать проект. Создайте проект в разделе «Проекты» или откройте
          настройки с явным адресом:{" "}
          <code style={{ color: "rgba(200,220,255,0.95)" }}>/app/settings?project_id=…</code>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>⚙️ Настройки проекта</h1>

      <div
        role="tablist"
        aria-label="Разделы настроек"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          borderBottom: "1px solid rgba(255,255,255,0.10)",
          paddingBottom: 12,
        }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={activeSection === s.id}
            id={`settings-tab-${s.id}`}
            onClick={() => setSection(s.id)}
            style={tabButtonStyle(activeSection === s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-labelledby={`settings-tab-${activeSection}`}>
        {activeSection === "general" && (
          <div
            style={{
              width: "100%",
              maxWidth: SETTINGS_WIDE_SECTION_MAX_PX,
              margin: "0 auto",
              display: "grid",
              gap: 16,
            }}
          >
            <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Проект</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}>
                Текущий проект в приложении.
              </p>
              {projectsLoading ? (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Загрузка…</div>
              ) : (
                <dl style={{ display: "grid", gap: 12, fontSize: 13, margin: 0 }}>
                  <div>
                    <dt style={{ color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>Название проекта</dt>
                    <dd style={{ margin: 0, color: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
                      {projectName?.trim() ? projectName : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>ID проекта</dt>
                    <dd
                      style={{
                        margin: 0,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                        color: "rgba(220,230,255,0.95)",
                        wordBreak: "break-all",
                      }}
                    >
                      {projectId}
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Компания и владелец</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 16 }}>
                Данные организации и владельца. Редактирование доступно только владельцу организации.
              </p>
              {profileLoading ? (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Загрузка…</div>
              ) : (
                <div style={{ display: "grid", gap: 18 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.55)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginTop: 4,
                  }}
                >
                  Владелец
                </div>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>ФИО</span>
                  <input
                    type="text"
                    value={ownerFullName}
                    onChange={(e) => setOwnerFullName(e.target.value)}
                    disabled={!canEditOrg || profileSaving}
                    autoComplete="name"
                    style={{
                      ...inputBase,
                      opacity: !canEditOrg ? 0.65 : 1,
                      cursor: !canEditOrg ? "not-allowed" : "text",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Email</span>
                  <input
                    type="email"
                    value={ownerEmail}
                    readOnly
                    disabled
                    tabIndex={-1}
                    style={{
                      ...inputBase,
                      opacity: 0.55,
                      cursor: "not-allowed",
                    }}
                  />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                    Меняется при передаче компании или доступа через поддержку.
                  </span>
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Название компании</span>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    disabled={!canEditOrg || profileSaving}
                    autoComplete="organization"
                    style={{
                      ...inputBase,
                      opacity: !canEditOrg ? 0.65 : 1,
                      cursor: !canEditOrg ? "not-allowed" : "text",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Контактный номер</span>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    disabled={!canEditOrg || profileSaving}
                    autoComplete="tel"
                    style={{
                      ...inputBase,
                      opacity: !canEditOrg ? 0.65 : 1,
                      cursor: !canEditOrg ? "not-allowed" : "text",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Сфера компании</span>
                  <select
                    className="settings-page-select"
                    value={companySphere}
                    onChange={(e) => setCompanySphere(e.target.value)}
                    disabled={!canEditOrg || profileSaving}
                    aria-label="Сфера деятельности компании"
                    style={
                      !canEditOrg || profileSaving
                        ? { cursor: "not-allowed" }
                        : { cursor: "pointer" }
                    }
                  >
                    {companySphereGrouped.includeUnset && (
                      <option value="">Не указано</option>
                    )}
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

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Количество сотрудников</span>
                  <select
                    className="settings-page-select"
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    disabled={!canEditOrg || profileSaving}
                    aria-label="Количество сотрудников в компании"
                    style={
                      !canEditOrg || profileSaving
                        ? { cursor: "not-allowed" }
                        : { cursor: "pointer" }
                    }
                  >
                    {companySizeSelectOptions.map((opt) => (
                      <option key={opt.value || "empty"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {!canEditOrg && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(234,179,8,0.35)",
                      background: "rgba(234,179,8,0.08)",
                      fontSize: 12,
                      color: "rgba(254,249,195,0.95)",
                    }}
                  >
                    Только владелец организации может менять эти поля.
                  </div>
                )}

                {profileError && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(239,68,68,0.5)",
                      background: "rgba(239,68,68,0.12)",
                      fontSize: 12,
                      color: "rgba(255,200,200,0.95)",
                    }}
                  >
                    {profileError}
                  </div>
                )}

                {profileOk && !profileError && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(34,197,94,0.5)",
                      background: "rgba(34,197,94,0.12)",
                      fontSize: 12,
                      color: "rgba(209,250,229,0.95)",
                    }}
                  >
                    {profileOk}
                  </div>
                )}

                {canEditOrg && (
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={
                      profileSaving ||
                      profileInitial === null ||
                      JSON.stringify({
                        owner_full_name: ownerFullName,
                        name: companyName,
                        contact_phone: contactPhone,
                        company_sphere: companySphere || "",
                        company_size: companySize || "",
                      }) === profileInitial ||
                      !companyName.trim()
                    }
                    style={{
                      justifySelf: "start",
                      padding: "9px 16px",
                      borderRadius: 10,
                      border: "none",
                      background:
                        profileSaving ||
                        profileInitial === null ||
                        !companyName.trim() ||
                        JSON.stringify({
                          owner_full_name: ownerFullName,
                          name: companyName,
                          contact_phone: contactPhone,
                          company_sphere: companySphere || "",
                          company_size: companySize || "",
                        }) === profileInitial
                          ? "rgba(120,120,255,0.25)"
                          : "rgba(120,120,255,0.45)",
                      color: "white",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: profileSaving ? "wait" : "pointer",
                    }}
                  >
                    {profileSaving ? "Сохранение…" : "Сохранить"}
                  </button>
                )}
              </div>
              )}
            </section>
          </div>
        )}

        {activeSection === "access" && <SettingsAccessSection settingsProjectId={projectId} />}

        {activeSection === "currency" && (
          <div
            style={{
              width: "100%",
              maxWidth: SETTINGS_WIDE_SECTION_MAX_PX,
              margin: "0 auto",
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            <section
              style={{
                ...panelStyle(),
                flex: "1 1 300px",
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Валюта и курсы</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}>
                Валюта отображения для бюджета, расходов и выручки. Для KZT при сохранении запрашивается
                актуальный курс USD→KZT.
              </p>

              {loading ? (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Загрузка…</div>
              ) : (
                <>
                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    <span style={{ color: "rgba(255,255,255,0.85)" }}>Валюта проекта</span>
                    <select
                      className="settings-page-select"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      disabled={saving}
                      style={{ cursor: saving ? "wait" : "pointer" }}
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

            <section
              style={{
                ...panelStyle(),
                flex: "1 1 260px",
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Курс на сегодня</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}>
                {currency === "KZT" ? (
                  <>
                    Ориентир KZT→USD для отчётов и конвертации. Автообновление в фоне — до{" "}
                    <strong style={{ fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>4 раз в сутки</strong>{" "}
                    (каждые 6 часов). При выборе валюты проекта KZT курс также запрашивается при сохранении.
                  </>
                ) : (
                  <>
                    Ориентир USD→KZT для отчётов и конвертации. Автообновление в фоне — до{" "}
                    <strong style={{ fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>4 раз в сутки</strong>{" "}
                    (каждые 6 часов). При выборе валюты проекта KZT курс также запрашивается при сохранении.
                  </>
                )}
              </p>
              {spotLoading ? (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Загрузка курса…</div>
              ) : spotError ? (
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(239,68,68,0.45)",
                    background: "rgba(239,68,68,0.1)",
                    fontSize: 12,
                    color: "rgba(255,200,200,0.95)",
                  }}
                >
                  {spotError}
                </div>
              ) : spotRate != null && Number.isFinite(spotRate) && spotRate > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {currency === "KZT" ? (
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        letterSpacing: "-0.02em",
                        color: "rgba(255,255,255,0.96)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      1 KZT ={" "}
                      {new Intl.NumberFormat("ru-RU", {
                        minimumFractionDigits: 4,
                        maximumFractionDigits: 8,
                      }).format(1 / spotRate)}{" "}
                      USD
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        letterSpacing: "-0.02em",
                        color: "rgba(255,255,255,0.96)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      1 USD ={" "}
                      {new Intl.NumberFormat("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      }).format(spotRate)}{" "}
                      KZT
                    </div>
                  )}
                  {spotRateDate && (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                      Дата котировки:{" "}
                      {(() => {
                        try {
                          return new Date(spotRateDate + "T12:00:00").toLocaleDateString("ru-RU", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          });
                        } catch {
                          return spotRateDate;
                        }
                      })()}
                    </div>
                  )}
                  {spotUpdatedAt && (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                      Запись обновлена:{" "}
                      {new Date(spotUpdatedAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: 0 }}>
                  {spotMessage ?? "Курс пока недоступен."}
                </p>
              )}
            </section>
          </div>
        )}

        {activeSection === "api" && (
          <div
            style={{
              width: "100%",
              maxWidth: SETTINGS_WIDE_SECTION_MAX_PX,
              margin: "0 auto",
              display: "grid",
              gap: 16,
            }}
          >
            <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>API</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", marginBottom: 14, lineHeight: 1.55 }}>
                Данная услуга <strong style={{ fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>платная</strong> и
                выдаётся по запросу. Стоимость зависит от количества вызовов API и от объёма данных, которые необходимо
                передавать.
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 0 }}>
                Публичный ключ событий, эндпоинты интеграций и справка по отправке событий предоставляются после
                рассмотрения заявки.
              </p>
            </section>

            <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Заявка на доступ к API</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 16 }}>
                Заполните форму — мы свяжемся с вами для уточнения условий.
              </p>

              {apiAccessSuccess && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(34,197,94,0.45)",
                    background: "rgba(34,197,94,0.12)",
                    fontSize: 13,
                    color: "rgba(200,255,220,0.98)",
                    lineHeight: 1.5,
                  }}
                >
                  Заявка успешно отправлена. Мы рассмотрим её и свяжемся с вами.
                </div>
              )}

              {apiAccessError && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(239,68,68,0.45)",
                    background: "rgba(239,68,68,0.1)",
                    fontSize: 13,
                    color: "rgba(255,200,200,0.95)",
                  }}
                >
                  {apiAccessError}
                </div>
              )}

              <form onSubmit={handleApiAccessSubmit} style={{ display: "grid", gap: 16 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Имя</span>
                  <input
                    type="text"
                    name="api_access_name"
                    value={apiAccessName}
                    onChange={(e) => setApiAccessName(e.target.value)}
                    disabled={apiAccessSubmitting}
                    autoComplete="name"
                    style={inputBase}
                  />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Контактный номер</span>
                  <input
                    type="tel"
                    name="api_access_phone"
                    value={apiAccessPhone}
                    onChange={(e) => setApiAccessPhone(e.target.value)}
                    disabled={apiAccessSubmitting}
                    autoComplete="tel"
                    style={inputBase}
                  />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Количество вызовов API (ориентир)</span>
                  <select
                    name="api_access_call_volume"
                    value={apiAccessCallVolume}
                    onChange={(e) => setApiAccessCallVolume(e.target.value)}
                    disabled={apiAccessSubmitting}
                    style={{
                      ...inputBase,
                      cursor: apiAccessSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    <option value="">Выберите вариант</option>
                    {API_ACCESS_CALL_VOLUME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>Для чего нужен API</span>
                  <textarea
                    name="api_access_description"
                    value={apiAccessDescription}
                    onChange={(e) => setApiAccessDescription(e.target.value)}
                    disabled={apiAccessSubmitting}
                    rows={5}
                    placeholder="Опишите сценарий использования, какие данные нужно передавать и как часто."
                    style={{
                      ...inputBase,
                      minHeight: 120,
                      resize: "vertical" as const,
                      fontFamily: "inherit",
                      lineHeight: 1.45,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                    Не менее 20 символов.
                  </span>
                </label>

                <div>
                  <button
                    type="submit"
                    disabled={apiAccessSubmitting}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: "none",
                      background: apiAccessSubmitting ? "rgba(120,120,255,0.25)" : "rgba(120,120,255,0.45)",
                      color: "white",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: apiAccessSubmitting ? "default" : "pointer",
                    }}
                  >
                    {apiAccessSubmitting ? "Отправка…" : "Отправить заявку"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Загрузка…</div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
