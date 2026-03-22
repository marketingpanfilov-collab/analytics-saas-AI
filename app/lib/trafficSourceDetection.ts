/**
 * Auto-detect traffic source and platform from click IDs, UTM, and referrer.
 * Priority: fbclid > gclid > ttclid > yclid > utm_source > referrer.
 * Raw params are kept as-is; use detected values for attribution/analytics.
 *
 * Attribution state: distinguishes valid absence of attribution (direct, organic, referral)
 * from paid-attributed traffic and from real attribution loss (missing_expected_attribution).
 */

export type TrafficDetectionInput = {
  fbclid?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  yclid?: string | null;
  utm_source?: string | null;
  referrer?: string | null;
};

export type TrafficDetectionResult = {
  traffic_source: string | null;
  traffic_platform: string | null;
};

/** Attribution state for quality scoring and debugger: do not penalize direct/organic/referral. */
export type AttributionState =
  | "paid_attributed"
  | "organic_search"
  | "referral"
  | "direct"
  | "missing_expected_attribution";

export type AttributionStateInput = {
  referrer?: string | null;
  utm_source?: string | null;
  click_id?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  yclid?: string | null;
};

const PAID_UTM_SOURCES = ["meta", "facebook", "fb", "instagram", "google", "tiktok", "yandex"];
const SEARCH_REFERRER_DOMAINS = ["google.", "bing.", "yandex.", "duckduckgo.", "yahoo."];
const PAID_REFERRER_DOMAINS = ["facebook.com", "fb.", "instagram.com", "google.", "tiktok.com", "yandex.", "yandex.ru"];

function referrerHost(referrer: string): string | null {
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function referrerMatchesDomains(referrer: string, domains: string[]): boolean {
  const host = referrerHost(referrer);
  if (!host) return false;
  return domains.some((d) => host.includes(d));
}

/**
 * Classify attribution state for a visit/conversion.
 * - paid_attributed: has click_id or paid signal (fbclid/gclid/ttclid/yclid or utm_source paid).
 * - organic_search: no paid signal, referrer is search engine.
 * - referral: referrer present, not search.
 * - direct: no referrer, no utm_source, no click_id.
 * - missing_expected_attribution: referrer suggests paid/social but no click_id and no utm (attribution lost).
 */
export function getAttributionState(input: AttributionStateInput): AttributionState {
  const hasClickId = hasValue(input.click_id);
  const hasUtmSource = hasValue(input.utm_source);
  const hasFbclid = hasValue(input.fbclid);
  const hasGclid = hasValue(input.gclid);
  const hasTtclid = hasValue(input.ttclid);
  const hasYclid = hasValue(input.yclid);
  const hasPaidClickId = hasFbclid || hasGclid || hasTtclid || hasYclid;
  const utmLower = (input.utm_source ?? "").trim().toLowerCase();
  const hasPaidUtm = hasUtmSource && PAID_UTM_SOURCES.some((s) => utmLower === s || utmLower.includes(s));
  const ref = (input.referrer ?? "").trim();
  const hasReferrer = ref.length > 0;

  if (hasClickId || hasPaidClickId || hasPaidUtm) {
    return "paid_attributed";
  }
  if (hasReferrer && referrerMatchesDomains(ref, SEARCH_REFERRER_DOMAINS)) {
    return "organic_search";
  }
  if (hasReferrer && referrerMatchesDomains(ref, PAID_REFERRER_DOMAINS)) {
    return "missing_expected_attribution";
  }
  if (hasReferrer) {
    return "referral";
  }
  return "direct";
}

/** UI labels for attribution_state (RU). */
export const ATTRIBUTION_STATE_LABELS: Record<AttributionState, string> = {
  paid_attributed: "Платный трафик",
  organic_search: "Органический поиск",
  referral: "Реферальный переход",
  direct: "Прямой переход",
  missing_expected_attribution: "Потеря атрибуции",
};

function hasValue(v?: string | null): boolean {
  return v != null && String(v).trim().length > 0;
}

function platformFromUtmSource(utmSource: string): TrafficDetectionResult {
  const s = utmSource.trim().toLowerCase();
  switch (s) {
    case "meta":
    case "facebook":
    case "fb":
    case "instagram":
      return { traffic_source: "meta", traffic_platform: "facebook_ads" };
    case "google":
      return { traffic_source: "google", traffic_platform: "google_ads" };
    case "tiktok":
      return { traffic_source: "tiktok", traffic_platform: "tiktok_ads" };
    case "yandex":
      return { traffic_source: "yandex", traffic_platform: "yandex_ads" };
    default:
      return { traffic_source: s || null, traffic_platform: null };
  }
}

function platformFromReferrerDomain(referrer: string): TrafficDetectionResult | null {
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host.includes("facebook.com") || host.includes("fb.") || host.includes("instagram.com")) {
      return { traffic_source: "meta", traffic_platform: "facebook_ads" };
    }
    if (host.includes("google.")) {
      return { traffic_source: "google", traffic_platform: "google_ads" };
    }
    if (host.includes("tiktok.com")) {
      return { traffic_source: "tiktok", traffic_platform: "tiktok_ads" };
    }
    if (host.includes("yandex.") || host.includes("yandex.ru")) {
      return { traffic_source: "yandex", traffic_platform: "yandex_ads" };
    }
  } catch {
    // invalid URL
  }
  return null;
}

/**
 * Detect traffic_source and traffic_platform by priority:
 * 1. fbclid -> meta / facebook_ads
 * 2. gclid -> google / google_ads
 * 3. ttclid -> tiktok / tiktok_ads
 * 4. yclid -> yandex / yandex_ads
 * 5. utm_source -> mapped to source/platform
 * 6. referrer domain -> fallback if known
 */
export function detectTrafficSource(input: TrafficDetectionInput): TrafficDetectionResult {
  if (hasValue(input.fbclid)) {
    return { traffic_source: "meta", traffic_platform: "facebook_ads" };
  }
  if (hasValue(input.gclid)) {
    return { traffic_source: "google", traffic_platform: "google_ads" };
  }
  if (hasValue(input.ttclid)) {
    return { traffic_source: "tiktok", traffic_platform: "tiktok_ads" };
  }
  if (hasValue(input.yclid)) {
    return { traffic_source: "yandex", traffic_platform: "yandex_ads" };
  }
  if (hasValue(input.utm_source)) {
    return platformFromUtmSource(input.utm_source!);
  }
  if (hasValue(input.referrer)) {
    const fromRef = platformFromReferrerDomain(input.referrer!);
    if (fromRef) return fromRef;
  }
  return { traffic_source: null, traffic_platform: null };
}
