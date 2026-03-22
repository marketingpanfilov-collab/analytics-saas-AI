/**
 * Attribution Debugger v5: Suggested Fixes per Chain
 * Generates product-level recommendations from gaps, match_quality, and chain data.
 * No DB calls — computed after chains are built.
 */

import type { ChainItem, SuggestedFix, SuggestedFixSeverity, SuggestedFixType } from "./attributionDebugger";

export type { SuggestedFix, SuggestedFixSeverity, SuggestedFixType } from "./attributionDebugger";

const MAX_SUGGESTIONS = 5;
const SEVERITY_ORDER: Record<SuggestedFixSeverity, number> = { high: 0, medium: 1, low: 2 };

function dedupeByType(fixes: SuggestedFix[]): SuggestedFix[] {
  const seen = new Set<SuggestedFixType>();
  return fixes.filter((f) => {
    if (seen.has(f.type)) return false;
    seen.add(f.type);
    return true;
  });
}

function sortAndCap(fixes: SuggestedFix[]): SuggestedFix[] {
  const deduped = dedupeByType(fixes);
  return deduped
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_SUGGESTIONS);
}

/** Rule: Conversion events missing click_id while chain has click or visit */
function ruleMissingClickId(chain: ChainItem): SuggestedFix | null {
  if (!chain.click.exists) return null;
  const hasVisit = chain.visits.length > 0;
  const regMissing = chain.registrations.some((r) => !r.click_id);
  const purchMissing = chain.purchases.some((p) => !p.click_id);
  if ((regMissing || purchMissing) && (hasVisit || chain.click.exists))
    return {
      severity: "high",
      type: "missing_click_id",
      title: "Conversion events are missing click_id",
      description:
        "Registrations or purchases were not linked to a click. This usually means the landing page does not pass bqcid to the pixel.",
      suggested_action: "Ensure your pixel sends click_id (bqcid) with registration and purchase events.",
      impact: "Improves attribution accuracy",
    };
  return null;
}

const VALID_NO_SOURCE_STATES = ["direct", "organic_search", "referral"] as const;

/** Rule: Visit has lost attribution (paid referrer but no click_id/UTM) or missing source when not valid */
function ruleVisitWithoutSource(chain: ChainItem): SuggestedFix | null {
  if (chain.visits.length === 0) return null;
  const hasLostAttribution = chain.visits.some((v) => v.attribution_state === "missing_expected_attribution");
  const hasVisitWithoutSourceAndNotValid = chain.visits.some(
    (v) =>
      !v.traffic_source &&
      v.attribution_state != null &&
      !VALID_NO_SOURCE_STATES.includes(v.attribution_state as (typeof VALID_NO_SOURCE_STATES)[number])
  );
  if (hasLostAttribution)
    return {
      severity: "high",
      type: "visit_lost_attribution",
      title: "Потеря атрибуции",
      description: "Визиты с рекламного/социального источника приходят без click_id и UTM — метки теряются.",
      suggested_action: "Проверьте передачу UTM и click_id с landing URL в pixel/source-запросах.",
      impact: "Точная атрибуция платного трафика",
    };
  if (hasVisitWithoutSourceAndNotValid)
    return {
      severity: "medium",
      type: "visit_without_traffic_source",
      title: "У визита отсутствует источник трафика",
      description: "Часть визитов без определённого источника (ожидаются UTM или click_id).",
      suggested_action: "Проверьте использование tracking-ссылок и передачу UTM или click_id на визит.",
      impact: "Лучшая отчётность по источникам",
    };
  return null;
}

/** Rule: Purchase missing value or currency */
function rulePurchaseWithoutValue(chain: ChainItem): SuggestedFix | null {
  const anyMissing = chain.purchases.some(
    (p) => p.value == null || p.value === undefined || !p.currency
  );
  if (chain.purchases.length > 0 && anyMissing)
    return {
      severity: "high",
      type: "purchase_without_value",
      title: "Purchase events missing revenue data",
      description: "Some purchase events do not have value or currency, so revenue cannot be calculated.",
      suggested_action: "Ensure purchase events send both value and currency.",
      impact: "Accurate revenue attribution",
    };
  return null;
}

/** Rule: match_quality is low */
function ruleWeakMatchQuality(chain: ChainItem): SuggestedFix | null {
  if (chain.match_quality !== "low") return null;
  return {
    severity: "medium",
    type: "weak_match_quality",
    title: "Weak attribution match",
    description: "Conversions are linked mainly by user_external_id instead of click or visitor.",
    suggested_action: "Link conversions using click_id instead of only user_external_id.",
    impact: "Stronger attribution confidence",
  };
}

/** Rule: Click exists but no visit */
function ruleNoVisitAfterClick(chain: ChainItem): SuggestedFix | null {
  if (chain.click.exists && chain.visits.length === 0)
    return {
      severity: "medium",
      type: "no_visit_after_click",
      title: "No visit detected after click",
      description: "A click was recorded but no visit on the landing page. The user may have bounced or the pixel did not fire.",
      suggested_action: "Ensure the landing page pixel loads correctly.",
      impact: "Complete click-to-visit funnel",
    };
  return null;
}

/** Rule: Purchase missing user_external_id */
function rulePurchaseWithoutUserId(chain: ChainItem): SuggestedFix | null {
  const anyMissing = chain.purchases.some((p) => !p.user_external_id);
  if (chain.purchases.length > 0 && anyMissing)
    return {
      severity: "medium",
      type: "purchase_without_user_id",
      title: "Purchase missing user identifier",
      description: "Some purchases do not have user_external_id, which limits cross-session attribution.",
      suggested_action: "Send user_external_id with purchase events.",
      impact: "Better user-level attribution",
    };
  return null;
}

/** Rule: Registration exists but not linked by click_id */
function ruleRegistrationNotLinked(chain: ChainItem): SuggestedFix | null {
  const anyNotByClick = chain.registrations.some((r) => !r.click_id);
  if (chain.registrations.length > 0 && anyNotByClick)
    return {
      severity: "medium",
      type: "registration_not_linked",
      title: "Registration not linked to click",
      description: "Some registrations were linked only by visitor_id, not by click_id.",
      suggested_action: "Pass click_id from landing page to registration event.",
      impact: "Direct click-to-registration attribution",
    };
  return null;
}

const RULES: Array<(chain: ChainItem) => SuggestedFix | null> = [
  ruleMissingClickId,
  ruleVisitWithoutSource,
  rulePurchaseWithoutValue,
  ruleWeakMatchQuality,
  ruleNoVisitAfterClick,
  rulePurchaseWithoutUserId,
  ruleRegistrationNotLinked,
];

/**
 * Analyzes a chain and returns up to MAX_SUGGESTIONS (5) suggested fixes,
 * ordered by severity (high first), no duplicate types.
 */
export function generateChainSuggestions(chain: ChainItem): SuggestedFix[] {
  const fixes: SuggestedFix[] = [];
  for (const rule of RULES) {
    const fix = rule(chain);
    if (fix) fixes.push(fix);
  }
  return sortAndCap(fixes);
}
