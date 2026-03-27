import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export const SYSTEM_ROLES = ["service_admin", "support", "ops_manager"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export type SystemRoleCheckResult = {
  userId: string | null;
  roles: SystemRole[];
  isAuthenticated: boolean;
  hasAnyAllowedRole: boolean;
};

function normalizeRole(value: string): SystemRole | null {
  if (value === "service_admin" || value === "support" || value === "ops_manager") return value;
  return null;
}

export async function getCurrentSystemRoleCheck(allowed: SystemRole[]): Promise<SystemRoleCheckResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      userId: null,
      roles: [],
      isAuthenticated: false,
      hasAnyAllowedRole: false,
    };
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.from("system_user_roles").select("role").eq("user_id", user.id);
  if (error) {
    console.error("[systemRoles:getCurrentSystemRoleCheck]", error);
    return {
      userId: user.id,
      roles: [],
      isAuthenticated: true,
      hasAnyAllowedRole: false,
    };
  }

  const roles = (data ?? [])
    .map((r) => normalizeRole(String((r as { role?: string }).role ?? "")))
    .filter(Boolean) as SystemRole[];

  const hasAnyAllowedRole = roles.some((r) => allowed.includes(r));
  return {
    userId: user.id,
    roles,
    isAuthenticated: true,
    hasAnyAllowedRole,
  };
}

