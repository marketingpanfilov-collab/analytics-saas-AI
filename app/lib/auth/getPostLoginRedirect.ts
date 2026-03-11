import type { CurrentUserContext } from "./getCurrentUserContext";

/**
 * Server-only. Resolves where to send the user after login / registration.
 * Entrypoint into the app is always project selection; user then picks a project.
 * - No user → /login
 * - Else → /app/projects (project selection first)
 */
export function getPostLoginRedirect(context: CurrentUserContext): string {
  if (!context.user) return "/login";
  return "/app/projects";
}
