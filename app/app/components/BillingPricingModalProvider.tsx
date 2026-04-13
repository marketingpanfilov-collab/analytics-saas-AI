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
import { canOfferBillingInlinePricing, isBillingBlocking } from "@/app/lib/billingBootstrapClient";
import { suggestUpgradePlanId } from "@/app/lib/billingPlanDisplay";
import { ScreenId } from "@/app/lib/billingUiContract";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import { BillingInlinePricingSuspended } from "./BillingInlinePricing";

export type RequestBillingPricingModalOptions = {
  /** Открыть модалку даже без жёсткой блокировки биллинга (например, апгрейд со Starter по CTA на странице). */
  force?: boolean;
};

type Ctx = {
  /** Opens inline pricing modal when billing blocks and checkout/manage is allowed; returns whether modal was opened. */
  requestBillingPricingModal: (sourceAction: string, opts?: RequestBillingPricingModalOptions) => boolean;
};

const BillingPricingModalContext = createContext<Ctx | null>(null);

/** While BillingPricingModalProviderInner suspends (e.g. useSearchParams), children must still see a context value. */
const PRICING_MODAL_SUSPENSE_FALLBACK_CTX: Ctx = {
  requestBillingPricingModal: (_sourceAction, _opts) => false,
};

export function useBillingPricingModalRequest(): Ctx {
  const c = useContext(BillingPricingModalContext);
  if (!c) {
    throw new Error("useBillingPricingModalRequest must be used within BillingPricingModalProvider");
  }
  return c;
}

export function useOptionalBillingPricingModalRequest(): Ctx | null {
  return useContext(BillingPricingModalContext);
}

function BillingPricingModalProviderInner({ children }: { children: ReactNode }) {
  const { resolvedUi, bootstrap, overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook } =
    useBillingBootstrap();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const [open, setOpen] = useState(false);
  /** Аргумент последнего вызова requestBillingPricingModal (для контекста шапки модалки). */
  const [pricingModalEntrySource, setPricingModalEntrySource] = useState<string | null>(null);
  const openRef = useRef(false);

  const billingBlockingOpts = useMemo(
    () => ({ overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook }),
    [overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook]
  );

  const requestBillingPricingModal = useCallback(
    (sourceAction: string, opts?: RequestBillingPricingModalOptions) => {
      if (!resolvedUi) return false;
      if (!opts?.force && !isBillingBlocking(resolvedUi, billingBlockingOpts)) return false;
      if (!canOfferBillingInlinePricing(resolvedUi)) return false;
      if (openRef.current) return false;
      openRef.current = true;
      setPricingModalEntrySource(sourceAction);
      setOpen(true);
      return true;
    },
    [resolvedUi, billingBlockingOpts]
  );

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setPricingModalEntrySource(null);
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
              aria-label="Обновление тарифа"
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
                  position: "relative",
                  maxWidth: "min(880px, calc(100vw - 40px))",
                  maxHeight: "min(92vh, calc(100vh - 40px))",
                  width: "100%",
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(18,18,26,0.98)",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 20,
                    flexShrink: 0,
                    display: "flex",
                    justifyContent: "flex-end",
                    padding: "14px 14px 0",
                    background: "linear-gradient(to bottom, rgba(18,18,26,0.98) 70%, rgba(18,18,26,0))",
                  }}
                >
                  <button
                    type="button"
                    onClick={close}
                    style={{
                      width: 40,
                      height: 40,
                      margin: 0,
                      padding: 0,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.06)",
                      color: "white",
                      borderRadius: 10,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 0,
                    }}
                    aria-label="Закрыть"
                  >
                    <span style={{ fontSize: 18, lineHeight: 1, display: "block" }}>✕</span>
                  </button>
                </div>
                <div
                  className="scrollbar-hidden"
                  style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "4px 32px 30px",
                    boxSizing: "border-box",
                  }}
                >
                  <BillingInlinePricingSuspended
                    projectId={projectId}
                    suggestPlan={suggestUpgradePlanId(bootstrap?.plan_feature_matrix?.plan)}
                    showComparisonLink
                    widePlanGrid
                    pricingModalEntrySource={pricingModalEntrySource}
                    onAfterCheckoutCompleted={close}
                    variant={resolvedUi?.screen === ScreenId.OVER_LIMIT_FULLSCREEN ? "over_limit" : "default"}
                  />
                </div>
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
