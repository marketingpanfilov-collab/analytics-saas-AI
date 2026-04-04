import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { billingAnalyticsReadGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { isCompanySizeValue } from "@/app/lib/companySize";
import { isCompanySphereValue } from "@/app/lib/companySphere";

/**
 * GET /api/organizations/profile?project_id=...
 * PATCH — body: { project_id, name?, owner_full_name?, contact_phone?, company_size?, company_sphere? }
 * Данные CRM: таблица organization_crm_profiles. Название компании: organizations.name.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireProjectAccess(user.id, projectId);
  if (!access || !access.project.organization_id) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const orgId = access.project.organization_id;
  const admin = supabaseAdmin();

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();

  if (orgErr || !org) {
    return NextResponse.json(
      { success: false, error: orgErr?.message ?? "Organization not found" },
      { status: 500 }
    );
  }

  const { data: crm } = await admin
    .from("organization_crm_profiles")
    .select("owner_full_name, contact_phone, company_size, company_sphere, about_company")
    .eq("organization_id", orgId)
    .maybeSingle();

  const { data: ownerRow } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .maybeSingle();

  let ownerEmail: string | null = null;
  if (ownerRow?.user_id) {
    const { data: u } = await admin.auth.admin.getUserById(ownerRow.user_id as string);
    ownerEmail = u.user?.email ?? null;
  }

  const canEdit = access.membership.role === "owner";

  return NextResponse.json({
    success: true,
    organization: {
      id: org.id,
      name: org.name ?? "",
      about_company: crm?.about_company ?? "",
      owner_full_name: crm?.owner_full_name ?? "",
      contact_phone: crm?.contact_phone ?? "",
      company_size: crm?.company_size ?? null,
      company_sphere: crm?.company_sphere ?? null,
    },
    owner_email: ownerEmail,
    can_edit: canEdit,
  });
}

export async function PATCH(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const billingPre = await billingAnalyticsReadGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const access = await requireProjectAccess(user.id, projectId);
  if (!access || !access.project.organization_id) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  if (access.membership.role !== "owner") {
    return NextResponse.json({ success: false, error: "Only the organization owner can edit" }, { status: 403 });
  }

  const orgId = access.project.organization_id;
  const admin = supabaseAdmin();

  const orgPatch: Record<string, string> = {};
  const crmPatch: Record<string, string | null> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ success: false, error: "Название компании не может быть пустым" }, { status: 400 });
    }
    orgPatch.name = name;
  }
  if ("about_company" in body) {
    crmPatch.about_company =
      typeof body.about_company === "string" ? body.about_company.trim() : "";
  }
  if ("owner_full_name" in body) {
    crmPatch.owner_full_name =
      typeof body.owner_full_name === "string" ? body.owner_full_name.trim() : "";
  }
  if ("contact_phone" in body) {
    crmPatch.contact_phone =
      typeof body.contact_phone === "string" ? body.contact_phone.trim() : "";
  }
  if ("company_size" in body) {
    const v = body.company_size;
    if (v === null || v === "") {
      crmPatch.company_size = null;
    } else if (isCompanySizeValue(v)) {
      crmPatch.company_size = v;
    } else {
      return NextResponse.json({ success: false, error: "Некорректный размер компании" }, { status: 400 });
    }
  }
  if ("company_sphere" in body) {
    const v = body.company_sphere;
    if (v === null || v === "") {
      crmPatch.company_sphere = null;
    } else if (isCompanySphereValue(v)) {
      crmPatch.company_sphere = v;
    } else {
      return NextResponse.json({ success: false, error: "Некорректная сфера компании" }, { status: 400 });
    }
  }

  if (Object.keys(orgPatch).length === 0 && Object.keys(crmPatch).length === 0) {
    return NextResponse.json({ success: false, error: "Нет полей для сохранения" }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (Object.keys(orgPatch).length > 0) {
    const { error: orgErr } = await admin
      .from("organizations")
      .update({ ...orgPatch, updated_at: now })
      .eq("id", orgId);
    if (orgErr) {
      return NextResponse.json({ success: false, error: orgErr.message }, { status: 500 });
    }
  }

  if (Object.keys(crmPatch).length > 0) {
    const { error: crmErr } = await admin.from("organization_crm_profiles").upsert(
      {
        organization_id: orgId,
        ...crmPatch,
        updated_at: now,
      },
      { onConflict: "organization_id" }
    );
    if (crmErr) {
      return NextResponse.json({ success: false, error: crmErr.message }, { status: 500 });
    }
  }

  const { data: orgRow } = await admin.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
  const { data: crmRow } = await admin
    .from("organization_crm_profiles")
    .select("owner_full_name, contact_phone, company_size, company_sphere, about_company")
    .eq("organization_id", orgId)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    organization: {
      id: orgRow?.id,
      name: orgRow?.name ?? "",
      about_company: crmRow?.about_company ?? "",
      owner_full_name: crmRow?.owner_full_name ?? "",
      contact_phone: crmRow?.contact_phone ?? "",
      company_size: crmRow?.company_size ?? null,
      company_sphere: crmRow?.company_sphere ?? null,
    },
  });
}
