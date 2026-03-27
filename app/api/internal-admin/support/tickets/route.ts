import { NextResponse } from "next/server";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const ALLOWED_SUPPORT = ["service_admin", "support", "ops_manager"] as const;
const STATUSES = new Set(["open", "in_progress", "resolved", "closed"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function GET() {
  const auth = await getCurrentSystemRoleCheck([...ALLOWED_SUPPORT]);
  if (!auth.isAuthenticated) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!auth.hasAnyAllowedRole) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  const admin = supabaseAdmin();
  const { data: tickets, error } = await admin
    .from("support_tickets")
    .select("id, ticket_no, user_id, subject, status, priority, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const ticketIds = (tickets ?? []).map((t) => String((t as { id?: string }).id ?? ""));
  const userIds = Array.from(new Set((tickets ?? []).map((t) => String((t as { user_id?: string }).user_id ?? "")).filter(Boolean)));

  const emailByUser = new Map<string, string | null>();
  for (const uid of userIds) {
    try {
      const user = await admin.auth.admin.getUserById(uid);
      emailByUser.set(uid, user.data.user?.email ?? null);
    } catch {
      emailByUser.set(uid, null);
    }
  }

  const latestMessageByTicket = new Map<string, string>();
  if (ticketIds.length > 0) {
    const { data: messages } = await admin
      .from("support_ticket_messages")
      .select("ticket_id, body, created_at")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: false });
    for (const m of messages ?? []) {
      const ticketId = String((m as { ticket_id?: string }).ticket_id ?? "");
      if (!ticketId || latestMessageByTicket.has(ticketId)) continue;
      latestMessageByTicket.set(ticketId, String((m as { body?: string }).body ?? ""));
    }
  }

  const result = (tickets ?? []).map((t) => {
    const row = t as { id: string; user_id: string };
    return {
      ...(t as Record<string, unknown>),
      user_email: emailByUser.get(row.user_id) ?? null,
      last_message: latestMessageByTicket.get(row.id) ?? null,
    };
  });
  return NextResponse.json({ success: true, tickets: result });
}

export async function PATCH(req: Request) {
  const auth = await getCurrentSystemRoleCheck([...ALLOWED_SUPPORT]);
  if (!auth.isAuthenticated) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!auth.hasAnyAllowedRole || !auth.userId) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { ticket_id?: string; status?: string; priority?: string }
    | null;
  const ticketId = String(body?.ticket_id ?? "").trim();
  const status = body?.status ? String(body.status).toLowerCase() : null;
  const priority = body?.priority ? String(body.priority).toLowerCase() : null;
  if (!ticketId) return NextResponse.json({ success: false, error: "ticket_id required" }, { status: 400 });
  if (status && !STATUSES.has(status)) return NextResponse.json({ success: false, error: "invalid status" }, { status: 400 });
  if (priority && !PRIORITIES.has(priority)) return NextResponse.json({ success: false, error: "invalid priority" }, { status: 400 });
  if (!status && !priority) return NextResponse.json({ success: false, error: "nothing to update" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (priority) patch.priority = priority;

  const admin = supabaseAdmin();
  const { error } = await admin.from("support_tickets").update(patch).eq("id", ticketId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await admin.from("support_ticket_audit_log").insert({
    ticket_id: ticketId,
    actor_user_id: auth.userId,
    action: status ? "status_change" : "priority_change",
    meta: { status, priority },
    created_at: new Date().toISOString(),
  });
  return NextResponse.json({ success: true });
}

