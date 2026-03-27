import { getCurrentSystemRoleCheck, type SystemRole } from "@/app/lib/auth/systemRoles";

export type RequireSystemRoleResult =
  | {
      ok: true;
      userId: string;
      roles: SystemRole[];
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

export async function requireSystemRole(allowed: SystemRole[]): Promise<RequireSystemRoleResult> {
  const auth = await getCurrentSystemRoleCheck(allowed);
  if (!auth.isAuthenticated) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!auth.hasAnyAllowedRole || !auth.userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, userId: auth.userId, roles: auth.roles };
}

