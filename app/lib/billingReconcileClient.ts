import { isBillingBlocking, isBootstrapResponseValid, type BillingBootstrapApiOk } from "@/app/lib/billingBootstrapClient";
import type { ResolvedUiStateV1 } from "@/app/lib/billingUiContract";
import { emitBillingFunnelEvent } from "@/app/lib/billingFunnelAnalytics";
import { peekPaymentWebhookGrace } from "@/app/lib/billingPaymentWebhookGrace";

export type ReconcileLatestCheckoutJson = BillingBootstrapApiOk & {
  access_ready?: boolean;
  checkout_attempt_id?: string | null;
  reconcile?: {
    primary_org_id: string | null;
    has_billing_customer_map: boolean;
    has_billing_subscription_row: boolean;
    webhook_failures_for_org_24h: number;
  };
};

export async function postBillingReconcileLatestCheckout(opts?: {
  checkoutAttemptId?: string | null;
}): Promise<{
  json: ReconcileLatestCheckoutJson | null;
  ok: boolean;
  accessReady: boolean;
  resolved: ResolvedUiStateV1 | null;
}> {
  const grace = peekPaymentWebhookGrace();
  const attempt =
    (typeof opts?.checkoutAttemptId === "string" && opts.checkoutAttemptId.trim()
      ? opts.checkoutAttemptId.trim()
      : null) ??
    grace.checkoutAttemptId ??
    null;

  emitBillingFunnelEvent("billing_reconcile_manual_triggered", {
    checkout_attempt_id: attempt,
    source: grace.source,
  });

  let res: Response;
  try {
    res = await fetch("/api/billing/reconcile-latest-checkout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkout_attempt_id: attempt }),
    });
  } catch {
    emitBillingFunnelEvent("billing_reconcile_manual_not_resolved", {
      checkout_attempt_id: attempt,
      source: grace.source,
      reason: "network_error",
    });
    return { json: null, ok: false, accessReady: false, resolved: null };
  }

  const json = (await res.json().catch(() => null)) as ReconcileLatestCheckoutJson | null;
  if (!json || json.success !== true || !isBootstrapResponseValid(json)) {
    emitBillingFunnelEvent("billing_reconcile_manual_not_resolved", {
      checkout_attempt_id: attempt,
      source: grace.source,
      reason: "invalid_response",
    });
    return { json, ok: false, accessReady: false, resolved: null };
  }

  const resolved = json.resolved_ui_state ?? null;
  const accessReady = Boolean(resolved && !isBillingBlocking(resolved));

  if (accessReady) {
    emitBillingFunnelEvent("billing_reconcile_manual_resolved", {
      checkout_attempt_id: attempt,
      organization_id: json.primary_org_id ?? null,
      source: grace.source,
      plan: json.subscription?.plan ?? json.effective_plan ?? null,
      billing_period: json.subscription?.billing_period ?? null,
    });
  } else {
    const r = json.reconcile;
    emitBillingFunnelEvent("billing_reconcile_manual_not_resolved", {
      checkout_attempt_id: attempt,
      organization_id: json.primary_org_id ?? null,
      source: grace.source,
      has_billing_customer_map: r?.has_billing_customer_map,
      has_billing_subscription_row: r?.has_billing_subscription_row,
    });
  }

  return { json, ok: true, accessReady, resolved };
}
