/**
 * Routes where over-limit users may fix usage (org / project list / billing-related).
 * On these paths the hard fullscreen is replaced by a top banner so the page stays usable.
 */
const REMEDIAL_PREFIXES = [
  "/app/projects",
  "/app/org-members",
  "/app/project-members",
  "/app/accounts",
  "/app/settings",
  "/app/support",
] as const;

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isOverLimitRemedialPathname(pathname: string): boolean {
  const p = normalizePathname(pathname || "");
  return REMEDIAL_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
