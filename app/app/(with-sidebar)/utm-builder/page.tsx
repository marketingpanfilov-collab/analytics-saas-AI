"use client";

import React, { useMemo, useState, useEffect } from "react";

type Preset = "meta" | "google" | "tiktok" | "influencer" | "custom";
type Medium = "paid_social" | "cpc" | "display" | "influencer" | "email" | "referral" | "organic";
type Source = "facebook" | "instagram" | "google" | "tiktok" | "youtube" | "email" | "affiliate" | "referral";

const TRACKING_DOMAIN = "https://trk.yourdomain.com"; // <-- твой домен
const SHORT_PREFIX = "/c/";
const LONG_PREFIX = "/l/";

const PRESETS: Record<
  Preset,
  { title: string; subtitle: string; defaults: { utm_source: Source; utm_medium: Medium } }
> = {
  meta: {
    title: "Meta Ads",
    subtitle: "Facebook / Instagram",
    defaults: { utm_source: "facebook", utm_medium: "paid_social" },
  },
  google: {
    title: "Google Ads",
    subtitle: "Search / Display",
    defaults: { utm_source: "google", utm_medium: "cpc" },
  },
  tiktok: {
    title: "TikTok Ads",
    subtitle: "TikTok traffic",
    defaults: { utm_source: "tiktok", utm_medium: "paid_social" },
  },
  influencer: {
    title: "Influencer",
    subtitle: "Blogger / promo",
    defaults: { utm_source: "instagram", utm_medium: "influencer" },
  },
  custom: {
    title: "Custom",
    subtitle: "Manual UTM required",
    defaults: { utm_source: "referral", utm_medium: "referral" },
  },
};

