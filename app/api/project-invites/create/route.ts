import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { sendProjectInviteEmail } from "@/app/lib/projectInviteEmail";
import crypto from "crypto";
import { billingAnalyticsReadGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

export const runtime = "nodejs";

const ORG_ROLES_MANAGE = ["owner", "admin"];
const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];
const INVITE_EXPIRY_MINUTES = 30;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
  const inviteType = body.invite_type === "link" ? "link" : "email";
  const email = inviteType === "email" && typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const role = ["project_admin", "marketer", "viewer"].includes(body.role) ? body.role : "marketer";

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  if (inviteType === "email" && !email) {
    return NextResponse.json({ success: false, error: "email required for email invite" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Приглашение не занимает seat и не должно упираться в heavy-sync / over-limit; достаточно «не мёртвой» подписки для чтения.
  const billingPre = await billingAnalyticsReadGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!mem) {
    return NextResponse.json({ success: false, error: "No organization membership" }, { status: 403 });
  }

  const orgRole = (mem.role ?? "member") as string;
  let allowedProjectIds: string[] = [];
  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", mem.organization_id);
    allowedProjectIds = (projs ?? []).map((p: { id: string }) => p.id);
  } else {
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);
    allowedProjectIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
  }

  if (!allowedProjectIds.includes(projectId)) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const canManage =
    ORG_ROLES_MANAGE.includes(orgRole) ||
    (await (async () => {
      const { data: pm } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      return pm?.role === "project_admin";
    })());

  if (!canManage) {
    return NextResponse.json({ success: false, error: "Cannot manage invites" }, { status: 403 });
  }

  const { data: proj } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!proj || proj.organization_id !== mem.organization_id) {
    return NextResponse.json({ success: false, error: "Project not in your organization" }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const token = generateToken();

  const { data: invite, error: insertErr } = await supabase
    .from("project_invites")
    .insert({
      organization_id: proj.organization_id,
      project_id: projectId,
      email: inviteType === "email" ? email : null,
      role,
      invite_type: inviteType,
      token,
      status: "pending",
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select("id, token, invite_type, expires_at")
    .single();

  if (insertErr) {
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }

  const origin = req.headers.get("origin") || req.headers.get("x-forwarded-host") || "http://localhost:3000";
  const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;
  const inviteUrl = `${baseUrl}/app/invite/accept?token=${encodeURIComponent(token)}`;

  const admin = supabaseAdmin();
  const { data: projMeta } = await admin
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  const { data: orgMeta } = await admin
    .from("organizations")
    .select("name")
    .eq("id", proj.organization_id)
    .maybeSingle();

  const projectName = (projMeta?.name != null && String(projMeta.name).trim()) || "Проект";
  const organizationName = (orgMeta?.name != null && String(orgMeta.name).trim()) || "Организация";

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const inviterDisplayName =
    typeof meta?.full_name === "string"
      ? meta.full_name.trim()
      : typeof meta?.name === "string"
        ? meta.name.trim()
        : null;

  let emailSent = false;
  let emailError: string | null = null;
  if (inviteType === "email" && email) {
    const send = await sendProjectInviteEmail({
      to: email,
      inviteUrl,
      projectName,
      organizationName,
      roleKey: role,
      inviterEmail: user.email ?? null,
      inviterDisplayName: inviterDisplayName || null,
      expiresAtIso: expiresAt,
    });
    if (send.ok) {
      emailSent = true;
    } else {
      emailError = send.error;
      if (send.error === "smtp_not_configured" && process.env.NODE_ENV === "development") {
        console.warn(
          "[project-invites/create] Почта не настроена (SMTP_* или RESEND_API_KEY) — письмо не отправлено. invite_url:",
          inviteUrl
        );
      } else if (send.error !== "smtp_not_configured") {
        console.warn("[project-invites/create] email failed:", send.error);
      }
    }
  }

  const payload: Record<string, unknown> = {
    success: true,
    invite_id: invite.id,
    token: invite.token,
    expires_at: invite.expires_at,
    invite_url: inviteUrl,
    email_sent: emailSent,
    project_name: projectName,
    organization_name: organizationName,
  };
  if (emailError) payload.email_error = emailError;

  return NextResponse.json(payload);
}
