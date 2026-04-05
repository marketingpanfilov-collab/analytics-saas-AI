"use client";

import {
  billingActionAllowed,
  canOfferBillingInlinePricing,
} from "@/app/lib/billingBootstrapClient";
import { ActionId, ScreenId } from "@/app/lib/billingUiContract";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import { useOptionalBillingPricingModalRequest } from "./BillingPricingModalProvider";

const REMEDIAL_ROUTE_BANNER_COPY =
  "Превышен лимит тарифа. Вы используете больше ресурсов, чем предусмотрено вашим планом. Снизьте использование или обновите тариф, чтобы продолжить работу.";

export function OverLimitRemedialRouteBanner({
  reloadBootstrap,
}: {
  reloadBootstrap: () => Promise<unknown>;
}) {
  const { resolvedUi } = useBillingBootstrap();
  const pricingModal = useOptionalBillingPricingModalRequest();

  if (!resolvedUi || resolvedUi.screen !== ScreenId.OVER_LIMIT_FULLSCREEN) return null;

  const canUpgrade =
    canOfferBillingInlinePricing(resolvedUi) && billingActionAllowed(resolvedUi, ActionId.billing_manage);

  return (
    <div
      role="status"
      style={{
        padding: "12px 18px",
        fontSize: 13,
        lineHeight: 1.45,
        background: "rgba(255,160,80,0.12)",
        borderBottom: "1px solid rgba(255,160,80,0.28)",
        color: "rgba(255,235,210,0.98)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <span>{REMEDIAL_ROUTE_BANNER_COPY}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {canUpgrade && pricingModal ? (
          <button
            type="button"
            onClick={() => pricingModal.requestBillingPricingModal("over_limit_remedial_banner")}
            style={{
              padding: "7px 14px",
              borderRadius: 10,
              border: "none",
              background: "rgba(52,211,153,0.9)",
              color: "#0b0b10",
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Повысить тариф
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void reloadBootstrap()}
          style={{
            padding: "7px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(255,255,255,0.08)",
            color: "white",
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Обновить статус
        </button>
      </div>
    </div>
  );
}
