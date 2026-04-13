/**
 * Post-project sources onboarding modal (dashboard overlay).
 * Turn on when the flow is ready to ship again.
 */
export const POST_PROJECT_SOURCES_MODAL_ENABLED = false;

/** Client-only keys: post-project onboarding modal (1× per project). */
export function postProjectSourcesModalStorageKey(projectId: string): string {
  return `boardiq_post_project_sources_modal_v1_${projectId}`;
}

export function isPostProjectSourcesModalDone(projectId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(postProjectSourcesModalStorageKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function markPostProjectSourcesModalDone(projectId: string): void {
  try {
    localStorage.setItem(postProjectSourcesModalStorageKey(projectId), "1");
  } catch {
    /* ignore quota */
  }
}

const UPGRADE_HINT_DISMISS_KEY = "boardiq_free_upgrade_hint_banner_v1";

export function isFreeUpgradeHintBannerDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(UPGRADE_HINT_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissFreeUpgradeHintBanner(): void {
  try {
    sessionStorage.setItem(UPGRADE_HINT_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Session: at most one onboarding popup per browser tab session. */
export const ONBOARDING_SHOWN_SESSION_KEY = "onboarding_shown";

/** Lifetime cap: how many times the post-project onboarding popup was shown (all projects). */
export const ONBOARDING_VISITS_LS_KEY = "onboarding_visits";

export const ONBOARDING_POPUP_MAX_SHOWS = 3;

export function hasOnboardingShownThisSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(ONBOARDING_SHOWN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function getOnboardingPopupVisitCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(ONBOARDING_VISITS_LS_KEY);
    const n = parseInt(raw ?? "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Call once when the popup is actually displayed (not on dismiss). */
export function recordOnboardingPopupShown(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ONBOARDING_SHOWN_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
  try {
    const next = getOnboardingPopupVisitCount() + 1;
    localStorage.setItem(ONBOARDING_VISITS_LS_KEY, String(next));
  } catch {
    /* ignore quota */
  }
}

/** Call on sign-out so the next login in the same tab can show onboarding again (session cap). */
export function clearPostProjectOnboardingSessionGate(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ONBOARDING_SHOWN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
