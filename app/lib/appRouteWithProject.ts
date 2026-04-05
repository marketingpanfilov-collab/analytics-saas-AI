/** Append `project_id` for project-scoped app routes (settings, accounts, etc.). */
export function withProjectIdParam(basePath: string, projectId: string | null | undefined): string {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}project_id=${encodeURIComponent(id)}`;
}

/** Настройки → Управление доступом → вкладка участников проекта (не org-level). */
export function settingsProjectAccessMembersUrl(projectId: string | null | undefined): string {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) return "/app/settings";
  const p = new URLSearchParams();
  p.set("project_id", id);
  p.set("section", "access");
  p.set("tab", "project");
  return `/app/settings?${p.toString()}`;
}
