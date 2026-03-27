"use client";

import { useEffect } from "react";
import { getPaddle } from "@/app/lib/paddle";

export default function PaddleAppInit() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/current-customer", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; customer_id?: string | null };
        if (cancelled) return;
        const customerId = json?.success ? json.customer_id ?? null : null;
        // Safety: initialize Retain in-app only when we have a real Paddle customer id (ctm_...).
        // This avoids accidental blocking overlays for users without mapped billing profile.
        if (customerId && customerId.startsWith("ctm_")) {
          await getPaddle({ pwCustomerId: customerId });
        }
      } catch {
        // Do nothing on errors; in-app usage is optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

