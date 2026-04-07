import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { detectPlanFromPaddleSnapshot } from "@/app/lib/billingPlanPriceDetect";
import { pickTopPaddleSubscriptionRow } from "@/app/lib/billingSubscriptionPick";
import {
  getAccessibleProjectIds,
  resolveBillingOrganizationIdWithPaddleEmailFallback,
  userHasAccessToBillingOrganization,
} from "@/app/lib/billingOrganizationContext";
import {
  collectPaddleCustomerIdsForBillingContext,
  collectPaddleCustomerIdsForOrganization,
  resolveBillingPlanForOrganization,
} from "@/app/lib/orgBillingState";
import {
  fetchPaddleSubscriptionItems,
  inferPlanBillingFromPaddleItems,
} from "@/app/lib/paddleSubscriptionUpgradeOps";
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
    if (itemsR.ok) {
      const inf = inferPlanBillingFromPaddleItems(itemsR.items);
      if (plan === "unknown" && inf.plan !== "unknown") plan = inf.plan as PricingPlanId;
      if (billing === "unknown" && inf.billing !== "unknown") billing = inf.billing;
      if (billing === "unknown" && itemsR.billing_interval) {
        const iv = String(itemsR.billing_interval).toLowerCase();
        if (iv.includes("month") || iv === "p1m" || iv === "m") billing = "monthly";
        else if (iv.includes("year") || iv.includes("annual") || iv === "p1y" || iv === "y")
          billing = "yearly";
      }
    } else if (billing === "unknown" && plan !== "unknown") {
      /** Нет PADDLE_SERVER_API_KEY / ошибка API — правила апгрейда всё равно нужен период. */
      billing = "monthly";
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

type SubRowWithOrg = SubRow & { organization_id?: string | null };

/** Доступ к строке подписки: org из snapshot или тот же Paddle customer_id, что привязан к email/оргам пользователя. */
async function userCanAccessSubscriptionRow(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  projectIds: Set<string>,
  row: SubRowWithOrg
): Promise<boolean> {
  const oid = row.organization_id != null ? String(row.organization_id).trim() : "";
  if (oid) {
    return userHasAccessToBillingOrganization(admin, userId, oid, projectIds);
  }
  const cid = String(row.provider_customer_id ?? "").trim();
  if (!cid) return false;
  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId);
  const orgIds = [...new Set((memberships ?? []).map((m) => String(m.organization_id)).filter(Boolean))];
  for (const org of orgIds) {
    const cids = await collectPaddleCustomerIdsForOrganization(admin, org);
    if (cids.includes(cid)) return true;
  }
  const em = (email ?? "").trim().toLowerCase();
  if (em) {
    const { data: map } = await admin
      .from("billing_customer_map")
      .select("id")
      .eq("provider", "paddle")
      .eq("email", em)
      .eq("provider_customer_id", cid)
      .limit(1)
      .maybeSingle();
    if (map) return true;
  }
  return false;
}

/**
 * Активная Paddle-подписка: сначала по `organization_id` (тариф = организация, как в Paddle custom data),
 * затем по `provider_customer_id` из customer map этой org.
 *
 * Если передан `providerSubscriptionId` (как в bootstrap), резолвим **без** привязки к email в Supabase = email в Paddle.
 */
export async function loadPaddleSubscriptionUpgradeContext(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  options?: {
    projectId?: string | null;
    primaryOrgId?: string | null;
    /** `sub_*` из GET /api/billing/current-plan — приоритетный путь при расхождении email сессии и Paddle. */
    providerSubscriptionId?: string | null;
  }
): Promise<PaddleSubscriptionUpgradeContext | null> {
  const projectIds = await getAccessibleProjectIds(admin, userId);
  const projectIdTrim = options?.projectId?.trim?.() ?? "";
  const hintSub = options?.providerSubscriptionId?.trim?.() ?? "";
  if (hintSub.startsWith("sub_")) {
    const { data: row, error } = await admin
      .from("billing_subscriptions")
      .select(
        "provider_subscription_id, provider_customer_id, provider_price_id, provider_product_id, status, current_period_end, updated_at, organization_id"
      )
      .eq("provider", "paddle")
      .eq("provider_subscription_id", hintSub)
      .maybeSingle();
    if (!error && row) {
      const ok = await userCanAccessSubscriptionRow(admin, userId, email, projectIds, row as SubRowWithOrg);
      if (!ok) return null;
      const ctx = subscriptionRowToUpgradeContext(row as SubRow);
      let orgForEnrich = row.organization_id != null ? String(row.organization_id).trim() || null : null;
      if (!orgForEnrich) {
        const rawPrimary = options?.primaryOrgId?.trim?.() ?? "";
        if (
          rawPrimary &&
          (await userHasAccessToBillingOrganization(admin, userId, rawPrimary, projectIds))
        ) {
          orgForEnrich = rawPrimary;
        }
      }
      if (!orgForEnrich && projectIdTrim) {
        orgForEnrich = await resolveBillingOrganizationIdWithPaddleEmailFallback(
          admin,
          userId,
          email,
          projectIdTrim,
          projectIds
        );
      }
      if (!orgForEnrich) {
        orgForEnrich = await resolveBillingOrganizationIdWithPaddleEmailFallback(
          admin,
          userId,
          email,
          null,
          projectIds
        );
      }
      return finalizeUpgradeContext(admin, orgForEnrich, ctx);
    }
  }

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
