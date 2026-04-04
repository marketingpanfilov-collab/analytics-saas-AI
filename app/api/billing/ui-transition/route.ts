import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  logBillingUiTransition,
  type UiTransitionSource,
} from "@/app/lib/logBillingUiTransition";

const SOURCES = new Set<UiTransitionSource>([
  "bootstrap",
  "user_action",
  "webhook",
  "multitab",
  "client_shell",
]);

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    next_screen?: unknown;
    next_reason?: unknown;
    request_id?: unknown;
    source?: unknown;
    primary_org_id?: unknown;
  } | null;

  const nextScreen = typeof body?.next_screen === "string" ? body.next_screen : "";
  const nextReason = typeof body?.next_reason === "string" ? body.next_reason : "";
  const requestId = typeof body?.request_id === "string" && body.request_id ? body.request_id : "";
  const sourceRaw = body?.source;
  const source = typeof sourceRaw === "string" && SOURCES.has(sourceRaw as UiTransitionSource)
    ? (sourceRaw as UiTransitionSource)
    : null;
  const orgRaw = body?.primary_org_id;
  const orgId =
    orgRaw === null || orgRaw === undefined
      ? null
      : typeof orgRaw === "string" && /^[0-9a-f-]{36}$/i.test(orgRaw)
        ? orgRaw
        : null;

  if (!nextScreen || !nextReason || !requestId || !source) {
    return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  await logBillingUiTransition(admin, {
    userId: user.id,
    orgId,
    nextScreen,
    nextReason,
    requestId,
    source,
  });

  return NextResponse.json({ success: true });
}
