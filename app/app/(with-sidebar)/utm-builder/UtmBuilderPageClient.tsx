"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function clsx(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function normalizeUrl(input: string): string {
  const u = (input || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

function buildFinalUrl(
  destination: string,
  params: Record<string, string>
): string {
  const url = new URL(destination);
  Object.entries(params).forEach(([k, v]) => {
    if (v?.trim()) url.searchParams.set(k, v.trim());
  });
  return url.toString();
}

const TRACKING_DOMAIN =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TRACKING_DOMAIN ?? "")
    : "";

function getRedirectUrl(token: string): string {
  const base = TRACKING_DOMAIN.replace(/\/$/, "");
  const origin = base || (typeof window !== "undefined" ? window.location.origin : "");
  const host = origin || "https://trk.boardiq.com";
  return `${host}/r/${token}`;
}

type TrafficPreset = "meta" | "google" | "tiktok" | "influencer" | "custom";
type CampaignIntent = "acquisition" | "retention";

const PRESETS: Record<
  TrafficPreset,
  { label: string; utm_source: string; default_medium: string }
> = {
  meta: { label: "Meta Ads", utm_source: "meta", default_medium: "cpc" },
  google: { label: "Google Ads", utm_source: "google", default_medium: "cpc" },
  tiktok: { label: "TikTok Ads", utm_source: "tiktok", default_medium: "paid" },
  influencer: {
    label: "Influencer",
    utm_source: "influencer",
    default_medium: "social",
  },
  custom: { label: "Custom", utm_source: "", default_medium: "" },
};

/** Per-platform UTM/dynamic params. No Meta vars in Google/TikTok. */
function getAutoAdParams(preset: TrafficPreset): Record<string, string> {
  switch (preset) {
    case "meta":
      return {
        utm_campaign: "{{campaign.id}}",
        utm_content: "{{ad.id}}",
        utm_term: "{{adset.id}}",
      };
    case "google":
      return {
        utm_campaign: "{campaignid}",
        utm_content: "{creative}",
        utm_term: "{keyword}",
      };
    case "tiktok":
      return {
        utm_id: "__CAMPAIGN_ID__",
        utm_campaign: "__CAMPAIGN_NAME__",
        utm_content: "__AID__",
        utm_term: "__ADGROUP_ID__",
      };
    case "influencer":
    case "custom":
      return {};
    default:
      return {};
  }
}

/** Defaults for Custom tracking setup when Traffic source changes. Each platform uses its own params. */
function getCustomModeDefaults(preset: TrafficPreset): {
  utm_source: string;
  utm_medium: string;
  utm_id: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
} {
  switch (preset) {
    case "meta":
      return {
        utm_source: "meta",
        utm_medium: "cpc",
        utm_id: "",
        utm_campaign: "{{campaign.id}}",
        utm_content: "{{ad.id}}",
        utm_term: "{{adset.id}}",
      };
    case "google":
      return {
        utm_source: "google",
        utm_medium: "cpc",
        utm_id: "",
        utm_campaign: "{campaignid}",
        utm_content: "{creative}",
        utm_term: "{keyword}",
      };
    case "tiktok":
      return {
        utm_source: "tiktok",
        utm_medium: "paid",
        utm_id: "__CAMPAIGN_ID__",
        utm_campaign: "__CAMPAIGN_NAME__",
        utm_content: "__AID__",
        utm_term: "__ADGROUP_ID__",
      };
    case "influencer":
      return {
        utm_source: "influencer",
        utm_medium: "social",
        utm_id: "",
        utm_campaign: "",
        utm_content: "",
        utm_term: "",
      };
    default:
      return {
        utm_source: "",
        utm_medium: "",
        utm_id: "",
        utm_campaign: "",
        utm_content: "",
        utm_term: "",
      };
  }
}

const UTM_MEDIUM_OPTIONS = ["cpc", "cpm", "cpv", "cpa", "paid", "organic", "referral"] as const;
const UTM_MEDIUM_CUSTOM = "custom";

type SavedLink = {
  id: string;
  token: string;
  destination_url: string;
  utm_source: string | null;
  utm_campaign: string | null;
  campaign_intent?: string | null;
  created_at: string;
  clicks_count: number;
  last_click_at: string | null;
  redirect_url?: string;
};

