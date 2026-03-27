import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function parseBearerAuth(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function isAuthorized(req: Request): boolean {
  const internalSecret = process.env.INTERNAL_SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-internal-sync-secret");
  const bearer = parseBearerAuth(req.headers.get("authorization"));
  if (internalSecret && headerSecret === internalSecret) return true;
  if (cronSecret && bearer === cronSecret) return true;
  if (internalSecret && bearer === internalSecret) return true;
  return false;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const sinceHours = Math.max(1, Number(new URL(req.url).searchParams.get("hours") ?? 24));
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("tracking_ingest_telemetry")
    .select("endpoint, reason_code, severity, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const grouped = new Map<string, number>();
  for (const row of data ?? []) {
    const endpoint = String((row as { endpoint?: string }).endpoint ?? "unknown");
    const reason = String((row as { reason_code?: string }).reason_code ?? "unknown");
    const key = `${endpoint}:${reason}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }

  const counters = Array.from(grouped.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    success: true,
    since_hours: sinceHours,
    total: (data ?? []).length,
    counters,
    items: data ?? [],
  });
}

