"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  billingActionAllowed,
  blockingLevelRank,
  normalizeBillingFeatureFlags,
} from "@/app/lib/billingBootstrapClient";
import { ActionId, ReasonCode, ScreenId, type BlockingLevel } from "@/app/lib/billingUiContract";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import BillingInlinePricing from "./BillingInlinePricing";

const REASON_HUMAN: Partial<Record<ReasonCode, string>> = {
  [ReasonCode.BILLING_UNPAID]: "статус подписки: не оплачено",
  [ReasonCode.BILLING_EXPIRED]: "статус подписки: истекло",
  [ReasonCode.BILLING_PAST_DUE]: "просрочен платёж",
  [ReasonCode.BILLING_GRACE]: "период отсрочки оплаты",
  [ReasonCode.BILLING_REFUNDED]: "возврат по подписке",
  [ReasonCode.BILLING_NO_SUBSCRIPTION]: "нет активной подписки",
  [ReasonCode.PLAN_CHANGE_PENDING]: "ожидание смены тарифа",
  [ReasonCode.OVER_LIMIT_PROJECTS]: "превышен лимит проектов",
  [ReasonCode.OVER_LIMIT_SEATS]: "превышен лимит мест",
  [ReasonCode.OVER_LIMIT_AD_ACCOUNTS]: "превышен лимит рекламных аккаунтов",
  [ReasonCode.BOOTSTRAP_UNAVAILABLE]: "не удалось подтвердить подписку",
};

export function PlanChangePendingBanner() {
  const { resolvedUi, loading, reloadBootstrap, bootstrap } = useBillingBootstrap();
  const flags = normalizeBillingFeatureFlags(bootstrap?.feature_flags);
  if (flags.pending_plan_banner === false) return null;
  if (loading || resolvedUi?.reason !== ReasonCode.PLAN_CHANGE_PENDING) return null;
  return (
    <div
      role="status"
      style={{
        padding: "10px 16px",
        fontSize: 13,
        background: "rgba(120,120,255,0.15)",
        borderBottom: "1px solid rgba(120,120,255,0.25)",
        color: "rgba(230,230,255,0.95)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>Изменение тарифа обрабатывается — не оформляйте повторную оплату. Обычно это до минуты.</span>
      <button
        type="button"
        onClick={() => reloadBootstrap()}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,255,255,0.06)",
          color: "white",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Обновить статус
      </button>
    </div>
  );
}

/** P2-UI-07: surface stricter blocking (no silent downgrade). */
export function BillingAccessStricterBanner() {
  const { resolvedUi, loading } = useBillingBootstrap();
  const prev = useRef<{ level: BlockingLevel; reason: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading || !resolvedUi) return;
    const cur = resolvedUi.blocking_level;
    const pr = prev.current;
    prev.current = { level: cur, reason: resolvedUi.reason };
    if (!pr) return;
    if (blockingLevelRank(cur) > blockingLevelRank(pr.level)) {
      setOpen(true);
    }
  }, [resolvedUi, loading]);

  if (!open) return null;
  const reasonHuman =
    REASON_HUMAN[resolvedUi?.reason as ReasonCode] ?? `причина: ${resolvedUi?.reason ?? "—"}`;
  return (
    <div
      role="status"
      style={{
        padding: "10px 16px",
        fontSize: 13,
        background: "rgba(255,120,80,0.14)",
        borderBottom: "1px solid rgba(255,120,80,0.28)",
        color: "rgba(255,230,210,0.98)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>
        Режим доступа стал строже — {reasonHuman}. Проверьте биллинг и тариф.
        {resolvedUi?.request_id ? (
          <span style={{ opacity: 0.65, marginLeft: 8, fontSize: 11 }}>
            (request_id: {resolvedUi.request_id})
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(0,0,0,0.2)",
          color: "white",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Скрыть
      </button>
    </div>
  );
}

const READ_ONLY_PAYWALL_REASONS = new Set<string>([ReasonCode.BILLING_UNPAID, ReasonCode.BILLING_EXPIRED]);

function ReadOnlyPaywallBannerInner({ projectId }: { projectId: string | null }) {
  const { resolvedUi, bootstrap, loading } = useBillingBootstrap();
  const flags = normalizeBillingFeatureFlags(bootstrap?.feature_flags);
  const [open, setOpen] = useState(false);

  if (flags.client_gating === false || flags.resolved_ui_shell === false) return null;
  if (loading || !resolvedUi) return null;
  if (resolvedUi.screen !== ScreenId.READ_ONLY_SHELL) return null;
  if (!READ_ONLY_PAYWALL_REASONS.has(resolvedUi.reason)) return null;
  if (!billingActionAllowed(resolvedUi, ActionId.billing_manage)) return null;
  if (resolvedUi.pending_plan_change) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Оплата подписки"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 25,
          padding: "10px 16px",
          fontSize: 13,
          background: "rgba(52,211,153,0.12)",
          borderBottom: "1px solid rgba(52,211,153,0.28)",
          color: "rgba(230,255,240,0.98)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ lineHeight: 1.45 }}>
          <strong style={{ display: "block", marginBottom: 4 }}>Доступ только для чтения</strong>
          Причина:{" "}
          {REASON_HUMAN[resolvedUi.reason as ReasonCode] ?? resolvedUi.reason}. Продлите подписку, чтобы снова
          изменять данные и синхронизации.
        </span>
        <button
          type="button"
          onClick={() => setOpen((was) => (was ? was : true))}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "none",
            background: "rgba(52,211,153,0.92)",
            color: "#0b0b10",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          Продлить доступ
        </button>
      </div>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Выбор тарифа"
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
          onClick={() => setOpen(false)}
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
              <div style={{ fontWeight: 900, fontSize: 17, color: "white" }}>Тарифы и оплата</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
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
              compact
              showComparisonLink
              onAfterCheckoutCompleted={() => setOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function ReadOnlyPaywallBannerParamsBridge() {
  const sp = useSearchParams();
  const projectId = sp.get("project_id")?.trim() || null;
  return <ReadOnlyPaywallBannerInner projectId={projectId} />;
}

/** Sticky CTA for soft read-only (unpaid / expired / paused → READ_ONLY_SHELL). */
export function ReadOnlyPaywallBanner() {
  return (
    <Suspense fallback={<ReadOnlyPaywallBannerInner projectId={null} />}>
      <ReadOnlyPaywallBannerParamsBridge />
    </Suspense>
  );
}

export function BillingClientSafeModeBanner() {
  const { clientSafeMode, reloadBootstrap } = useBillingBootstrap();
  if (!clientSafeMode) return null;
  return (
    <div
      role="alert"
      style={{
        padding: "10px 16px",
        fontSize: 13,
        background: "rgba(220,160,60,0.18)",
        borderBottom: "1px solid rgba(220,160,60,0.35)",
        color: "rgba(255,240,210,0.98)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>Сервис временно недоступен: не удалось проверить подписку. Данные на экране могут быть неполными.</span>
      <button
        type="button"
        onClick={() => reloadBootstrap()}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(0,0,0,0.2)",
          color: "white",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Повторить
      </button>
    </div>
  );
}
