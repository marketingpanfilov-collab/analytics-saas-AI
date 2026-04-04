"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  canOfferBillingInlinePricing,
  isBillingBlocking,
} from "@/app/lib/billingBootstrapClient";
import { suggestUpgradePlanId } from "@/app/lib/billingPlanDisplay";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import BillingInlinePricing from "./BillingInlinePricing";

type Ctx = {
  /** Opens inline pricing modal when billing blocks and checkout/manage is allowed; returns whether modal was opened. */
  requestBillingPricingModal: (sourceAction: string) => boolean;
};

const BillingPricingModalContext = createContext<Ctx | null>(null);

/** While BillingPricingModalProviderInner suspends (e.g. useSearchParams), children must still see a context value. */
const PRICING_MODAL_SUSPENSE_FALLBACK_CTX: Ctx = {
  requestBillingPricingModal: () => false,
};

export function useBillingPricingModalRequest(): Ctx {
  const c = useContext(BillingPricingModalContext);
  if (!c) {
    throw new Error("useBillingPricingModalRequest must be used within BillingPricingModalProvider");
  }
  return c;
}

function BillingPricingModalProviderInner({ children }: { children: ReactNode }) {
  const { resolvedUi, bootstrap } = useBillingBootstrap();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  const requestBillingPricingModal = useCallback(
    (sourceAction: string) => {
      void sourceAction;
      if (!resolvedUi) return false;
      if (!isBillingBlocking(resolvedUi)) return false;
      if (!canOfferBillingInlinePricing(resolvedUi)) return false;
      if (openRef.current) return false;
      openRef.current = true;
      setOpen(true);
      return true;
    },
    [resolvedUi]
  );

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const ctxValue = useMemo(() => ({ requestBillingPricingModal }), [requestBillingPricingModal]);

  return (
    <BillingPricingModalContext.Provider value={ctxValue}>
      {children}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Оформление подписки"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2100,
                background: "rgba(8,8,12,0.88)",
                backdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
              onClick={close}
            >
              <div
                style={{
                  maxWidth: 520,
                  width: "100%",
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(18,18,26,0.98)",
                  padding: "22px 20px",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 17, color: "white" }}>Подписка</div>
                  <button
                    type="button"
                    onClick={close}
                    style={{
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.06)",
                      color: "white",
                      borderRadius: 10,
                      width: 36,
                      height: 36,
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                    aria-label="Закрыть"
                  >
                    ✕
                  </button>
                </div>
                <BillingInlinePricing
                  projectId={projectId}
                  suggestPlan={suggestUpgradePlanId(bootstrap?.plan_feature_matrix?.plan)}
                  showComparisonLink
                  onAfterCheckoutCompleted={close}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </BillingPricingModalContext.Provider>
  );
}

export function BillingPricingModalProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <BillingPricingModalContext.Provider value={PRICING_MODAL_SUSPENSE_FALLBACK_CTX}>
          {children}
        </BillingPricingModalContext.Provider>
      }
    >
      <BillingPricingModalProviderInner>{children}</BillingPricingModalProviderInner>
    </Suspense>
  );
}
