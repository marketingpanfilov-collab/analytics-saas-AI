"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { broadcastBillingBootstrapInvalidate, storeOriginRoute } from "@/app/lib/billingBootstrapClient";
import { openPaddleSubscriptionCheckout } from "@/app/lib/paddleCheckoutClient";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";
import { supabase } from "@/app/lib/supabaseClient";

type BootstrapLite = {
  primary_org_id?: string | null;
  resolved_ui_state?: { pending_plan_change?: boolean };
};

type Props = {
  guestHref: string;
  planId: PricingPlanId;
  billing: BillingPeriod;
};

export default function PricingBuyButton({ guestHref, planId, billing }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [authPhase, setAuthPhase] = useState<"loading" | "guest" | "authed">("loading");
  const [session, setSession] = useState<{ email: string; userId: string | null } | null>(null);
  const [bootstrapLite, setBootstrapLite] = useState<BootstrapLite | null>(null);
  const [pwCustomerId, setPwCustomerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const u = data.user;
      if (!u) {
        setAuthPhase("guest");
        setSession(null);
        setBootstrapLite(null);
        setPwCustomerId(null);
        return;
      }
      setSession({ email: (u.email ?? "").trim(), userId: u.id });
      setAuthPhase("authed");
      try {
        const [planRes, custRes] = await Promise.all([
          fetch("/api/billing/current-plan", { cache: "no-store" }),
          fetch("/api/billing/current-customer", { cache: "no-store" }),
        ]);
        const planJson = (await planRes.json()) as BootstrapLite & { success?: boolean };
        const custJson = (await custRes.json()) as { success?: boolean; customer_id?: string | null };
        if (cancelled) return;
        if (planJson?.success) {
          setBootstrapLite({
            primary_org_id: planJson.primary_org_id,
            resolved_ui_state: planJson.resolved_ui_state,
          });
        } else {
          setBootstrapLite(null);
        }
        const cid = custJson?.success ? custJson.customer_id ?? null : null;
        setPwCustomerId(cid && cid.startsWith("ctm_") ? cid : null);
      } catch {
        if (!cancelled) {
          setBootstrapLite(null);
          setPwCustomerId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingPlanChange = bootstrapLite?.resolved_ui_state?.pending_plan_change === true;

  const onPaddleBuy = useCallback(async () => {
    if (!session?.email || busy || pendingPlanChange) return;
    setErr(null);
    setBusy(true);
    try {
      if (pathname.startsWith("/app")) {
        storeOriginRoute(
          typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname
        );
      }
      const r = await openPaddleSubscriptionCheckout({
        plan: planId,
        billing,
        email: session.email,
        userId: session.userId,
        pwCustomerId,
        primaryOrgId: bootstrapLite?.primary_org_id ?? null,
        projectId: null,
        onCompleted: () => {
          broadcastBillingBootstrapInvalidate();
          setBusy(false);
          router.push("/app");
        },
        onAborted: () => {
          setBusy(false);
        },
      });
      if (!r.ok) {
        setErr(r.error);
        setBusy(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка оплаты");
      setBusy(false);
    }
  }, [session, busy, pendingPlanChange, planId, billing, pwCustomerId, bootstrapLite?.primary_org_id, router]);

  if (authPhase === "loading") {
    return (
      <span
        className="inline-flex h-10 min-w-[130px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white/40"
        aria-hidden
      >
        …
      </span>
    );
  }

  if (authPhase === "guest" || !session?.email) {
    return (
      <Link
        href={guestHref}
        className="inline-flex h-10 min-w-[130px] cursor-pointer items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-500/[0.18] px-4 text-sm font-semibold text-white transition hover:bg-emerald-500/[0.28]"
        aria-label={`Приобрести тариф ${planId}`}
      >
        Приобрести
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={busy || pendingPlanChange}
        onClick={() => void onPaddleBuy()}
        className="inline-flex h-10 min-w-[130px] cursor-pointer items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-500/[0.18] px-4 text-sm font-semibold text-white transition hover:bg-emerald-500/[0.28] disabled:cursor-not-allowed disabled:opacity-45"
        aria-label={`Приобрести тариф ${planId}`}
        title={pendingPlanChange ? "Идёт смена тарифа — не оплачивайте повторно" : undefined}
      >
        {busy ? "Открываем…" : pendingPlanChange ? "Смена тарифа…" : "Приобрести"}
      </button>
      {err ? <span className="max-w-[180px] text-center text-[11px] text-red-300">{err}</span> : null}
    </span>
  );
}
