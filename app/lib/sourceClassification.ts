/**
 * Source classification for first-party tracking.
 * Classifies visit source into: paid, organic_search, organic_social, referral, direct, unknown.
 */

export type SourceClassification =
  | "paid"
  | "organic_search"
  | "organic_social"
  | "referral"
  | "direct"
  | "unknown";

export type SourceInput = {
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  yclid?: string | null;
  ttclid?: string | null;
};

const PAID_MEDIA = ["cpc", "ppc", "paid", "cpm", "cpv"];
const SEARCH_DOMAINS = ["google.", "yandex.", "bing.", "yahoo.", "duckduckgo."];
const SOCIAL_DOMAINS = ["facebook.", "instagram.", "twitter.", "tiktok.", "linkedin.", "vk.", "vk.com", "ok.ru"];

function hasNonEmpty(value?: string | null): boolean {
  if (value == null) return false;
  return value.trim().length > 0;
}

function hasPaidClickId(input: SourceInput): boolean {
  return (
    hasNonEmpty(input.gclid) ||
    hasNonEmpty(input.fbclid) ||
    hasNonEmpty(input.yclid) ||
    hasNonEmpty(input.ttclid)
  );
}

function hasPaidUtmMedium(input: SourceInput): boolean {
  if (!hasNonEmpty(input.utm_medium)) return false;
  const m = input.utm_medium!.toLowerCase();
  return PAID_MEDIA.some((p) => m.includes(p));
}

function isPaid(input: SourceInput): boolean {
  return hasPaidClickId(input) || hasPaidUtmMedium(input);
}

function referrerMatches(referrer: string, domains: string[]): boolean {
  const lower = referrer.toLowerCase();
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return domains.some((d) => host.includes(d));
  } catch {
    return domains.some((d) => lower.includes(d));
  }
}

export function classifySource(input: SourceInput): SourceClassification {
  const refRaw = input.referrer ?? "";
  const ref = refRaw.trim();
  const hasRef = ref.length > 0;

  const hasUtm =
    hasNonEmpty(input.utm_source) ||
    hasNonEmpty(input.utm_medium) ||
    hasNonEmpty(input.utm_campaign);

  if (isPaid(input)) return "paid";
  if (hasRef && referrerMatches(ref, SEARCH_DOMAINS)) return "organic_search";
  if (hasRef && referrerMatches(ref, SOCIAL_DOMAINS)) return "organic_social";
  if (hasRef) return "referral";
  if (!hasRef && !hasUtm && !hasPaidClickId(input)) return "direct";
  return "unknown";
}
