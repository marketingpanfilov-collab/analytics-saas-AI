/**
 * Client-only. Key must match server cookie name in getCurrentUserContext.
 */
const ACTIVE_PROJECT_KEY = "active_project_id";
const COOKIE_MAX_AGE_DAYS = 365;

/**
 * Sets active project in cookie (for server getCurrentUserContext) and localStorage (for Sidebar).
 * Call before navigating to /app?project_id=...
 */
export function setActiveProjectId(projectId: string): void {
  const value = String(projectId).trim();
  if (!value) return;

  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, value);
  } catch {
    // ignore
  }

  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${ACTIVE_PROJECT_KEY}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}
