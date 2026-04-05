/** Домены биллинга (совпадают с server billingObservability). */
export type BillingClientLogDomain = "webhook" | "checkout" | "entitlement" | "org_delete";

/** Клиентские события биллинга (без записи в БД). Формат согласован с billingObservability. */
export function billingClientLog(
  severity: "warn" | "error",
  domain: BillingClientLogDomain,
  code: string,
  data?: Record<string, unknown>
): void {
  const line = `[billing][${domain}][client] ${code}`;
  const payload = { ...(data ?? {}), billing_domain: domain, billing_code: code, billing_client: true };
  if (severity === "error") {
    console.error(line, payload);
    return;
  }
  console.warn(line, payload);
}
