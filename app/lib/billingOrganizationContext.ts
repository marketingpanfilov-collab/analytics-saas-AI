/**
 * Which organization billing applies to for a user session, and payer resolution.
 * Used by billingCurrentPlan, Paddle upgrade context, and post-checkout flows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAccessibleProjectIds(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data: om } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);
  for (const m of om ?? []) {
    const role = String(m.role ?? "member");
    if (role === "owner" || role === "admin" || role === "agency") {
      const { data: projs } = await admin
        .from("projects")
        .select("id")
        .eq("organization_id", m.organization_id)
        .eq("archived", false);
      for (const p of projs ?? []) ids.add(String(p.id));
    }
  }
  const { data: pms } = await admin.from("project_members").select("project_id").eq("user_id", userId);
  const pids = [...new Set((pms ?? []).map((p) => p.project_id).filter(Boolean))] as string[];
  if (pids.length) {
    const { data: projs } = await admin.from("projects").select("id").in("id", pids).eq("archived", false);
    for (const p of projs ?? []) ids.add(String(p.id));
  }
  return ids;
}

export async function getPrimaryOwnerOrgId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: rows } = await admin
    .from("organization_members")
    .select("organization_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const list = rows ?? [];
  const owner = list.find((r) => String(r.role) === "owner");
  if (owner?.organization_id) return String(owner.organization_id);
  if (list[0]?.organization_id) return String(list[0].organization_id);
  return null;
}

const PAYER_ROLE_RANK: Record<string, number> = {
  owner: 0,
  admin: 1,
  agency: 2,
  member: 3,
};

function rankPayerRole(role: string): number {
  return PAYER_ROLE_RANK[String(role).toLowerCase()] ?? 99;
}

/**
 * Приоритет: organization_id открытого проекта → primary org (owner / первая в membership) → org первого доступного проекта.
 */
export async function resolveBillingOrganizationId(
  admin: SupabaseClient,
  userId: string,
  projectId: string | null | undefined,
  accessibleProjectIds: Set<string>
): Promise<string | null> {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (pid && accessibleProjectIds.has(pid)) {
    const { data: p } = await admin.from("projects").select("organization_id").eq("id", pid).maybeSingle();
    if (p?.organization_id) return String(p.organization_id);
  }
  const fromMembership = await getPrimaryOwnerOrgId(admin, userId);
  if (fromMembership) return fromMembership;
  const ids = [...accessibleProjectIds].filter(Boolean).sort();
  if (ids.length === 0) return null;
  const { data: rows } = await admin.from("projects").select("organization_id").in("id", ids);
  const orgs = new Set<string>();
  for (const r of rows ?? []) {
    if (r.organization_id) orgs.add(String(r.organization_id));
  }
  const sorted = [...orgs].sort();
  return sorted[0] ?? null;
}

/** Плательщик по организации: owner → admin → agency → member. */
export async function getBillingPayerUserForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<{ userId: string; email: string | null } | null> {
  const { data: rows, error } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organizationId);
  if (error || !rows?.length) return null;
  const sorted = [...rows].sort(
    (a, b) => rankPayerRole(String(a.role ?? "")) - rankPayerRole(String(b.role ?? ""))
  );
  const uid = String(sorted[0]!.user_id);
  const { data: authData, error: authErr } = await admin.auth.admin.getUserById(uid);
  if (authErr || !authData?.user) {
    return { userId: uid, email: null };
  }
  const em = authData.user.email?.trim().toLowerCase() || null;
  return { userId: uid, email: em };
}
