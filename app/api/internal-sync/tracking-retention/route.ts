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

async function runCleanup() {
  const admin = supabaseAdmin();
  const conversionDays = Number(process.env.TRACKING_RETENTION_CONVERSION_DAYS ?? 365);
  const visitDays = Number(process.env.TRACKING_RETENTION_VISIT_DAYS ?? 180);
  const redirectDays = Number(process.env.TRACKING_RETENTION_REDIRECT_DAYS ?? 365);
  const telemetryDays = Number(process.env.TRACKING_RETENTION_TELEMETRY_DAYS ?? 90);

  const { data, error } = await admin.rpc("cleanup_old_tracking_data", {
    p_conversion_days: conversionDays,
    p_visit_days: visitDays,
    p_redirect_days: redirectDays,
    p_telemetry_days: telemetryDays,
  });
  if (error) throw error;
  return data;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runCleanup();
    return NextResponse.json({ success: true, result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}

