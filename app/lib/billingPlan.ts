/**
 * Resolve subscription plan (Starter / Growth / Scale) for TTL and entitlements.
 * Resolution is organization-scoped; pass organization_id from resolveBillingOrganizationId.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPlanId } from "@/app/lib/billingPlanPriceDetect";
import { resolveBillingPlanForOrganization } from "@/app/lib/orgBillingState";

export type { BillingPlanId } from "@/app/lib/billingPlanPriceDetect";
export { detectPlanFromPriceId } from "@/app/lib/billingPlanPriceDetect";

/**
 * Plan for the billing organization of the current user context (invited / project-only inherit org subscription).
 */
export async function resolveBillingPlanForUserWithOrg(
  admin: SupabaseClient,
  _userId: string,
  _email: string | null,
  organizationId: string | null
): Promise<BillingPlanId> {
  if (!organizationId) return "unknown";
  return resolveBillingPlanForOrganization(admin, organizationId);
}
