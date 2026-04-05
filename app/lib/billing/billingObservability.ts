import type { SupabaseClient } from "@supabase/supabase-js";

export type BillingLogDomain = "webhook" | "checkout" | "entitlement" | "org_delete";

export type BillingLogSeverity = "info" | "warn" | "error" | "critical";

const LOG_ROOT = "[billing]";

/**
 * Единый формат логов биллинга для grep / log routers / Vercel.
 * critical → всегда stderr + маркер BILLING_SEVERITY=critical
 */
export function billingLog(
  severity: BillingLogSeverity,
  domain: BillingLogDomain,
  code: string,
  data?: Record<string, unknown>
): void {
  const line = `${LOG_ROOT}[${domain}] ${code}`;
  const payload = {
    ...(data ?? {}),
    billing_domain: domain,
    billing_code: code,
    ...(severity === "critical" ? { BILLING_SEVERITY: "critical" as const } : {}),
  };
  if (severity === "info") {
    console.log(line, payload);
    return;
  }
  if (severity === "warn") {
    console.warn(line, payload);
    return;
  }
  console.error(line, payload);
}

/**
 * Метрика/алерт для внешних систем: ищите BILLING_ALERT=1 и billing_metric в логах.
 */
export function billingMetricAlert(metric: string, data: Record<string, unknown>): void {
  console.error(`${LOG_ROOT}[metric] ${metric}`, {
    ...data,
    billing_metric: metric,
    BILLING_ALERT: 1,
  });
}

export type BillingWebhookFailureKind =
  | "skip_customer_map"
  | "skip_subscription"
  | "ambiguous_org"
  | "recovery_failed"
  | "customer_map_upsert_error"
  | "subscription_upsert_error";

export type RecordBillingWebhookFailureInput = {
  provider_event_id: string;
  event_type: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  failure_kind: BillingWebhookFailureKind;
  metric_alert?: boolean;
  details?: Record<string, unknown>;
};

/** Best-effort insert; не бросает наружу (webhook должен ответить 200). */
export async function recordBillingWebhookFailure(
  admin: SupabaseClient,
  input: RecordBillingWebhookFailureInput
): Promise<void> {
  try {
    const { error } = await admin.from("billing_webhook_failures").insert({
      provider: "paddle",
      provider_event_id: input.provider_event_id,
      event_type: input.event_type,
      customer_id: input.customer_id ?? null,
      subscription_id: input.subscription_id ?? null,
      failure_kind: input.failure_kind,
      metric_alert: input.metric_alert ?? false,
      details: input.details ?? {},
    });
    if (error) {
      billingLog("error", "webhook", "WEBHOOK_FAILURE_ROW_INSERT_ERROR", {
        message: error.message,
        code: (error as { code?: string }).code,
        failure_kind: input.failure_kind,
      });
    }
  } catch (e) {
    billingLog("critical", "webhook", "WEBHOOK_FAILURE_ROW_EXCEPTION", {
      message: e instanceof Error ? e.message : String(e),
      failure_kind: input.failure_kind,
    });
  }
}
