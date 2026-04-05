import {
  isBillingBlocking,
  isBootstrapResponseValid,
  newBootstrapRequestId,
  type BillingBootstrapApiOk,
  type BillingBlockingOptions,
} from "@/app/lib/billingBootstrapClient";
import { readCheckoutAttemptIdForTracing } from "@/app/lib/billingCheckoutAttempt";
import type { ResolvedUiStateV1 } from "@/app/lib/billingUiContract";

function postPaymentPollDebug(message: string, data: Record<string, unknown>): void {
  const enabled =
    (typeof process !== "undefined" && process.env.NODE_ENV === "development") ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BILLING_DEBUG === "1");
  if (!enabled) return;
  const attemptId = readCheckoutAttemptIdForTracing();
  console.debug(`[billing_post_payment] ${message}`, {
    ...data,
    checkout_attempt_id: attemptId,
  });
}

export const POST_PAYMENT_POLL_MS = 2500;
export const POST_PAYMENT_MAX_ATTEMPTS = 24;
export const POST_PAYMENT_TIMEOUT_MS = 60_000;

export type BillingBootstrapReloadPack = {
  resolved: ResolvedUiStateV1 | null;
  bootstrap: BillingBootstrapApiOk | null;
};

export async function fetchBillingBootstrapPack(opts?: {
  projectId?: string | null;
}): Promise<BillingBootstrapReloadPack> {
  const requestId = newBootstrapRequestId();
  const q = opts?.projectId ? `?project_id=${encodeURIComponent(opts.projectId)}` : "";
  const res = await fetch(`/api/billing/current-plan${q}`, {
    credentials: "include",
    cache: "no-store",
    headers: { "x-request-id": requestId },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !isBootstrapResponseValid(json)) {
    return { resolved: null, bootstrap: null };
  }
  return { resolved: json.resolved_ui_state, bootstrap: json };
}

export type WaitPostPaymentUnlockOpts = {
  /** Defaults to `fetchBillingBootstrapPack`. */
  reload?: () => Promise<BillingBootstrapReloadPack>;
  projectId?: string | null;
  billingBlockingOptions?: BillingBlockingOptions;
  signal?: AbortSignal;
  onTick?: (args: { attempt: number; blocking: boolean }) => void;
  isCancelled?: () => boolean;
};

/**
 * Poll until billing is no longer blocking (paywall / unpaid shell) or limits hit.
 * Used after Paddle checkout on login and by in-app pricing (via injected `reload`).
 */
export async function waitUntilPostPaymentUnblocked(
  opts?: WaitPostPaymentUnlockOpts
): Promise<BillingBootstrapReloadPack> {
  const reload =
    opts?.reload ??
    (() => fetchBillingBootstrapPack({ projectId: opts?.projectId ?? null }));
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt++) {
    if (opts?.signal?.aborted) return { resolved: null, bootstrap: null };
    if (opts?.isCancelled?.()) return { resolved: null, bootstrap: null };

    const pack = await reload();
    const fresh = pack.resolved;
    const blocking = !fresh || isBillingBlocking(fresh, opts?.billingBlockingOptions);
    postPaymentPollDebug("tick", { attempt, blocking });
    opts?.onTick?.({ attempt, blocking });

    if (fresh && !blocking) return pack;
    if (attempt >= POST_PAYMENT_MAX_ATTEMPTS) return pack;
    if (Date.now() - startedAt >= POST_PAYMENT_TIMEOUT_MS) return pack;

    await new Promise((r) => setTimeout(r, POST_PAYMENT_POLL_MS));
  }
}
