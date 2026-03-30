import { NextResponse } from "next/server";
import { requireSystemRole } from "@/app/lib/auth/requireSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { formatCompanySizeLabel } from "@/app/lib/companySize";
import { formatCompanySphereLabel } from "@/app/lib/companySphere";

/**
 * GET /api/internal-admin/organizations/crm-outreach
 * Список организаций с CRM-полями и email владельца — для обзвонов и отчётов (service_admin, support, ops_manager).
 */
export async function GET() {
  const auth = await requireSystemRole(["service_admin", "support", "ops_manager"]);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const admin = supabaseAdmin();

  const { data: crmRows, error: crmErr } = await admin.from("organization_crm_profiles").select(`
      organization_id,
      owner_full_name,
      contact_phone,
      company_size,
      company_sphere,
      about_company,
      updated_at
    `);

  if (crmErr) {
    return NextResponse.json({ success: false, error: crmErr.message }, { status: 500 });
  }

  const crmList = crmRows ?? [];
  const orgIds = crmList.map((r: { organization_id: string }) => r.organization_id);

  if (orgIds.length === 0) {
    return NextResponse.json({ success: true, items: [] });
  }

  const { data: orgRows, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, slug")
    .in("id", orgIds);

  if (orgErr) {
    return NextResponse.json({ success: false, error: orgErr.message }, { status: 500 });
  }

  const orgById = new Map((orgRows ?? []).map((o: { id: string; name: string; slug: string }) => [o.id, o]));

  const { data: ownerMembers } = await admin
    .from("organization_members")
    .select("organization_id, user_id")
    .eq("role", "owner")
    .in("organization_id", orgIds);

  const ownerByOrg = new Map<string, string>();
  for (const row of ownerMembers ?? []) {
    const r = row as { organization_id: string; user_id: string };
    ownerByOrg.set(r.organization_id, r.user_id);
  }

  const uniqueUserIds = [...new Set(ownerByOrg.values())];
  const emailByUserId = new Map<string, string | null>();
  await Promise.all(
    uniqueUserIds.map(async (uid) => {
      try {
        const { data: u } = await admin.auth.admin.getUserById(uid);
        emailByUserId.set(uid, u.user?.email ?? null);
      } catch {
        emailByUserId.set(uid, null);
      }
    })
  );

  const items = crmList.map((r: Record<string, unknown>) => {
    const oid = r.organization_id as string;
    const uid = ownerByOrg.get(oid);
    const org = orgById.get(oid);
    const sizeRaw = (r.company_size as string | null) ?? null;
    const sphereRaw = (r.company_sphere as string | null) ?? null;
    return {
      organization_id: oid,
      company_name: org?.name ?? null,
      slug: org?.slug ?? null,
      owner_full_name: r.owner_full_name ?? null,
      owner_email: uid ? (emailByUserId.get(uid) ?? null) : null,
      contact_phone: r.contact_phone ?? null,
      company_size: sizeRaw,
      company_size_label: sizeRaw ? formatCompanySizeLabel(sizeRaw) : null,
      company_sphere: sphereRaw,
      company_sphere_label: sphereRaw ? formatCompanySphereLabel(sphereRaw) : null,
      about_company: r.about_company ?? null,
      crm_updated_at: r.updated_at ?? null,
    };
  });

  return NextResponse.json({ success: true, items });
}
