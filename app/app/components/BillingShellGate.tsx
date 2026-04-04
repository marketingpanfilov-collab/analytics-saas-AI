"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { ActionId, CtaKey, ReasonCode, ScreenId } from "@/app/lib/billingUiContract";
import {
  billingActionAllowed,
  clearBillingRouteStorage,
  normalizeBillingFeatureFlags,
} from "@/app/lib/billingBootstrapClient";
import { billingPayloadFromResolved, emitBillingCjmEvent } from "@/app/lib/billingCjmAnalytics";
import { suggestUpgradePlanId } from "@/app/lib/billingPlanDisplay";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import BillingInlinePricing from "./BillingInlinePricing";

const HARD_OVERLAY_SCREENS = new Set<string>([
  ScreenId.PAYWALL,
  ScreenId.NO_ORG_ACCESS,
  ScreenId.OVER_LIMIT_FULLSCREEN,
  ScreenId.INVITE_LOADING,
  ScreenId.INVITE_FALLBACK,
  ScreenId.BILLING_REFUNDED,
]);

function shellTitle(screen: string, reason: string): string {
  if (screen === ScreenId.PAYWALL) return "Нужна подписка";
  if (screen === ScreenId.NO_ORG_ACCESS) return "Нет доступа к организации";
  if (screen === ScreenId.OVER_LIMIT_FULLSCREEN) return "Превышен лимит тарифа";
  if (screen === ScreenId.INVITE_LOADING) return "Ожидаем приглашение";
  if (screen === ScreenId.INVITE_FALLBACK) return "Приглашение";
  if (screen === ScreenId.BILLING_REFUNDED) return "Подписка недоступна";
  if (reason === ReasonCode.BOOTSTRAP_UNAVAILABLE) return "Не удалось загрузить статус";
  return "Доступ ограничен";
}

function shellBody(resolved: { screen: string; reason: string; over_limit_details?: unknown }): string {
  if (resolved.screen === ScreenId.INVITE_LOADING) {
    return "Мы проверяем приглашение в проект. Обычно это занимает несколько секунд.";
  }
  if (resolved.screen === ScreenId.INVITE_FALLBACK) {
    return "Проверьте почту и примите приглашение или запросите новое. Если письма нет — обратитесь в поддержку.";
  }
  if (resolved.screen === ScreenId.NO_ORG_ACCESS) {
    return "Ваш аккаунт больше не связан с организацией. Обновите статус или выйдите и войдите снова.";
  }
  if (resolved.screen === ScreenId.OVER_LIMIT_FULLSCREEN) {
    const d = resolved.over_limit_details;
    if (Array.isArray(d) && d.length > 0) {
      const parts = d.map(
        (v: { type?: string; current?: number; limit?: number }) =>
          `${v.type ?? "?"}: ${v.current ?? "?"} / ${v.limit ?? "?"}`
      );
      return `Снизьте нагрузку по тарифу или повысьте план. Детали: ${parts.join("; ")}`;
    }
    return "Снизьте количество проектов, мест или рекламных аккаунтов в соответствии с тарифом.";
  }
  if (resolved.screen === ScreenId.BILLING_REFUNDED) {
    return "По подписке оформлен возврат. Для доступа к продукту оформите новую подписку или свяжитесь с поддержкой.";
  }
  if (resolved.screen === ScreenId.PAYWALL) {
    return "Оформите подписку, чтобы пользоваться аналитикой BoardIQ.";
  }
  if (resolved.reason === ReasonCode.BOOTSTRAP_UNAVAILABLE) {
    return "Повторите загрузку статуса подписки. До этого момента действия с данными отключены.";
  }
  return "Текущий режим доступа не позволяет открыть приложение.";
}

