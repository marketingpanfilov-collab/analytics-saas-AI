import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

type Params = { params: Promise<{ id: string }> };

async function getAuthorizedUserTicketId(id: string): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets").select("id, user_id").eq("id", id).maybeSingle();
  if (!ticket?.id) return { ok: false, status: 404, error: "ticket not found" };
  if (ticket.user_id !== user.id) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, userId: user.id };
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const check = await getAuthorizedUserTicketId(id);
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

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
  const { id } = await params;
  const check = await getAuthorizedUserTicketId(id);
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

  const body = (await req.json().catch(() => null)) as { body?: string } | null;
  const text = String(body?.body ?? "").trim();
  if (!text) return NextResponse.json({ success: false, error: "body required" }, { status: 400 });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`support:reply:user:${check.userId}:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const nowIso = new Date().toISOString();
  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets").select("id, status").eq("id", id).maybeSingle();
  if (!ticket?.id) return NextResponse.json({ success: false, error: "ticket not found" }, { status: 404 });
  if (String(ticket.status ?? "").toLowerCase() === "closed") {
    return NextResponse.json({ success: false, error: "ticket is closed" }, { status: 400 });
  }
  const { error: msgErr } = await admin.from("support_ticket_messages").insert({
    ticket_id: id,
    sender_user_id: check.userId,
    sender_role: "user",
    body: text,
    created_at: nowIso,
  });
  if (msgErr) return NextResponse.json({ success: false, error: msgErr.message }, { status: 500 });

  await admin.from("support_tickets").update({ updated_at: nowIso }).eq("id", id);
  await admin.from("support_ticket_audit_log").insert({
    ticket_id: id,
    actor_user_id: check.userId,
    action: "reply",
    meta: {},
    created_at: nowIso,
  });

  return NextResponse.json({ success: true });
}

