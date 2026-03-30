/**
 * Нормализация источника привлечения — в духе LTV и фильтра главного дашборда.
 */

const CANONICAL_SOURCES = ["meta", "google", "tiktok", "yandex", "direct", "organic_search", "referral"] as const;

export function normalizeAcquisitionSource(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "direct";
  const v = String(raw).trim().toLowerCase();
  if ((CANONICAL_SOURCES as readonly string[]).includes(v)) return v;
  if (v === "organic_social") return "referral";
  if (v === "paid" || v === "unknown") return "direct";
  return v;
}

/** Если traffic_source пуст, пробуем вывести платформу из traffic_platform (facebook_ads, google_ads, …). */
export function inferPaidSourceFromTrafficPlatform(tp: string | null | undefined): string | null {
  if (!tp?.trim()) return null;
  const p = tp.toLowerCase();
  if (p.includes("facebook") || p.includes("meta") || p.includes("instagram")) return "meta";
  if (p.includes("google")) return "google";
  if (p.includes("tiktok")) return "tiktok";
  if (p.includes("yandex")) return "yandex";
  return null;
}

/** Ключ канала для одной строки покупки в conversion_events. */
export function acquisitionChannelKeyFromConversionRow(
  trafficSource: string | null | undefined,
  trafficPlatform: string | null | undefined
): string {
  const raw = trafficSource?.trim();
  if (raw) return normalizeAcquisitionSource(raw);
  const fromPlat = inferPaidSourceFromTrafficPlatform(trafficPlatform);
  if (fromPlat) return fromPlat;
  return "direct";
}
