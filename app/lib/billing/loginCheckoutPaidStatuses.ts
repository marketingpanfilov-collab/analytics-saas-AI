/**
 * Paddle subscription row statuses that count as "paid enough" for login-checkout polling
 * and finalize (must stay aligned across login-checkout-status API and finalizeLoginCheckoutCore).
 */
export const LOGIN_CHECKOUT_SUBSCRIPTION_PAID_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "completed",
  "paid",
]);

export function subscriptionRowCountsAsPaidForLoginCheckout(status: unknown): boolean {
  return LOGIN_CHECKOUT_SUBSCRIPTION_PAID_STATUSES.has(String(status ?? "").toLowerCase());
}
