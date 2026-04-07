import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { detectPlanFromPriceId, detectPlanFromPaddleSnapshot } from "@/app/lib/billingPlanPriceDetect";
import { pickTopPaddleSubscriptionRow } from "@/app/lib/billingSubscriptionPick";
import {
  getAccessibleProjectIds,
  resolveBillingOrganizationIdWithPaddleEmailFallback,
  userHasAccessToBillingOrganization,
} from "@/app/lib/billingOrganizationContext";
import { collectPaddleCustomerIdsForBillingContext, resolveBillingPlanForOrganization } from "@/app/lib/orgBillingState";
import { fetchPaddleSubscriptionItems } from "@/app/lib/paddleSubscriptionUpgradeOps";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

type SubRow = {
  provider_subscription_id: string;
  provider_customer_id: string | null;
  provider_price_id: string | null;
  provider_product_id: string | null;
  status: string | null;
  current_period_end: string | null;
  updated_at: string | null;
};

export type PaddleSubscriptionUpgradeContext = {
  provider_subscription_id: string;
  provider_customer_id: string | null;
  provider_price_id: string | null;
  status: string;
  plan: PricingPlanId | "unknown";
  billing: BillingPeriod | "unknown";
};

function subscriptionRowToUpgradeContext(top: SubRow): PaddleSubscriptionUpgradeContext | null {
  if (!top?.provider_subscription_id) return null;
  const st = String(top.status ?? "").toLowerCase();
  if (!ACTIVE_STATUSES.has(st)) return null;
  const meta = detectPlanFromPaddleSnapshot(
    top.provider_price_id ?? null,
    top.provider_product_id ?? null
  );
  return {
    provider_subscription_id: top.provider_subscription_id,
    provider_customer_id: top.provider_customer_id,
    provider_price_id: top.provider_price_id,
    status: st,
    plan: meta.plan,
    billing: meta.billing,
  };
}

/** Среди нескольких снимков webhook «топ» может быть неактивной строкой — для апгрейда берём только активные. */
function pickTopRowForUpgrade(rows: SubRow[]): SubRow | null {
  const active = rows.filter((r) => ACTIVE_STATUSES.has(String(r.status ?? "").toLowerCase()));
  if (!active.length) return null;
  return pickTopPaddleSubscriptionRow(active);
}

/**
 * Snapshot в БД может не сойтись с NEXT_PUBLIC_* (sandbox/live) — тогда plan/billing unknown и падает assertUpgradeAllowed.
 * Дополняем: org-план из entitlements/Paddle map и при необходимости live price_id из Paddle API.
 */
async function enrichUpgradeContext(
  admin: SupabaseClient,
  billingOrgId: string | null,
  ctx: PaddleSubscriptionUpgradeContext
): Promise<PaddleSubscriptionUpgradeContext> {
  let plan = ctx.plan;
  let billing = ctx.billing;

  if (billingOrgId && plan === "unknown") {
    const p = await resolveBillingPlanForOrganization(admin, billingOrgId);
    if (p !== "unknown") plan = p as PricingPlanId;
  }

  if ((plan === "unknown" || billing === "unknown") && ctx.provider_subscription_id) {
    const itemsR = await fetchPaddleSubscriptionItems(ctx.provider_subscription_id);
    if (itemsR.ok && itemsR.items[0]?.price_id) {
      const d = detectPlanFromPriceId(itemsR.items[0].price_id);
      if (plan === "unknown" && d.plan !== "unknown") plan = d.plan as PricingPlanId;
      if (billing === "unknown" && d.billing !== "unknown") billing = d.billing;
    }
    if (itemsR.ok && billing === "unknown" && itemsR.billing_interval) {
      const iv = String(itemsR.billing_interval).toLowerCase();
      if (iv === "month" || iv === "monthly") billing = "monthly";
      else if (iv === "year" || iv === "annual" || iv === "yearly") billing = "yearly";
    }
  }

  return { ...ctx, plan, billing };
}

async function finalizeUpgradeContext(
  admin: SupabaseClient,
  billingOrgId: string | null,
  ctx: PaddleSubscriptionUpgradeContext | null
): Promise<PaddleSubscriptionUpgradeContext | null> {
  if (!ctx) return null;
  return enrichUpgradeContext(admin, billingOrgId, ctx);
}

/**
 * Активная Paddle-подписка: сначала по `organization_id` (тариф = организация, как в Paddle custom data),
 * затем по `provider_customer_id` из customer map этой org.
 */
export async function loadPaddleSubscriptionUpgradeContext(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  options?: { projectId?: string | null; primaryOrgId?: string | null }
): Promise<PaddleSubscriptionUpgradeContext | null> {
  const projectIds = await getAccessibleProjectIds(admin, userId);
  const projectIdTrim = options?.projectId?.trim?.() ?? "";

  let billingOrgId: string | null = null;
  if (projectIdTrim) {
    billingOrgId = await resolveBillingOrganizationIdWithPaddleEmailFallback(
      admin,
      userId,
      email,
      projectIdTrim,
      projectIds
    );
  } else {
    const rawPrimary = options?.primaryOrgId?.trim?.() ?? "";
    if (
      rawPrimary &&
      (await userHasAccessToBillingOrganization(admin, userId, rawPrimary, projectIds))
    ) {
      billingOrgId = rawPrimary;
    }
    if (!billingOrgId) {
      billingOrgId = await resolveBillingOrganizationIdWithPaddleEmailFallback(
        admin,
        userId,
        email,
        null,
        projectIds
      );
    }
  }

  if (billingOrgId) {
    const { data: byOrg, error: orgErr } = await admin
      .from("billing_subscriptions")
      .select(
        "provider_subscription_id, provider_customer_id, provider_price_id, provider_product_id, status, current_period_end, updated_at"
      )
      .eq("provider", "paddle")
      .eq("organization_id", billingOrgId)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!orgErr && byOrg?.length) {
      const top = pickTopRowForUpgrade(byOrg as SubRow[]);
      const ctx = top ? subscriptionRowToUpgradeContext(top) : null;
      if (ctx) return finalizeUpgradeContext(admin, billingOrgId, ctx);
    }
  }

  const customerIds = await collectPaddleCustomerIdsForBillingContext(admin, billingOrgId);
  if (!customerIds.length) return null;

  const { data: subs, error } = await admin
    .from("billing_subscriptions")
    .select(
      "provider_subscription_id, provider_customer_id, provider_price_id, provider_product_id, status, current_period_end, updated_at"
    )
    .eq("provider", "paddle")
    .in("provider_customer_id", customerIds)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error || !subs?.length) return null;

  const top = pickTopRowForUpgrade(subs as SubRow[]);
  return finalizeUpgradeContext(admin, billingOrgId, top ? subscriptionRowToUpgradeContext(top) : null);
}
