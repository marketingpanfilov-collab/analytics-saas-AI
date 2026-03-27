import { createServerSupabase } from "@/app/lib/supabaseServer";
import { getCurrentSystemRoleCheck, type SystemRole } from "@/app/lib/auth/systemRoles";

export type OrgAdminOrSystemRoleResult =
  | {
      ok: true;
      userId: string;
      source: "org_admin" | "system_role";
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

export async function requireOrgAdminOrSystemRole(
  allowedSystemRoles: SystemRole[] = ["service_admin", "support", "ops_manager"]
): Promise<OrgAdminOrSystemRoleResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const [sys, orgCheck] = await Promise.all([
    getCurrentSystemRoleCheck(allowedSystemRoles),
    supabase
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .limit(1),
  ]);

  if (sys.hasAnyAllowedRole) {
    return { ok: true, userId: user.id, source: "system_role" };
  }
  if (orgCheck.data && orgCheck.data.length > 0) {
    return { ok: true, userId: user.id, source: "org_admin" };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