function BillingShellGateInner({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId: string | null;
}) {
  const router = useRouter();
  const { resolvedUi, bootstrap, loading, reloadBootstrap } = useBillingBootstrap();
  const flags = normalizeBillingFeatureFlags(bootstrap?.feature_flags);

  if (loading || !resolvedUi) {
    return <>{children}</>;
  }

  if (flags.client_gating === false || flags.resolved_ui_shell === false) {
    return <>{children}</>;
  }

  if (resolvedUi.screen === ScreenId.POST_CHECKOUT_MODAL) {
    return <>{children}</>;
  }

  if (resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN && flags.over_limit_ui === false) {
    return <>{children}</>;
  }

  const hard = resolvedUi.blocking_level === "hard";
  const overlay = hard && HARD_OVERLAY_SCREENS.has(resolvedUi.screen);

  if (!overlay) {
    return <>{children}</>;
  }

  const goSettings = () => {
    if (billingActionAllowed(resolvedUi, ActionId.navigate_settings)) router.push("/app/settings");
  };
  const signOut = async () => {
    if (!billingActionAllowed(resolvedUi, ActionId.sign_out)) return;
    await supabase.auth.signOut();
    clearBillingRouteStorage();
    router.replace("/login");
  };

  const title = shellTitle(resolvedUi.screen, resolvedUi.reason);
  const body = shellBody(resolvedUi);

  const showSubscribeInline =
    resolvedUi.cta === CtaKey.subscribe &&
    billingActionAllowed(resolvedUi, ActionId.billing_checkout) &&
    !resolvedUi.pending_plan_change;

  const showOverLimitInline =
    resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN &&
    billingActionAllowed(resolvedUi, ActionId.billing_manage) &&
    !resolvedUi.pending_plan_change;

  useEffect(() => {
    if (resolvedUi.screen !== ScreenId.PAYWALL) return;
    emitBillingCjmEvent(
      "paywall_shown",
      billingPayloadFromResolved(resolvedUi, {
        plan:
          (bootstrap?.plan_feature_matrix?.plan as string | undefined) ??
          bootstrap?.subscription?.plan ??
          "unknown",
        userId: null,
        source_action: "hard_shell_paywall",
      })
    );
  }, [resolvedUi.screen, resolvedUi.request_id, bootstrap?.plan_feature_matrix?.plan, bootstrap?.subscription?.plan]);

  const showPendingBlocksPayment =
    resolvedUi.pending_plan_change &&
    (resolvedUi.screen === ScreenId.PAYWALL || resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN);

  const widePanel = showSubscribeInline || showOverLimitInline || showPendingBlocksPayment;
  const upgradeSuggest = suggestUpgradePlanId(bootstrap?.plan_feature_matrix?.plan);

  return (
    <>
      <div
        style={{
          filter: "grayscale(0.25) blur(1px)",
          opacity: 0.35,
          pointerEvents: "none",
          minHeight: "100%",
        }}
        aria-hidden
      >
        {children}
      </div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-shell-gate-title"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          background: "rgba(8,8,12,0.92)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            maxWidth: widePanel ? 640 : 480,
            width: "100%",
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(18,18,26,0.98)",
            padding: "28px 24px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
            margin: "auto",
          }}
        >
          <h1
            id="billing-shell-gate-title"
            style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "white" }}
          >
            {title}
          </h1>
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.45, color: "rgba(255,255,255,0.78)" }}>
            {body}
          </p>
          {resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN &&
          Array.isArray(resolvedUi.over_limit_details) &&
          resolvedUi.over_limit_details.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>
                Что превышено
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  color: "rgba(255,255,255,0.88)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {resolvedUi.over_limit_details.map((row, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {row.type === "projects"
                      ? `Проекты: ${row.current} из ${row.limit} разрешённых`
                      : row.type === "seats"
                        ? `Участники организации: ${row.current} из ${row.limit}`
                        : `Рекламные аккаунты (включённые): ${row.current} из ${row.limit}`}
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 10, lineHeight: 1.45 }}>
                Удалите лишнее или отключите ненужные кабинеты, затем обновите статус. Либо повысьте тариф.
              </div>
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => router.push("/app/projects")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Проекты
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/app/org-members")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Команда орг.
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/app/accounts")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Рекл. аккаунты
                </button>
              </div>
            </div>
          ) : null}

          {showPendingBlocksPayment ? (
            <div
              style={{
                marginTop: 18,
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid rgba(120,120,255,0.35)",
                background: "rgba(120,120,255,0.1)",
                color: "rgba(230,230,255,0.95)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
              role="status"
            >
              Изменение тарифа обрабатывается. Не оформляйте повторную оплату — дождитесь подтверждения Paddle или
              обновите статус ниже.
            </div>
          ) : null}

          {showSubscribeInline ? (
            <BillingInlinePricing projectId={projectId} disabled={false} showComparisonLink />
          ) : null}

          {showOverLimitInline ? (
            <BillingInlinePricing
              projectId={projectId}
              disabled={false}
              suggestPlan={upgradeSuggest}
              showComparisonLink
            />
          ) : null}

          <div style={{ marginTop: 22, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {resolvedUi.cta === CtaKey.upgrade && billingActionAllowed(resolvedUi, ActionId.billing_manage) && (
              <button
                type="button"
                onClick={goSettings}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "none",
                  background: "rgba(120,160,255,0.95)",
                  color: "#0b0b10",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Управление подпиской
              </button>
            )}
            {(resolvedUi.cta === CtaKey.retry_bootstrap ||
              resolvedUi.reason === ReasonCode.BOOTSTRAP_UNAVAILABLE ||
              resolvedUi.reason === ReasonCode.INVITE_TIMEOUT) &&
              billingActionAllowed(resolvedUi, ActionId.retry_bootstrap) && (
                <button
                  type="button"
                  onClick={() => reloadBootstrap()}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Обновить статус
                </button>
              )}
            {billingActionAllowed(resolvedUi, ActionId.navigate_settings) && (
              <button
                type="button"
                onClick={goSettings}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "transparent",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Настройки
              </button>
            )}
            {billingActionAllowed(resolvedUi, ActionId.support) && (
              <button
                type="button"
                onClick={() => router.push("/app/support")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Поддержка
              </button>
            )}
            {billingActionAllowed(resolvedUi, ActionId.sign_out) && (
              <button
                type="button"
                onClick={() => void signOut()}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,100,100,0.35)",
                  background: "rgba(255,80,80,0.08)",
                  color: "rgba(255,200,200,0.95)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Выйти
              </button>
            )}
          </div>
          {resolvedUi.request_id ? (
            <div style={{ marginTop: 16, fontSize: 11, opacity: 0.45, color: "white" }}>
              request_id: {resolvedUi.request_id}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function BillingShellGateSearchParamsBridge({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() || null;
  return <BillingShellGateInner projectId={projectId}>{children}</BillingShellGateInner>;
}

export function BillingShellGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<BillingShellGateInner projectId={null}>{children}</BillingShellGateInner>}>
      <BillingShellGateSearchParamsBridge>{children}</BillingShellGateSearchParamsBridge>
    </Suspense>
  );
}
