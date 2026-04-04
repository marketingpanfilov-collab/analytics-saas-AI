import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import crypto from "crypto";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

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

  const billingPre = await billingHeavySyncGateBeforeProject(req);
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

  // Email delivery uses the same path as password reset (Supabase Auth SMTP). Invite emails
  // are not sent from this app to avoid a second email stack; creator can share invite_url manually.
  if (inviteType === "link") {
    return NextResponse.json({
      success: true,
      invite_id: invite.id,
      token: invite.token,
      expires_at: invite.expires_at,
      invite_url: inviteUrl,
    });
  }

  return NextResponse.json({
    success: true,
    invite_id: invite.id,
    token: invite.token,
    expires_at: invite.expires_at,
    invite_url: inviteUrl,
  });
}
