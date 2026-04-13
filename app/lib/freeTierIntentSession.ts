/**
 * Session-scoped upgrade intent counter (Free tier): meaningful dashboard actions → soft upgrade modal at threshold.
 */
const COUNT_KEY = "boardiq_free_upgrade_intent_count_v1";
const MODAL_KEY = "boardiq_free_upgrade_intent_modal_v1";

function ss(): Storage | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export function getFreeTierIntentCount(): number {
  const raw = ss()?.getItem(COUNT_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Increments and returns the new count. */
export function bumpFreeTierIntentAction(): number {
  const s = ss();
  if (!s) return 0;
  const next = getFreeTierIntentCount() + 1;
  s.setItem(COUNT_KEY, String(next));
  return next;
}

export function freeTierIntentModalAlreadyShown(): boolean {
  return ss()?.getItem(MODAL_KEY) === "1";
}

export function markFreeTierIntentModalShown(): void {
  ss()?.setItem(MODAL_KEY, "1");
}

const ONCE_LTV_PAGE = "boardiq_intent_once_ltv_page_v1";
const ONCE_REPORTS_PAGE = "boardiq_intent_once_reports_page_v1";

export type IntentCounterKind = "ltv_page_view" | "reports_page_view";

/** Один раз за сессию на вкладку: увеличивает общий счётчик intent (для Free-апгрейда). */
export function bumpIntentCounter(kind: IntentCounterKind): void {
  const s = ss();
  if (!s) return;
  const flag = kind === "ltv_page_view" ? ONCE_LTV_PAGE : ONCE_REPORTS_PAGE;
  if (s.getItem(flag) === "1") return;
  s.setItem(flag, "1");
  bumpFreeTierIntentAction();
}

const ONCE_DASH_SOURCES = "boardiq_intent_dashboard_sources_explore_v1";

/** Один раз за сессию: открыли фильтр источников или аккаунтов на дашборде. */
export function bumpDashboardSourcesExploreOnce(): void {
  const s = ss();
  if (!s) return;
  if (s.getItem(ONCE_DASH_SOURCES) === "1") return;
  s.setItem(ONCE_DASH_SOURCES, "1");
  bumpFreeTierIntentAction();
}
