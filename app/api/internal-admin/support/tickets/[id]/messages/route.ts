import { NextResponse } from "next/server";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_SUPPORT = ["service_admin", "support", "ops_manager"] as const;

function getSenderRole(roles: string[]): "service_admin" | "support" | "ops_manager" {
  if (roles.includes("service_admin")) return "service_admin";
  if (roles.includes("ops_manager")) return "ops_manager";
  return "support";
}

export async function GET(_req: Request, { params }: Params) {
  const auth = await getCurrentSystemRoleCheck([...ALLOWED_SUPPORT]);
  if (!auth.isAuthenticated) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!auth.hasAnyAllowedRole) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("support_ticket_messages")
    .select("id, sender_role, body, created_at")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, messages: data ?? [] });
}

export async function POST(req: Request, { params }: Params) {
  const auth = await getCurrentSystemRoleCheck([...ALLOWED_SUPPORT]);
  if (!auth.isAuthenticated) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!auth.hasAnyAllowedRole || !auth.userId) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const payload = (await req.json().catch(() => null)) as { body?: string } | null;
  const text = String(payload?.body ?? "").trim();
  if (!text) return NextResponse.json({ success: false, error: "body required" }, { status: 400 });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`support:reply:internal:${auth.userId}:${ip}`, 40, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const nowIso = new Date().toISOString();
  const senderRole = getSenderRole(auth.roles);
  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets").select("id, status").eq("id", id).maybeSingle();
  if (!ticket?.id) return NextResponse.json({ success: false, error: "ticket not found" }, { status: 404 });
  const currentStatus = String(ticket.status ?? "").toLowerCase();
  if (currentStatus === "closed") {
    return NextResponse.json({ success: false, error: "ticket is closed" }, { status: 400 });
  }
  const { error: msgErr } = await admin.from("support_ticket_messages").insert({
    ticket_id: id,
    sender_user_id: auth.userId,
    sender_role: senderRole,
    body: text,
    created_at: nowIso,
  });
  if (msgErr) return NextResponse.json({ success: false, error: msgErr.message }, { status: 500 });

  await admin
    .from("support_tickets")
    .update({
      updated_at: nowIso,
      status: currentStatus === "open" ? "in_progress" : ticket.status,
    })
    .eq("id", id);
  await admin.from("support_ticket_audit_log").insert({
    ticket_id: id,
    actor_user_id: auth.userId,
    action: "reply",
    meta: { sender_role: senderRole },
    created_at: nowIso,
  });

  return NextResponse.json({ success: true });
}

