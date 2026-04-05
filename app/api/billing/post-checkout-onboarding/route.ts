import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { isCompanySizeValue } from "@/app/lib/companySize";
import { isCompanySphereValue } from "@/app/lib/companySphere";
import {
  getPrimaryOwnerOrgId,
  isCompanyProfileCompleteForOrg,
  loadBillingCurrentPlan,
} from "@/app/lib/billingCurrentPlan";

/**
 * Организация для шага компании: сначала membership, иначе org из Paddle map (оплата до лишней org).
 * Иначе save_company создавал бы вторую org без подписки и ломал requires_post_checkout / биллинг.
 */
async function resolveOwnerOrgForPostCheckoutSave(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  emailNorm: string | null
): Promise<string | null> {
  const primary = await getPrimaryOwnerOrgId(admin, userId);
  if (primary) return primary;
  if (!emailNorm) return null;
  const { data: mapRow } = await admin
    .from("billing_customer_map")
    .select("organization_id")
    .eq("provider", "paddle")
    .eq("email", emailNorm)
    .not("organization_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orgId = mapRow?.organization_id ? String(mapRow.organization_id) : null;
  if (!orgId) return null;
  const { data: mem } = await admin
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!mem) {
    const { error } = await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: userId,
      role: "owner",
    });
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[post-checkout-onboarding] link owner to billing org failed", error.message);
      return null;
    }
  }
  return orgId;
}

/**
 * POST /api/billing/post-checkout-onboarding
 * Idempotent completion + same company fields as Settings → Company (organizations + CRM).
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  const email = (user.email ?? "").trim().toLowerCase() || null;

  const bodyProjectId =
    typeof body.project_id === "string" && body.project_id.trim().length > 0
      ? body.project_id.trim()
      : null;

  if (action === "advance_step" || action === "save_company" || action === "complete") {
    const snap = await loadBillingCurrentPlan(admin, user.id, email, {
      requestId: `pco-${randomUUID()}`,
      projectId: bodyProjectId,
    });
    if (!snap.success) {
      return NextResponse.json({ success: false, error: "Billing snapshot failed" }, { status: 500 });
    }
    if (!snap.requires_post_checkout_onboarding) {
      return NextResponse.json(
        { success: false, error: "Post-checkout onboarding is not active" },
        { status: 403 }
      );
    }
  }

  if (action === "advance_step") {
    const step = Number(body.step);
    if (!Number.isFinite(step) || step < 1 || step > 3) {
      return NextResponse.json({ success: false, error: "step must be 1..3" }, { status: 400 });
    }
    const st = Math.floor(step);
    const { data: pc } = await admin
      .from("user_post_checkout_onboarding")
      .select("user_id, completed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (pc?.completed_at) {
      return NextResponse.json({ success: true, current_step: st });
    }
    if (!pc) {
      const { error } = await admin.from("user_post_checkout_onboarding").insert({
        user_id: user.id,
        current_step: st,
        updated_at: now,
      });
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await admin
        .from("user_post_checkout_onboarding")
        .update({ current_step: st, updated_at: now })
        .eq("user_id", user.id);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ success: true, current_step: st });
  }

  if (action === "save_company") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ success: false, error: "Название компании обязательно" }, { status: 400 });
    }

    let orgId = await resolveOwnerOrgForPostCheckoutSave(admin, user.id, email);
    if (!orgId) {
      const slug = `org-${user.id.replace(/-/g, "").slice(0, 12)}-${Math.random().toString(36).slice(2, 10)}`;
      const { data: orgIns, error: oErr } = await admin
        .from("organizations")
        .insert({
          name,
          slug,
          updated_at: now,
        })
        .select("id")
        .single();
      if (oErr || !orgIns?.id) {
        return NextResponse.json(
          { success: false, error: oErr?.message ?? "Не удалось создать организацию" },
          { status: 500 }
        );
      }
      orgId = String(orgIns.id);
      const { error: mErr } = await admin.from("organization_members").insert({
        organization_id: orgId,
        user_id: user.id,
        role: "owner",
      });
      if (mErr) {
        return NextResponse.json({ success: false, error: mErr.message }, { status: 500 });
      }
    } else {
      const { data: mem } = await admin
        .from("organization_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (String(mem?.role) !== "owner") {
        return NextResponse.json(
          { success: false, error: "Только владелец организации может редактировать компанию" },
          { status: 403 }
        );
      }
    }
    const owner_full_name =
      typeof body.owner_full_name === "string" ? body.owner_full_name.trim() : "";
    if (!owner_full_name) {
      return NextResponse.json({ success: false, error: "ФИО обязательно" }, { status: 400 });
    }

    const company_size = body.company_size;
    if (!isCompanySizeValue(company_size)) {
      return NextResponse.json({ success: false, error: "Некорректный размер компании" }, { status: 400 });
    }
    const company_sphere = body.company_sphere;
    if (!isCompanySphereValue(company_sphere)) {
      return NextResponse.json({ success: false, error: "Некорректная сфера компании" }, { status: 400 });
    }

    const contact_phone =
      typeof body.contact_phone === "string" ? body.contact_phone.trim() : "";
    const about_company =
      typeof body.about_company === "string" ? body.about_company.trim() : "";

    const { error: orgErr } = await admin
      .from("organizations")
      .update({ name, updated_at: now })
      .eq("id", orgId);
    if (orgErr) {
      return NextResponse.json({ success: false, error: orgErr.message }, { status: 500 });
    }

    const { error: crmErr } = await admin.from("organization_crm_profiles").upsert(
      {
        organization_id: orgId,
        owner_full_name,
        contact_phone: contact_phone || null,
        company_size,
        company_sphere,
        about_company: about_company || null,
        updated_at: now,
      },
      { onConflict: "organization_id" }
    );
    if (crmErr) {
      return NextResponse.json({ success: false, error: crmErr.message }, { status: 500 });
    }

    const { data: pcSave } = await admin
      .from("user_post_checkout_onboarding")
      .select("user_id, completed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!pcSave) {
      await admin.from("user_post_checkout_onboarding").insert({
        user_id: user.id,
        current_step: 3,
        updated_at: now,
      });
    } else if (!pcSave.completed_at) {
      await admin
        .from("user_post_checkout_onboarding")
        .update({ current_step: 3, updated_at: now })
        .eq("user_id", user.id);
    }

    return NextResponse.json({ success: true, current_step: 3 });
  }

  if (action === "complete") {
    const orgId = await getPrimaryOwnerOrgId(admin, user.id);
    if (!orgId || !(await isCompanyProfileCompleteForOrg(admin, orgId))) {
      return NextResponse.json(
        { success: false, error: "Заполните обязательные поля компании на шаге 2" },
        { status: 400 }
      );
    }

    const { data: before } = await admin
      .from("user_post_checkout_onboarding")
      .select("user_id, completed_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const completedAt = before?.completed_at ?? now;

    if (!before) {
      const { error } = await admin.from("user_post_checkout_onboarding").insert({
        user_id: user.id,
        current_step: 3,
        completed_at: completedAt,
        updated_at: now,
      });
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await admin
        .from("user_post_checkout_onboarding")
        .update({
          current_step: 3,
          completed_at: completedAt,
          updated_at: now,
        })
        .eq("user_id", user.id);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ success: true, completed: true });
  }

  return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
}
