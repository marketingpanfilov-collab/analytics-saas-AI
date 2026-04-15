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
              className="flex items-center justify-center p-2 pt-[max(8px,env(safe-area-inset-top))] pb-[max(8px,env(safe-area-inset-bottom))] sm:p-5"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2100,
                background: "rgba(8,8,12,0.88)",
                backdropFilter: "blur(8px)",
              }}
              onClick={close}
            >
              <div
                className="relative box-border flex min-h-0 w-full max-h-[min(92dvh,calc(100vh-16px))] max-w-[min(880px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[rgba(18,18,26,0.98)] shadow-[0_24px_80px_rgba(0,0,0,0.65)] sm:max-h-[min(92vh,calc(100vh-40px))] sm:max-w-[min(880px,calc(100vw-40px))]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 z-20 flex shrink-0 justify-end bg-gradient-to-b from-[rgba(18,18,26,0.98)] from-70% to-transparent px-3 pb-3 pt-2 sm:px-3.5 sm:pb-3.5 sm:pt-3.5">
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex size-10 shrink-0 items-center justify-center p-0 text-white"
                    style={{
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                    aria-label="Закрыть"
                  >
                    <svg
                      width={20}
                      height={20}
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                      className="block shrink-0"
                    >
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
                <div className="scrollbar-hidden box-border min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-px sm:px-8 sm:pb-8">
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
