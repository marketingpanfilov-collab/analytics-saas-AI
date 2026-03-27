import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type TrackingTelemetryInput = {
  endpoint: string;
  reason_code: string;
  message?: string | null;
  severity?: "info" | "warn" | "error";
  project_id?: string | null;
  site_id?: string | null;
  event_name?: string | null;
  payload?: Record<string, unknown>;
};

export async function logTrackingTelemetry(input: TrackingTelemetryInput): Promise<void> {
  try {
    const admin = supabaseAdmin();
    await admin.from("tracking_ingest_telemetry").insert({
      endpoint: input.endpoint,
      reason_code: input.reason_code,
      message: input.message ?? null,
      severity: input.severity ?? "error",
      project_id: input.project_id ?? null,
      site_id: input.site_id ?? null,
      event_name: input.event_name ?? null,
      payload: input.payload ?? {},
    });
  } catch (e) {
    console.warn("[TRACKING_TELEMETRY_LOG_FAILED]", {
      endpoint: input.endpoint,
      reason_code: input.reason_code,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

