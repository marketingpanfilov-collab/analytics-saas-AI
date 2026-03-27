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
        await getPaddle({ pwCustomerId: customerId });
      } catch {
        await getPaddle();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

