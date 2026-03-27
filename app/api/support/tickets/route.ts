import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: tickets, error } = await admin
    .from("support_tickets")
    .select("id, ticket_no, subject, status, priority, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const ticketIds = (tickets ?? []).map((t) => t.id as string);
  const latestMessageByTicket = new Map<string, string>();
  if (ticketIds.length > 0) {
    const { data: messages } = await admin
      .from("support_ticket_messages")
      .select("ticket_id, body, created_at")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: false });
    for (const m of messages ?? []) {
      const tid = String((m as { ticket_id?: string }).ticket_id ?? "");
      if (!tid || latestMessageByTicket.has(tid)) continue;
      latestMessageByTicket.set(tid, String((m as { body?: string }).body ?? ""));
    }
  }

  const result = (tickets ?? []).map((t) => ({
    ...(t as Record<string, unknown>),
    last_message: latestMessageByTicket.get(String(t.id)) ?? null,
  }));
  return NextResponse.json({ success: true, tickets: result });
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`support:create:${user.id}:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { subject?: string; body?: string; priority?: string }
    | null;
  const subject = String(body?.subject ?? "").trim();
  const message = String(body?.body ?? "").trim();
  const priority = String(body?.priority ?? "normal").toLowerCase();
  if (!subject || !message) {
    return NextResponse.json({ success: false, error: "subject and body are required" }, { status: 400 });
  }
  if (!PRIORITIES.has(priority)) {
    return NextResponse.json({ success: false, error: "invalid priority" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: ticket, error: ticketErr } = await admin
    .from("support_tickets")
    .insert({
      user_id: user.id,
      subject,
      priority,
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (ticketErr || !ticket?.id) {
    return NextResponse.json({ success: false, error: ticketErr?.message ?? "failed to create ticket" }, { status: 500 });
  }

  const ticketId = String(ticket.id);
  const nowIso = new Date().toISOString();
  await admin.from("support_ticket_messages").insert({
    ticket_id: ticketId,
    sender_user_id: user.id,
    sender_role: "user",
    body: message,
    created_at: nowIso,
  });
  await admin.from("support_ticket_audit_log").insert({
    ticket_id: ticketId,
    actor_user_id: user.id,
    action: "create",
    meta: { priority },
    created_at: nowIso,
  });

  return NextResponse.json({ success: true, ticket_id: ticketId });
}