const INPUT_CLASS =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/20 focus:bg-white/7 min-h-[44px]";

const SELECT_CLASS =
  "w-full rounded-xl border border-white/10 bg-white/5 pl-4 pr-10 py-3 text-sm text-white outline-none focus:border-white/20 focus:bg-white/7 min-h-[44px] cursor-pointer appearance-none bg-no-repeat bg-[length:14px] bg-[right_0.75rem_center]";

export default function UtmBuilderPageClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [destinationUrl, setDestinationUrl] = useState("");
  const [preset, setPreset] = useState<TrafficPreset>("meta");
  const [campaignIntent, setCampaignIntent] = useState<CampaignIntent>("acquisition");
  const [utmMediumManual, setUtmMediumManual] = useState("cpc");
  const [utmMediumCustom, setUtmMediumCustom] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [utmSource, setUtmSource] = useState("");
  const [utmId, setUtmId] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmContent, setUtmContent] = useState("");
  const [utmTerm, setUtmTerm] = useState("");
  const [extraParams, setExtraParams] = useState<{ key: string; value: string }[]>([]);
  const [warningExpanded, setWarningExpanded] = useState(false);

  const [generateLoading, setGenerateLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{
    token: string;
    destination_url: string;
    final_url: string;
    longRedirectUrl: string;
  } | null>(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "long" | "short" | "final" | "destination" | string>("");

  const [history, setHistory] = useState<SavedLink[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const normalizedDestination = useMemo(
    () => normalizeUrl(destinationUrl),
    [destinationUrl]
  );
  const destinationValid = useMemo(
    () => !!normalizedDestination && isValidUrl(normalizedDestination),
    [normalizedDestination]
  );

  const effectiveMedium =
    UTM_MEDIUM_OPTIONS.includes(utmMediumManual as (typeof UTM_MEDIUM_OPTIONS)[number])
      ? utmMediumManual
      : utmMediumCustom.trim() || utmMediumManual;

  const mediumSelectValue =
    UTM_MEDIUM_OPTIONS.includes(utmMediumManual as (typeof UTM_MEDIUM_OPTIONS)[number])
      ? utmMediumManual
      : UTM_MEDIUM_CUSTOM;

  const syncCustomFieldsFromPreset = (p: TrafficPreset) => {
    const d = getCustomModeDefaults(p);
    setUtmSource(d.utm_source);
    setUtmMediumManual(d.utm_medium || "cpc");
    setUtmMediumCustom("");
    setUtmId(d.utm_id);
    setUtmCampaign(d.utm_campaign);
    setUtmContent(d.utm_content);
    setUtmTerm(d.utm_term);
  };

  useEffect(() => {
    if (preset === "custom") {
      setCustomMode(true);
      setCustomOpen(true);
      syncCustomFieldsFromPreset("custom");
      return;
    }
    if (customMode) {
      syncCustomFieldsFromPreset(preset);
      return;
    }
    setUtmMediumManual((prev) => {
      const def = PRESETS[preset].default_medium;
      if (def) return def;
      return prev;
    });
  }, [preset]);

  const openCustomModeWithDefaults = () => {
    setCustomMode(true);
    setCustomOpen(true);
    syncCustomFieldsFromPreset(preset);
  };

  const effectiveSource = customMode ? utmSource : PRESETS[preset].utm_source;

  const utmParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (customMode) {
      if (effectiveSource?.trim()) p.utm_source = effectiveSource.trim();
      if (effectiveMedium?.trim()) p.utm_medium = effectiveMedium.trim();
      if (utmId.trim()) p.utm_id = utmId.trim();
      if (utmCampaign.trim()) p.utm_campaign = utmCampaign.trim();
      if (utmContent.trim()) p.utm_content = utmContent.trim();
      if (utmTerm.trim()) p.utm_term = utmTerm.trim();
      extraParams.forEach(({ key, value }) => {
        if (key.trim() && value.trim()) p[key.trim()] = value.trim();
      });
    } else {
      if (effectiveSource) p.utm_source = effectiveSource;
      if (effectiveMedium) p.utm_medium = effectiveMedium;
      Object.entries(getAutoAdParams(preset)).forEach(([k, v]) => {
        if (v) p[k] = v;
      });
    }
    if (campaignIntent === "retention") {
      p.campaign_intent = "retention";
    }
    return p;
  }, [
    campaignIntent,
    customMode,
    effectiveSource,
    effectiveMedium,
    utmId,
    utmCampaign,
    utmContent,
    utmTerm,
    extraParams,
    preset,
  ]);

  const finalUrl = useMemo(() => {
    if (!destinationValid) return "";
    return buildFinalUrl(normalizedDestination, utmParams);
  }, [destinationValid, normalizedDestination, utmParams]);

  const isGenerated = !!lastSaved;
  const longRedirectUrl = lastSaved?.longRedirectUrl ?? "";
  const shortRedirectUrl = lastSaved ? getRedirectUrl(lastSaved.token) : "";

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setHistoryLoading(true);
    fetch(`/api/redirect-links?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success && Array.isArray(json.items)) {
          setHistory(json.items);
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleGenerate = async () => {
    if (!projectId || !destinationValid) return;
    setSaveError(null);
    setGenerateLoading(true);
    try {
      const res = await fetch("/api/redirect-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          destination_url: normalizedDestination,
          utm_source: effectiveSource || null,
          utm_medium: effectiveMedium || null,
          utm_campaign: (customMode ? utmCampaign : "")?.trim() || null,
          utm_content: (customMode ? utmContent : "")?.trim() || null,
          utm_term: (customMode ? utmTerm : "")?.trim() || null,
          campaign_intent: campaignIntent === "retention" ? "retention" : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveError(json.error ?? "Ошибка сохранения");
        return;
      }
      const paramsForUrl = Object.fromEntries(Object.entries(utmParams).filter(([, v]) => v));
      const query = new URLSearchParams(paramsForUrl).toString();
      const longUrl = query ? getRedirectUrl(json.token) + "?" + query : getRedirectUrl(json.token);
      setLastSaved({
        token: json.token,
        destination_url: json.destination_url,
        final_url: finalUrl,
        longRedirectUrl: longUrl,
      });
      setHistory((prev) => [
        {
          id: json.id,
          token: json.token,
          destination_url: json.destination_url,
          utm_source: effectiveSource || null,
          utm_campaign: (customMode ? utmCampaign : "")?.trim() || null,
          campaign_intent: campaignIntent === "retention" ? "retention" : null,
          created_at: json.created_at,
          clicks_count: 0,
          last_click_at: null,
          redirect_url: getRedirectUrl(json.token),
        },
        ...prev,
      ]);
    } finally {
      setGenerateLoading(false);
    }
  };

  const copyLongUrl = async () => {
    if (!longRedirectUrl) return;
    await copyToClipboard(longRedirectUrl);
    setCopied("long");
    setTimeout(() => setCopied(""), 1200);
  };

  const copyShortUrl = async () => {
    if (!shortRedirectUrl) return;
    await copyToClipboard(shortRedirectUrl);
    setCopied("short");
    setTimeout(() => setCopied(""), 1200);
  };

  const copyRecentLinkUrl = async (link: SavedLink) => {
    const fullUrl = getRedirectUrl(link.token);
    await copyToClipboard(fullUrl);
    setCopied("recent-" + link.id);
    setTimeout(() => setCopied(""), 1200);
  };

  const copyFinalUrl = async () => {
    if (!finalUrl) return;
    await copyToClipboard(finalUrl);
    setCopied("final");
    setTimeout(() => setCopied(""), 1200);
  };

  const copyDestinationUrl = async () => {
    if (!normalizedDestination) return;
    await copyToClipboard(normalizedDestination);
    setCopied("destination");
    setTimeout(() => setCopied(""), 1200);
  };

  const addExtraParam = () => {
    setExtraParams((prev) => [...prev, { key: "", value: "" }]);
  };
  const setExtraParam = (i: number, field: "key" | "value", val: string) => {
    setExtraParams((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  };
  const removeExtraParam = (i: number) => {
    setExtraParams((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleMediumSelectChange = (value: string) => {
    if (value === UTM_MEDIUM_CUSTOM) {
      setUtmMediumManual("");
      return;
    }
    setUtmMediumManual(value);
    setUtmMediumCustom("");
  };

  if (!projectId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="text-center">
          <p className="text-base font-medium text-neutral-300">Выберите проект</p>
          <p className="mt-2 text-sm text-neutral-500">
            Добавьте{" "}
            <code className="rounded bg-neutral-800 px-2 py-1 text-neutral-400">
              ?project_id=...
            </code>{" "}
            в адрес
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 pb-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          UTM Builder
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Создайте трекинг-ссылки с редиректом. Укажите URL и источник трафика, нажмите Generate link.
        </p>
      </div>

      <div
        className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
        role="region"
        aria-expanded={warningExpanded}
      >
        <button
          type="button"
          onClick={() => setWarningExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div>
            <p className="text-sm font-semibold text-amber-200">⚠️ Важно</p>
            <p className="mt-1 text-sm text-amber-100/90">
              Обязательно используйте сгенерированную tracking-ссылку в рекламных кабинетах.
            </p>
          </div>
          <span className="shrink-0 text-amber-200/80" aria-hidden>
            {warningExpanded ? "▲" : "▼"}
          </span>
        </button>
        {warningExpanded && (
          <div className="mt-3 border-t border-amber-500/20 pt-3">
            <p className="text-sm text-amber-100/80">
              Если вы используете прямую ссылку на сайт вместо tracking-ссылки, BoardIQ не сможет корректно зафиксировать клики и связать их с регистрациями или покупками. Это значительно ухудшает качество атрибуции и аналитики.
            </p>
            <p className="mt-2 text-sm text-amber-100/90">Использование tracking-ссылок позволяет:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-amber-100/80">
              <li>фиксировать рекламные клики</li>
              <li>автоматически передавать параметры кампаний</li>
              <li>корректно связывать клики с регистрациями и покупками</li>
              <li>получать точные данные по ROAS, CAC и эффективности рекламы</li>
            </ul>
            <p className="mt-2 text-sm text-amber-100/80">
              Без tracking-ссылок точность атрибуции может значительно снизиться.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-sm font-medium text-neutral-400">Destination URL</h2>
            <input
              type="text"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://example.com/landing"
              className={clsx(INPUT_CLASS, "mt-2")}
            />
            {destinationUrl.trim() && !destinationValid && (
              <p className="mt-2 text-sm text-red-400">Введите корректный URL</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-sm font-medium text-neutral-400 mb-4">Traffic settings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-neutral-500 mb-1">Campaign intent</label>
                <select
                  value={campaignIntent}
                  onChange={(e) => setCampaignIntent(e.target.value as CampaignIntent)}
                  className={clsx(SELECT_CLASS, "mt-0")}
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")" }}
                >
                  <option value="acquisition">Acquisition</option>
                  <option value="retention">Retention</option>
                </select>
                {campaignIntent === "retention" && (
                  <p className="mt-1.5 text-xs text-neutral-500">
                    Retention — ссылки для повторных продаж, реактивации и возврата клиентов.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Traffic source</label>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as TrafficPreset)}
                  className={clsx(SELECT_CLASS, "mt-0")}
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")" }}
                >
                  {(["meta", "google", "tiktok", "influencer", "custom"] as TrafficPreset[]).map((p) => (
                    <option key={p} value={p}>
                      {PRESETS[p].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">UTM medium</label>
                <select
                  value={mediumSelectValue}
                  onChange={(e) => handleMediumSelectChange(e.target.value)}
                  className={clsx(SELECT_CLASS, "mt-0")}
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")" }}
                >
                  {UTM_MEDIUM_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={UTM_MEDIUM_CUSTOM}>Other…</option>
                </select>
                {mediumSelectValue === UTM_MEDIUM_CUSTOM && (
                  <input
                    type="text"
                    value={utmMediumCustom || utmMediumManual}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUtmMediumCustom(v);
                      setUtmMediumManual(v);
                    }}
                    placeholder="Enter custom medium"
                    className={clsx(INPUT_CLASS, "mt-2")}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <button
              type="button"
              onClick={() => {
                if (!customMode) openCustomModeWithDefaults();
                setCustomOpen((o) => !o);
              }}
              className="flex w-full items-center justify-between text-left text-sm font-medium text-neutral-400"
            >
              Custom tracking setup
              <span className="text-neutral-500">{customOpen ? "▼" : "▶"}</span>
            </button>
            {customOpen && (
              <div className="mt-4 space-y-4">
                <p className="text-xs text-neutral-500">
                  Use this mode if you want to fully control source, medium and dynamic variables manually.
                </p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={customMode}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setCustomMode(on);
                      if (on) syncCustomFieldsFromPreset(preset);
                    }}
                    className="rounded border-white/20 bg-white/5"
                  />
                  <span className="text-sm text-neutral-300">Enable Manual UTM parameters</span>
                </label>
                {customMode && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-xs font-medium text-neutral-400 mb-3">Manual UTM parameters</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs text-neutral-500">utm_source</label>
                        <input
                          type="text"
                          value={utmSource}
                          onChange={(e) => setUtmSource(e.target.value)}
                          placeholder="meta"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500">utm_medium</label>
                        <input
                          type="text"
                          value={effectiveMedium}
                          onChange={(e) => {
                            setUtmMediumManual(e.target.value);
                            setUtmMediumCustom(e.target.value);
                          }}
                          placeholder="cpc"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500">utm_id (e.g. TikTok)</label>
                        <input
                          type="text"
                          value={utmId}
                          onChange={(e) => setUtmId(e.target.value)}
                          placeholder="__CAMPAIGN_ID__"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500">utm_campaign</label>
                        <input
                          type="text"
                          value={utmCampaign}
                          onChange={(e) => setUtmCampaign(e.target.value)}
                          placeholder="{{campaign.id}}"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500">utm_content</label>
                        <input
                          type="text"
                          value={utmContent}
                          onChange={(e) => setUtmContent(e.target.value)}
                          placeholder="{{ad.id}}"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500">utm_term</label>
                        <input
                          type="text"
                          value={utmTerm}
                          onChange={(e) => setUtmTerm(e.target.value)}
                          placeholder="{{adset.id}}"
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs text-neutral-500">Extra parameters</label>
                        <button type="button" onClick={addExtraParam} className="text-xs text-white/70 hover:text-white">
                          + Add
                        </button>
                      </div>
                      {extraParams.map((p, i) => (
                        <div key={i} className="mt-2 flex gap-2">
                          <input
                            type="text"
                            value={p.key}
                            onChange={(e) => setExtraParam(i, "key", e.target.value)}
                            placeholder="key"
                            className={clsx(INPUT_CLASS, "flex-1")}
                          />
                          <input
                            type="text"
                            value={p.value}
                            onChange={(e) => setExtraParam(i, "value", e.target.value)}
                            placeholder="value"
                            className={clsx(INPUT_CLASS, "flex-1")}
                          />
                          <button
                            type="button"
                            onClick={() => removeExtraParam(i)}
                            className="rounded-lg border border-white/10 px-2 text-neutral-400 hover:text-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-sm font-medium text-neutral-400">Recent links</h2>
            {historyLoading ? (
              <p className="mt-4 text-sm text-neutral-500">Загрузка…</p>
            ) : history.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">Нет сохранённых ссылок</p>
            ) : (
              <div className="mt-4 max-h-[300px] overflow-y-auto overflow-x-auto rounded-lg border border-white/5">
                <table className="min-w-full text-left text-[11px] text-neutral-300">
                  <thead className="sticky top-0 z-10 border-b border-white/10 bg-neutral-900/95 text-neutral-500 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">
                    <tr>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Dest. URL</th>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Redirect URL</th>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Source</th>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Campaign</th>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Clicks</th>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Last click</th>
                      <th className="whitespace-nowrap py-1.5 pr-2 text-[10px] font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {history.map((link) => {
                      const fullRedirectUrl = getRedirectUrl(link.token);
                      return (
                        <tr key={link.id} className="hover:bg-white/[0.03]">
                          <td className="max-w-[140px] truncate py-1 pr-2 font-mono" title={link.destination_url}>
                            {link.destination_url}
                          </td>
                          <td
                            className="group/redirect relative max-w-[160px] truncate py-1 pr-8 font-mono text-neutral-300"
                            title={fullRedirectUrl}
                          >
                            {fullRedirectUrl}
                            <button
                              type="button"
                              onClick={() => copyRecentLinkUrl(link)}
                              className="absolute right-1 top-1/2 -translate-y-1/2 rounded border border-white/15 bg-neutral-800/90 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover/redirect:opacity-100"
                            >
                              {copied === "recent-" + link.id ? "Copied" : "Copy"}
                            </button>
                          </td>
                          <td className="py-1 pr-2">{link.utm_source ?? "—"}</td>
                          <td className="max-w-[80px] truncate py-1 pr-2">{link.utm_campaign ?? "—"}</td>
                          <td className="py-1 pr-2">{link.clicks_count}</td>
                          <td className="whitespace-nowrap py-1 pr-2 text-[10px]">
                            {link.last_click_at ? new Date(link.last_click_at).toLocaleString() : "—"}
                          </td>
                          <td className="whitespace-nowrap py-1 pr-2 text-[10px]">
                            {new Date(link.created_at).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-sm font-medium text-neutral-400">Output</h2>

            {!isGenerated ? (
              <>
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-6 text-center">
                  <p className="text-sm text-neutral-400">
                    Configure destination and traffic above, then click Generate link.
                  </p>
                  <p className="mt-2 text-xs text-neutral-500">
                    Your tracking link will appear here after generation and will be saved.
                  </p>
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={generateLoading || !destinationValid}
                      className="rounded-xl bg-white/15 px-6 py-3 text-sm font-medium text-white hover:bg-white/25 disabled:opacity-50"
                    >
                      {generateLoading ? "Generating…" : "Generate link"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 rounded-xl border border-white/20 bg-white/5 p-4">
                  <p className="text-sm font-medium text-white">Tracking link</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    Use this link in ads and traffic sources. BoardIQ will track clicks and pass parameters automatically.
                  </p>
                  {campaignIntent === "retention" && (
                    <p className="mt-1 text-xs font-medium text-amber-300/90">Retention link — в URL добавлен параметр campaign_intent=retention</p>
                  )}
                  <p className="mt-1 text-xs font-medium text-emerald-400/90">Link saved successfully</p>
                  <div
                    className="group relative mt-2 max-h-28 overflow-y-auto rounded-lg border border-white/5 bg-black/20 px-3 py-2 pr-16 font-mono text-sm text-white break-all"
                    title={longRedirectUrl}
                  >
                    {longRedirectUrl}
                    <button
                      type="button"
                      onClick={copyLongUrl}
                      className="absolute right-2 top-2 rounded border border-white/20 bg-white/10 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      {copied === "long" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={copyLongUrl}
                      className="rounded-xl bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
                    >
                      {copied === "long" ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLastSaved(null)}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                    >
                      Create another
                    </button>
                  </div>
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setMoreOptionsOpen((o) => !o)}
                      className="flex w-full items-center justify-between text-left text-xs text-neutral-400 hover:text-neutral-300"
                    >
                      {moreOptionsOpen ? "▼" : "▶"} More options
                    </button>
                    {moreOptionsOpen && (
                      <div className="mt-2 rounded-lg border border-white/5 bg-black/20 p-3">
                        <p className="text-xs font-medium text-neutral-400">Short link (for SMS / messengers)</p>
                        <p className="mt-1 break-all font-mono text-xs text-neutral-300" title={shortRedirectUrl}>
                          {shortRedirectUrl}
                        </p>
                        <button
                          type="button"
                          onClick={copyShortUrl}
                          className="mt-2 text-xs text-neutral-400 hover:text-white"
                        >
                          {copied === "short" ? "Copied" : "Copy short link"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-xs font-medium text-neutral-400">Final landing URL preview</p>
                  <div
                    className="mt-2 max-h-20 overflow-y-auto rounded border border-white/5 bg-black/10 px-2 py-1.5 font-mono text-xs text-neutral-400 break-all"
                    title={finalUrl}
                  >
                    {finalUrl || "—"}
                  </div>
                  <button
                    type="button"
                    onClick={copyFinalUrl}
                    disabled={!finalUrl}
                    className="mt-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50"
                  >
                    {copied === "final" ? "Copied" : "Copy"}
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-xs font-medium text-neutral-500">Original destination URL</p>
                  <div
                    className="mt-2 max-h-16 overflow-y-auto rounded border border-white/5 bg-black/10 px-2 py-1.5 font-mono text-xs text-neutral-500 break-all"
                    title={normalizedDestination}
                  >
                    {normalizedDestination || "—"}
                  </div>
                  <button
                    type="button"
                    onClick={copyDestinationUrl}
                    disabled={!normalizedDestination}
                    className="mt-2 text-xs text-neutral-500 hover:text-neutral-400 disabled:opacity-50"
                  >
                    {copied === "destination" ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            )}

            {saveError && <p className="mt-3 text-sm text-red-400">{saveError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