function clsx(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function normalizeUrl(input: string) {
  const u = (input || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

async function copyToClipboard(text: string) {
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

/**
 * API (идеально):
 * POST /api/links
 * body: { destination_url, preset, label?, cid?, aid?, params: {key:value}, collect_click_ids, collect_ad_ids, pass_to_landing }
 * -> { token, short_url, long_url }
 *
 * Тут mock чтобы UI сразу жил.
 */
async function apiCreateLink(payload: {
  destination_url: string;
  preset: Preset;
  label?: string;
  cid?: string;
  aid?: string;
  params: Record<string, string>; // <-- тут utm_campaign/content/term и любые доп. параметры
  pass_to_landing: boolean;
  collect_click_ids: boolean;
  collect_ad_ids: boolean;
}) {
  const token =
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

  const sp = new URLSearchParams();

  // long URL = удобная “обычная”, читаемая, на твоем домене (можно давать подрядчикам)
  // В проде лучше whitelist ключей (utm_*, cid, aid, etc)
  sp.set("utm_source", payload.params.utm_source || "");
  sp.set("utm_medium", payload.params.utm_medium || "");

  for (const [k, v] of Object.entries(payload.params)) {
    if (!v?.trim()) continue;
    sp.set(k, v.trim());
  }

  if (payload.cid) sp.set("cid", payload.cid);
  if (payload.aid) sp.set("aid", payload.aid);

  // (опционально) показываем placeholders в long, но в проде можно не передавать — хранить в БД
  if (payload.collect_ad_ids) {
    if (payload.preset === "meta") {
      sp.set("campaign_id", "{{campaign.id}}");
      sp.set("adset_id", "{{adset.id}}");
      sp.set("ad_id", "{{ad.id}}");
    }
    if (payload.preset === "google") {
      sp.set("campaign_id", "{campaignid}");
      sp.set("adgroup_id", "{adgroupid}");
      sp.set("creative_id", "{creative}");
    }
    if (payload.preset === "tiktok") {
      sp.set("campaign_id", "__CAMPAIGN_ID__");
      sp.set("adgroup_id", "__ADGROUP_ID__");
      sp.set("ad_id", "__AD_ID__");
    }
  }

  if (payload.collect_click_ids) {
    if (payload.preset === "meta") sp.set("fbclid", "{fbclid}");
    if (payload.preset === "google") sp.set("gclid", "{gclid}");
    if (payload.preset === "tiktok") sp.set("ttclid", "{ttclid}");
  }

  const long_url = `${TRACKING_DOMAIN}${LONG_PREFIX}${token}${sp.toString() ? `?${sp.toString()}` : ""}`;
  const short_url = `${TRACKING_DOMAIN}${SHORT_PREFIX}${token}`;
  return { token, long_url, short_url };
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-white text-black hover:opacity-90"
      : "border border-white/10 bg-white/5 text-white/90 hover:bg-white/10";
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={clsx(base, styles)}>
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={clsx(
        "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 outline-none",
        "focus:border-white/20 focus:bg-white/7",
        className
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select
      {...rest}
      className={clsx(
        "w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none",
        "focus:border-white/20 focus:bg-white/7",
        className
      )}
    >
      {children}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/7">
      <div>
        <div className="text-sm text-white">{label}</div>
        {hint ? <div className="mt-1 text-xs text-white/50">{hint}</div> : null}
      </div>
      <span
        className={clsx(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition",
          checked ? "border-white/20 bg-white/20" : "border-white/10 bg-white/5"
        )}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
      >
        <span className={clsx("inline-block h-5 w-5 transform rounded-full bg-white transition", checked ? "translate-x-5" : "translate-x-1")} />
      </span>
    </label>
  );
}

function Details({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/5" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-white/55">{subtitle}</div> : null}
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 group-open:bg-white/10">
          {defaultOpen ? "open" : "details"}
        </div>
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}

/** Tooltip без библиотек */
function Tip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center">
      <span className="group inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-white/70">
        i
        <span className="pointer-events-none absolute left-1/2 top-7 z-20 hidden w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0B0F17] px-3 py-2 text-xs text-white/80 shadow-xl group-hover:block">
          {text}
        </span>
      </span>
    </span>
  );
}

type KV = { key: string; value: string };

export default function LinkBuilder() {
  const [preset, setPreset] = useState<Preset>("meta");
  const [destinationUrl, setDestinationUrl] = useState("https://onvibe.me/event/838");
  const [label, setLabel] = useState("");

  const [cid, setCid] = useState("company_239");
  const [aid, setAid] = useState("");

  // обязательные UTM поля (для custom — строго required)
  const [utmSource, setUtmSource] = useState<Source>(PRESETS.meta.defaults.utm_source);
  const [utmMedium, setUtmMedium] = useState<Medium>(PRESETS.meta.defaults.utm_medium);

  // остальные UTM как “параметры”
  const [utmParams, setUtmParams] = useState<KV[]>([
    { key: "utm_campaign", value: "standup_almaty" },
    { key: "utm_content", value: "" },
    { key: "utm_term", value: "" },
  ]);

  // дополнительные параметры (опционально)
  const [extraParams, setExtraParams] = useState<KV[]>([]);
  const [collectClickIds, setCollectClickIds] = useState(true);
  const [collectAdIds, setCollectAdIds] = useState(true);
  const [passToLanding, setPassToLanding] = useState(false);

  // ui state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ token: string; long_url: string; short_url: string } | null>(null);
  const [copied, setCopied] = useState<"" | "short" | "long" | "both">("");

  const normalizedDestination = useMemo(() => normalizeUrl(destinationUrl), [destinationUrl]);
  const meta = useMemo(() => PRESETS[preset], [preset]);

  // Когда меняем preset — обновляем только utm_source/utm_medium (остальные UTM оставляем как есть)
  useEffect(() => {
    setUtmSource(meta.defaults.utm_source);
    setUtmMedium(meta.defaults.utm_medium);
  }, [meta.defaults.utm_medium, meta.defaults.utm_source]);

  const isCustom = preset === "custom";

  const paramsObject = useMemo(() => {
    const obj: Record<string, string> = {
      utm_source: utmSource,
      utm_medium: utmMedium,
    };

    for (const row of utmParams) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (!k) continue;
      if (!v) continue;
      obj[k] = v;
    }

    for (const row of extraParams) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (!k) continue;
      if (!v) continue;
      obj[k] = v;
    }

    return obj;
  }, [utmSource, utmMedium, utmParams, extraParams]);

  const compactChips = useMemo(() => {
    const chips: string[] = [];
    chips.push(`utm_source=${utmSource}`);
    chips.push(`utm_medium=${utmMedium}`);
    const c = paramsObject.utm_campaign;
    if (c) chips.push(`utm_campaign=${c}`);
    if (cid.trim()) chips.push(`cid=${cid.trim()}`);
    if (aid.trim()) chips.push(`aid=${aid.trim()}`);
    chips.push(collectAdIds ? "ad_ids:on" : "ad_ids:off");
    chips.push(collectClickIds ? "click_ids:on" : "click_ids:off");
    chips.push(passToLanding ? "pass:on" : "pass:off");
    return chips;
  }, [utmSource, utmMedium, paramsObject, cid, aid, collectAdIds, collectClickIds, passToLanding]);

  const customMissing = useMemo(() => {
    if (!isCustom) return [];
    const missing: string[] = [];
    if (!utmSource?.trim()) missing.push("utm_source");
    if (!utmMedium?.trim()) missing.push("utm_medium");
    // можно расширить: требовать utm_campaign
    // if (!paramsObject.utm_campaign) missing.push("utm_campaign");
    return missing;
  }, [isCustom, utmSource, utmMedium]);

  const canCreate = useMemo(() => {
    if (!normalizedDestination) return false;
    if (customMissing.length) return false;
    return true;
  }, [normalizedDestination, customMissing.length]);

  function updateKV(list: KV[], idx: number, patch: Partial<KV>) {
    return list.map((row, i) => (i === idx ? { ...row, ...patch } : row));
  }
  function removeKV(list: KV[], idx: number) {
    return list.filter((_, i) => i !== idx);
  }

  async function handleCreate() {
    setError("");
    setCopied("");
    setResult(null);

    if (!normalizedDestination) {
      setError("Вставь Destination URL.");
      return;
    }
    try {
      new URL(normalizedDestination);
    } catch {
      setError("URL некорректный. Пример: https://site.com/page");
      return;
    }

    if (customMissing.length) {
      setError(`Custom preset: заполни обязательные поля: ${customMissing.join(", ")}`);
      return;
    }

    setCreating(true);
    try {
      const res = await apiCreateLink({
        destination_url: normalizedDestination,
        preset,
        label: label.trim() || undefined,
        cid: cid.trim() || undefined,
        aid: aid.trim() || undefined,
        params: paramsObject,
        pass_to_landing: passToLanding,
        collect_click_ids: collectClickIds,
        collect_ad_ids: collectAdIds,
      });

      setResult(res);
      await copyToClipboard(res.short_url);
      setCopied("short");
      setTimeout(() => setCopied(""), 1200);
    } catch {
      setError("Не удалось создать ссылку. Проверь API.");
    } finally {
      setCreating(false);
    }
  }

  async function copyShort() {
    if (!result) return;
    await copyToClipboard(result.short_url);
    setCopied("short");
    setTimeout(() => setCopied(""), 1200);
  }
  async function copyLong() {
    if (!result) return;
    await copyToClipboard(result.long_url);
    setCopied("long");
    setTimeout(() => setCopied(""), 1200);
  }
  async function copyBoth() {
    if (!result) return;
    await copyToClipboard(`SHORT:\n${result.short_url}\n\nLONG:\n${result.long_url}`);
    setCopied("both");
    setTimeout(() => setCopied(""), 1200);
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      {/* subtle decor */}
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-120px] h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0B0F17]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-sm text-white/60">Tracking</div>
            <h1 className="text-xl font-semibold">Link Builder</h1>
            <div className="mt-1 text-sm text-white/55">
              Domain: <span className="font-mono text-white/80">{TRACKING_DOMAIN}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={copyBoth} disabled={!result}>
              {copied === "both" ? "Скопировано" : "Copy both"}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !canCreate}>
              {creating ? "Создаю..." : "Создать ссылку"}
            </Button>
          </div>
        </div>
      </div>

      {/* content */}
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12">
        {/* left */}
        <div className="lg:col-span-7 space-y-4">
          {/* main card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm text-white/60">Step 1</div>
                <div className="mt-1 text-base font-semibold">Destination + IDs</div>
                <div className="mt-1 text-sm text-white/55">Минимум полей, максимум данных на бэке.</div>
              </div>
              <Badge>short + long</Badge>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div>
                <div className="mb-2 text-sm text-white/70">Destination URL</div>
                <Input value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} placeholder="https://onvibe.me/event/838" />
                {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm text-white/70">Label (optional)</div>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Standup / Video A" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm text-white/70">
                      cid <Tip text="Company ID. Идентификатор компании/проекта внутри твоего SaaS. Нужен чтобы склеивать клики/лиды/покупки именно к этой компании." />
                    </div>
                    <Input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="company_239" />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm text-white/70">
                      aid <Tip text="Agency ID. Идентификатор агентства/подрядчика. Нужен для мульти-агентств: кто привёл клик и как делить отчётность." />
                    </div>
                    <Input value={aid} onChange={(e) => setAid(e.target.value)} placeholder="agency_12" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {compactChips.map((c) => (
                <span key={c} className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* Step 2 dropdown */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-white/60">Step 2</div>
                <div className="mt-1 text-base font-semibold">Traffic source preset</div>
              </div>
              <Badge>{PRESETS[preset].title}</Badge>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm text-white/70">Preset</div>
                <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                  <option value="meta">Meta Ads</option>
                  <option value="google">Google Ads</option>
                  <option value="tiktok">TikTok Ads</option>
                  <option value="influencer">Influencer</option>
                  <option value="custom">Custom</option>
                </Select>
                <div className="mt-2 text-xs text-white/50">{PRESETS[preset].subtitle}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs text-white/45">Auto UTM</div>
                <div className="mt-2 text-sm text-white/70">
                  utm_source=<span className="font-mono text-white/85">{utmSource}</span>{" "}
                  · utm_medium=<span className="font-mono text-white/85">{utmMedium}</span>
                </div>

                {isCustom ? (
                  <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-200/90">
                    <b>Custom preset:</b> обязательно задай корректные UTM, иначе атрибуция будет мусорной.
                    {customMissing.length ? (
                      <div className="mt-1 text-xs text-yellow-200/80">
                        Missing: <span className="font-mono">{customMissing.join(", ")}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* grouped blocks */}
          <div className="space-y-4">
            <Details
              title="UTM parameters"
              subtitle="utm_campaign / utm_content / utm_term — как параметры (key=value)"
              defaultOpen={true}
            >
              <div className="space-y-3">
                {utmParams.map((row, idx) => (
                  <div key={`${row.key}-${idx}`} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="md:col-span-4">
                      <div className="mb-2 text-xs text-white/45">key</div>
                      <Input
                        value={row.key}
                        onChange={(e) => setUtmParams((p) => updateKV(p, idx, { key: e.target.value }))}
                        placeholder="utm_campaign"
                      />
                    </div>
                    <div className="md:col-span-7">
                      <div className="mb-2 text-xs text-white/45">value</div>
                      <Input
                        value={row.value}
                        onChange={(e) => setUtmParams((p) => updateKV(p, idx, { value: e.target.value }))}
                        placeholder="standup_almaty"
                      />
                    </div>
                    <div className="md:col-span-1 flex items-end">
                      <button
                        type="button"
                        onClick={() => setUtmParams((p) => removeKV(p, idx))}
                        className="h-[46px] w-full rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setUtmParams((p) => [...p, { key: "", value: "" }])}
                  >
                    + Add param
                  </Button>
                  <div className="text-xs text-white/45">
                    Совет: держи UTM канонично, а “нейминг” (например campaign) можно генерировать на сервере из label/даты.
                  </div>
                </div>
              </div>
            </Details>

            <Details title="Extra parameters" subtitle="Любые дополнительные key=value (whitelist на сервере)" defaultOpen={false}>
              <div className="space-y-3">
                {extraParams.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
                    Пока пусто. Добавь параметры если нужно (например placement, region, partner_id).
                  </div>
                ) : null}

                {extraParams.map((row, idx) => (
                  <div key={`${row.key}-${idx}`} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="md:col-span-4">
                      <div className="mb-2 text-xs text-white/45">key</div>
                      <Input
                        value={row.key}
                        onChange={(e) => setExtraParams((p) => updateKV(p, idx, { key: e.target.value }))}
                        placeholder="placement"
                      />
                    </div>
                    <div className="md:col-span-7">
                      <div className="mb-2 text-xs text-white/45">value</div>
                      <Input
                        value={row.value}
                        onChange={(e) => setExtraParams((p) => updateKV(p, idx, { value: e.target.value }))}
                        placeholder="feed"
                      />
                    </div>
                    <div className="md:col-span-1 flex items-end">
                      <button
                        type="button"
                        onClick={() => setExtraParams((p) => removeKV(p, idx))}
                        className="h-[46px] w-full rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}

                <Button variant="secondary" onClick={() => setExtraParams((p) => [...p, { key: "", value: "" }])}>
                  + Add extra
                </Button>
              </div>
            </Details>

            <Details title="Tracking options" subtitle="Что собирать на клике + прокидывать ли параметры на лендинг" defaultOpen={false}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Toggle checked={collectAdIds} onChange={setCollectAdIds} label="Collect Ad IDs" hint="campaign/adset/ad ids" />
                <Toggle checked={collectClickIds} onChange={setCollectClickIds} label="Collect Click IDs" hint="fbclid/gclid/ttclid" />
                <Toggle checked={passToLanding} onChange={setPassToLanding} label="Pass to landing" hint="обычно OFF" />
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
                Рекомендация: <b>pass to landing = OFF</b>. Параметры храним у себя, ставим cookie и склеиваем Purchase/Lead позже.
              </div>
            </Details>
          </div>
        </div>

        {/* right */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-[92px] space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-white/60">Output</div>
                  <div className="mt-1 text-base font-semibold">Two links</div>
                  <div className="mt-1 text-sm text-white/55">
                    Short копируется автоматически после создания.
                  </div>
                </div>
                <Badge>{PRESETS[preset].title}</Badge>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-white/45">Short link</div>
                    <Button variant="secondary" onClick={copyShort} disabled={!result}>
                      {copied === "short" ? "Скопировано" : "Copy"}
                    </Button>
                  </div>
                  <div className="mt-2 break-all font-mono text-sm text-white/90">
                    {result?.short_url || `${TRACKING_DOMAIN}${SHORT_PREFIX}{token}`}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-white/45">Long link</div>
                    <Button variant="secondary" onClick={copyLong} disabled={!result}>
                      {copied === "long" ? "Скопировано" : "Copy"}
                    </Button>
                  </div>
                  <div className="mt-2 break-all font-mono text-sm text-white/80">
                    {result?.long_url || `${TRACKING_DOMAIN}${LONG_PREFIX}{token}?utm_source=...&utm_medium=...`}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button onClick={handleCreate} disabled={creating || !canCreate}>
                  {creating ? "Создаю..." : "Создать / Обновить"}
                </Button>
                <Button variant="secondary" onClick={copyBoth} disabled={!result}>
                  {copied === "both" ? "Скопировано" : "Copy both"}
                </Button>
              </div>

              {!canCreate && isCustom && customMissing.length ? (
                <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-200/90">
                  Чтобы создать ссылку в <b>Custom</b>, заполни:{" "}
                  <span className="font-mono">{customMissing.join(", ")}</span>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold">Quick summary</div>
              <div className="mt-2 space-y-2 text-sm text-white/65">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-white/45">Destination</div>
                  <div className="mt-1 break-all font-mono text-xs text-white/75">{normalizedDestination || "—"}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-white/45">Params (stored)</div>
                  <div className="mt-1 break-words">
                    utm_source=<span className="font-mono text-white/80">{utmSource}</span> · utm_medium=<span className="font-mono text-white/80">{utmMedium}</span>
                    {paramsObject.utm_campaign ? ` · utm_campaign=${paramsObject.utm_campaign}` : ""}
                    {cid.trim() ? ` · cid=${cid.trim()}` : ""}
                    {aid.trim() ? ` · aid=${aid.trim()}` : ""}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-white/45">On click</div>
                  <div className="mt-1">
                    token · ip · ua · referer · time · {collectClickIds ? "click_ids" : "—"} · {collectAdIds ? "ad_ids" : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/60">
              Если хочешь ещё меньше ручных действий: можно на сервере автоматически ставить
              <b> utm_campaign</b> из <b>label</b> + даты/проекта, а в UI оставить только URL и preset.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}