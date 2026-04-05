"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { ActionId, CtaKey, ReasonCode, ScreenId } from "@/app/lib/billingUiContract";
import { settingsProjectAccessMembersUrl, withProjectIdParam } from "@/app/lib/appRouteWithProject";
import {
  billingActionAllowed,
  clearBillingRouteStorage,
  normalizeBillingFeatureFlags,
} from "@/app/lib/billingBootstrapClient";
import { billingPayloadFromResolved, emitBillingCjmEvent } from "@/app/lib/billingCjmAnalytics";
import { suggestUpgradePlanId } from "@/app/lib/billingPlanDisplay";
import {
  OverLimitViolationEmptyHint,
  OverLimitViolationLines,
  type OverLimitDetailRow,
} from "@/app/lib/billingOverLimitDetails";
import { isOverLimitRemedialPathname } from "@/app/lib/overLimitRemedialRoutes";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import { BillingInlinePricingSuspended } from "./BillingInlinePricing";
import { OverLimitRemedialRouteBanner } from "./OverLimitRemedialRouteBanner";

const HARD_OVERLAY_SCREENS = new Set<string>([
  ScreenId.PAYWALL,
  ScreenId.NO_ORG_ACCESS,
  ScreenId.OVER_LIMIT_FULLSCREEN,
  ScreenId.INVITE_LOADING,
  ScreenId.INVITE_FALLBACK,
  ScreenId.BILLING_REFUNDED,
]);

function shellTitle(screen: string, reason: string): string {
  if (screen === ScreenId.PAYWALL) return "Необходимо оформить подписку";
  if (screen === ScreenId.NO_ORG_ACCESS) return "Нет доступа к организации";
  if (screen === ScreenId.OVER_LIMIT_FULLSCREEN) return "Вы не можете продолжить работу";
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
    return "";
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

const shellSectionDivider: CSSProperties = {
  marginTop: 20,
  paddingTop: 20,
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

/** Paywall / широкая панель тарифов: больше воздуха между секциями. */
const shellSectionDividerWide: CSSProperties = {
  marginTop: 28,
  paddingTop: 28,
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const remedialShellBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

/** Over-limit footer: «Настройки» / «Поддержка» — одинаковая ширина и отступы. */
const overLimitFooterPairedBtn: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  minWidth: 148,
  boxSizing: "border-box",
  fontWeight: 600,
  cursor: "pointer",
  flex: "0 0 auto",
};

function overLimitHumanLines(details: OverLimitDetailRow[]): ReactNode {
  if (!details.length) return <OverLimitViolationEmptyHint />;
  return <OverLimitViolationLines details={details} />;
}

function BillingShellGateInner({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  /** Навигация из футера шелла: «Позже» / «Поддержка» — показываем «Подождите…» до смены маршрута. */
  const [shellFooterNavPending, setShellFooterNavPending] = useState<"later" | "support" | null>(null);
  const {
    resolvedUi,
    bootstrap,
    loading,
    reloadBootstrap,
    overLimitApplyGraceUntilMs,
    relaxOverLimitForPendingWebhook,
  } = useBillingBootstrap();
  const flags = normalizeBillingFeatureFlags(bootstrap?.feature_flags);

  const overLimitTypes = useMemo(() => {
    const s = new Set<"projects" | "seats" | "ad_accounts">();
    if (!resolvedUi) return s;
    const d = resolvedUi.over_limit_details;
    if (Array.isArray(d)) {
      for (const r of d) {
        if (r?.type === "projects" || r?.type === "seats" || r?.type === "ad_accounts") s.add(r.type);
      }
    }
    return s;
  }, [resolvedUi]);

  const remedialShowAll = overLimitTypes.size === 0;
  const remedialShowProjects = remedialShowAll || overLimitTypes.has("projects");
  const remedialShowSeats = remedialShowAll || overLimitTypes.has("seats");
  const remedialShowAds = remedialShowAll || overLimitTypes.has("ad_accounts");

  useEffect(() => {
    if (!resolvedUi || resolvedUi.screen !== ScreenId.PAYWALL) return;
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
  }, [
    resolvedUi?.screen,
    resolvedUi?.request_id,
    bootstrap?.plan_feature_matrix?.plan,
    bootstrap?.subscription?.plan,
  ]);

  useEffect(() => {
    setShellFooterNavPending(null);
  }, [pathname]);

  useEffect(() => {
    if (!shellFooterNavPending) return;
    const id = window.setTimeout(() => setShellFooterNavPending(null), 15000);
    return () => window.clearTimeout(id);
  }, [shellFooterNavPending]);

  if (loading || !resolvedUi) {
    return <>{children}</>;
  }

  if (flags.client_gating === false || flags.resolved_ui_shell === false) {
    return <>{children}</>;
  }

  if (resolvedUi.screen === ScreenId.POST_CHECKOUT_MODAL) {
    return <>{children}</>;
  }

  // Передача организации по ссылке: получатель может быть без членства / под paywall.
  if (pathname.startsWith("/app/transfer/")) {
    return <>{children}</>;
  }

  // Invite flow: не показывать INVITE_* поверх /app/invite/* — иначе «Принять» и шелл конфликтуют
  // (старые pending invites на email дают INVITE_FALLBACK даже по валидной ссылке).
  if (
    (pathname.startsWith("/app/invite/accept") || pathname.startsWith("/app/invite/set-password")) &&
    (resolvedUi.screen === ScreenId.INVITE_LOADING || resolvedUi.screen === ScreenId.INVITE_FALLBACK)
  ) {
    return <>{children}</>;
  }

  const onProjectsListRoute = pathname === "/app/projects" || pathname.startsWith("/app/projects/");
  const bootstrapSharedAccess =
    bootstrap?.has_org_membership === true || bootstrap?.has_any_accessible_project === true;
  if (onProjectsListRoute && resolvedUi.screen === ScreenId.PAYWALL && bootstrapSharedAccess) {
    return <>{children}</>;
  }

  const overLimitGraceActive =
    typeof overLimitApplyGraceUntilMs === "number" && Date.now() < overLimitApplyGraceUntilMs;

  const overLimitWebhookPendingSoft =
    relaxOverLimitForPendingWebhook && !overLimitGraceActive;

  if (
    resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN &&
    flags.over_limit_ui !== false &&
    overLimitGraceActive
  ) {
    return (
      <>
        <div
          role="status"
          style={{
            padding: "12px 18px",
            background: "rgba(52,99,230,0.2)",
            borderBottom: "1px solid rgba(120,160,255,0.35)",
            color: "rgba(230,240,255,0.96)",
            fontSize: 13,
            lineHeight: 1.5,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <span style={{ textAlign: "center", flex: "1 1 240px" }}>
            Подписка уже обновлена в Paddle; лимиты в приложении подтянутся после webhook. Обновление может занять до
            минуты. Если статус не обновился — обратитесь в поддержку.
          </span>
          <button
            type="button"
            onClick={() => void reloadBootstrap()}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(160,200,255,0.45)",
              background: "rgba(255,255,255,0.1)",
              color: "white",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Обновить статус
          </button>
        </div>
        {children}
      </>
    );
  }

  if (
    resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN &&
    flags.over_limit_ui !== false &&
    overLimitWebhookPendingSoft
  ) {
    return (
      <>
        <div
          role="status"
          style={{
            padding: "12px 18px",
            background: "rgba(52,99,230,0.18)",
            borderBottom: "1px solid rgba(120,160,255,0.32)",
            color: "rgba(230,240,255,0.96)",
            fontSize: 13,
            lineHeight: 1.5,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <span style={{ textAlign: "center", flex: "1 1 240px" }}>
            <strong style={{ display: "block", marginBottom: 4 }}>Мы обрабатываем обновление подписки</strong>
            Это может занять немного больше времени. Вы можете обновить статус или обратиться в поддержку.
          </span>
          <button
            type="button"
            onClick={() => void reloadBootstrap()}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(160,200,255,0.45)",
              background: "rgba(255,255,255,0.1)",
              color: "white",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Обновить статус
          </button>
          {billingActionAllowed(resolvedUi, ActionId.support) ? (
            <button
              type="button"
              onClick={() => router.push(withProjectIdParam("/app/support", projectId))}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Поддержка
            </button>
          ) : null}
        </div>
        {children}
      </>
    );
  }

  if (resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN && flags.over_limit_ui === false) {
    return <>{children}</>;
  }

  if (
    resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN &&
    flags.over_limit_ui !== false &&
    isOverLimitRemedialPathname(pathname)
  ) {
    return (
      <>
        <OverLimitRemedialRouteBanner reloadBootstrap={reloadBootstrap} />
        {children}
      </>
    );
  }

  const hard = resolvedUi.blocking_level === "hard";
  const overlay = hard && HARD_OVERLAY_SCREENS.has(resolvedUi.screen);

  if (!overlay) {
    return <>{children}</>;
  }

  const goSettings = () => {
    if (!billingActionAllowed(resolvedUi, ActionId.navigate_settings)) return;
    router.push(withProjectIdParam("/app/settings", projectId));
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

  const showPendingBlocksPayment =
    resolvedUi.pending_plan_change &&
    (resolvedUi.screen === ScreenId.PAYWALL || resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN);

  const widePanel = showSubscribeInline || showOverLimitInline || showPendingBlocksPayment;
  const upgradeSuggest = suggestUpgradePlanId(bootstrap?.plan_feature_matrix?.plan);
  /** Шире, чтобы длинные строки (заголовок, подписи к планам) реже переносились. */
  const panelMaxWidth = widePanel ? 720 : 480;
  const isOverLimitScreen = resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN;
  const simplifyOverLimitFooter = isOverLimitScreen && showOverLimitInline;

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
          padding: widePanel ? 28 : 24,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            maxWidth: panelMaxWidth,
            width: "100%",
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(18,18,26,0.98)",
            padding: widePanel ? "36px 28px 34px" : "28px 24px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
            margin: "auto",
          }}
        >
          <div
            style={
              isOverLimitScreen || showSubscribeInline
                ? { textAlign: "center", ...(widePanel ? { marginBottom: 8 } : {}) }
                : undefined
            }
          >
            <h1
              id="billing-shell-gate-title"
              style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "white" }}
            >
              {title}
            </h1>
            {isOverLimitScreen && showOverLimitInline ? (
              <p
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.45,
                  color: "rgba(230,240,255,0.96)",
                }}
              >
                Обновите тариф, чтобы продолжить добавление участников и работу с проектом.
              </p>
            ) : null}
            {body ? (
              <p
                style={{
                  marginTop:
                    isOverLimitScreen && showOverLimitInline ? 10 : showSubscribeInline ? 18 : 14,
                  fontSize: 14,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                {body}
              </p>
            ) : null}
          </div>
          {resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN ? (
            <div style={shellSectionDividerWide}>
              {showOverLimitInline ? (
                overLimitHumanLines(
                  Array.isArray(resolvedUi.over_limit_details) ? resolvedUi.over_limit_details : []
                )
              ) : (
                <div className="flex w-full max-w-full flex-col items-stretch gap-6 sm:flex-row sm:gap-x-10">
                  <div className="flex min-w-0 flex-1 flex-col items-center text-center sm:basis-0">
                    <div className="mb-2 text-xs font-bold text-white/55">Превышение лимитов:</div>
                    {Array.isArray(resolvedUi.over_limit_details) && resolvedUi.over_limit_details.length > 0 ? (
                      <ul className="m-0 list-inside list-disc space-y-1.5 px-0 text-center text-[13px] leading-normal text-white/90">
                        {resolvedUi.over_limit_details.map((row, i) => (
                          <li key={i}>
                            {row.type === "projects"
                              ? `Проекты: ${row.current} из ${row.limit}`
                              : row.type === "seats"
                                ? `Участники организации: ${row.current} из ${row.limit}`
                                : `Рекламные аккаунты: ${row.current} из ${row.limit}`}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-center text-[13px] leading-normal text-white/52">
                        Детали появятся после обновления статуса. Выберите раздел ниже или повысьте тариф.
                      </p>
                    )}
                  </div>
                  <div
                    className="hidden w-px shrink-0 self-stretch bg-white/[0.08] sm:block"
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col items-center text-center sm:basis-0">
                    <div className="mb-2 text-xs font-bold text-white/55">Необходимо исправить:</div>
                    <div className="flex w-full max-w-full flex-wrap justify-center gap-2">
                      {remedialShowProjects ? (
                        <button type="button" onClick={() => router.push("/app/projects")} style={remedialShellBtn}>
                          Проекты
                        </button>
                      ) : null}
                      {remedialShowSeats ? (
                        <button
                          type="button"
                          onClick={() => router.push(settingsProjectAccessMembersUrl(projectId))}
                          style={remedialShellBtn}
                        >
                          Команда
                        </button>
                      ) : null}
                      {remedialShowAds ? (
                        <button
                          type="button"
                          onClick={() => router.push(withProjectIdParam("/app/accounts", projectId))}
                          style={remedialShellBtn}
                        >
                          Рекламные аккаунты
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {showPendingBlocksPayment ? (
            <div style={widePanel ? shellSectionDividerWide : shellSectionDivider}>
              <div
                style={{
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
            </div>
          ) : null}

          {showSubscribeInline ? (
            <div style={shellSectionDividerWide}>
              <BillingInlinePricingSuspended
                projectId={projectId}
                disabled={false}
                showComparisonLink
                subscribeShellMinimal
              />
            </div>
          ) : null}

          {showOverLimitInline ? (
            <div style={shellSectionDividerWide}>
              <BillingInlinePricingSuspended
                projectId={projectId}
                disabled={false}
                suggestPlan={upgradeSuggest}
                showComparisonLink
                variant="over_limit"
                suppressOverLimitShellDupes
              />
            </div>
          ) : null}

          <div
            style={{
              ...(widePanel ? shellSectionDividerWide : shellSectionDivider),
              display: "flex",
              flexWrap: "wrap",
              gap: widePanel ? 12 : 10,
              marginBottom: 0,
              justifyContent: isOverLimitScreen || showSubscribeInline ? "center" : "flex-start",
              alignItems: "center",
            }}
          >
            {simplifyOverLimitFooter ? (
              <>
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
                <button
                  type="button"
                  disabled={shellFooterNavPending !== null}
                  onClick={() => {
                    setShellFooterNavPending("later");
                    router.push(withProjectIdParam("/app/settings", projectId));
                  }}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.22)",
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.92)",
                    fontWeight: 700,
                    cursor: shellFooterNavPending !== null ? "not-allowed" : "pointer",
                    opacity: shellFooterNavPending !== null && shellFooterNavPending !== "later" ? 0.5 : 1,
                  }}
                >
                  {shellFooterNavPending === "later" ? "Подождите..." : "Позже"}
                </button>
                {billingActionAllowed(resolvedUi, ActionId.support) ? (
                  <Link
                    href={withProjectIdParam("/app/support", projectId)}
                    aria-disabled={shellFooterNavPending !== null}
                    onClick={(e) => {
                      if (shellFooterNavPending !== null) {
                        e.preventDefault();
                        return;
                      }
                      setShellFooterNavPending("support");
                    }}
                    className={`self-center text-xs underline underline-offset-2 transition-colors ${
                      shellFooterNavPending !== null
                        ? "pointer-events-none text-white/30"
                        : "text-white/45 hover:text-white/75"
                    }`}
                  >
                    {shellFooterNavPending === "support" ? "Подождите..." : "Поддержка"}
                  </Link>
                ) : null}
                {billingActionAllowed(resolvedUi, ActionId.sign_out) ? (
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,100,100,0.28)",
                      background: "transparent",
                      color: "rgba(255,200,200,0.75)",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Выйти
                  </button>
                ) : null}
              </>
            ) : (
              <>
                {resolvedUi.cta === CtaKey.upgrade &&
                  billingActionAllowed(resolvedUi, ActionId.billing_manage) &&
                  !showOverLimitInline && (
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
                {billingActionAllowed(resolvedUi, ActionId.navigate_settings) && !showSubscribeInline && (
                  <button
                    type="button"
                    onClick={goSettings}
                    style={{
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "transparent",
                      color: "white",
                      ...(isOverLimitScreen ? overLimitFooterPairedBtn : { padding: "10px 16px", borderRadius: 12, fontWeight: 600, cursor: "pointer" }),
                    }}
                  >
                    Настройки
                  </button>
                )}
                {billingActionAllowed(resolvedUi, ActionId.support) && (
                  <button
                    type="button"
                    disabled={shellFooterNavPending !== null}
                    onClick={() => {
                      setShellFooterNavPending("support");
                      router.push(withProjectIdParam("/app/support", projectId));
                    }}
                    style={{
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(255,255,255,0.06)",
                      color: "white",
                      ...(isOverLimitScreen ? overLimitFooterPairedBtn : { padding: "10px 16px", borderRadius: 12, fontWeight: 600, cursor: "pointer" }),
                      cursor: shellFooterNavPending !== null ? "not-allowed" : "pointer",
                      opacity: shellFooterNavPending !== null && shellFooterNavPending !== "support" ? 0.5 : 1,
                    }}
                  >
                    {shellFooterNavPending === "support" ? "Подождите..." : "Поддержка"}
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
              </>
            )}
          </div>
          {process.env.NODE_ENV === "development" && resolvedUi.request_id ? (
            <div
              style={{
                marginTop: widePanel ? 20 : 16,
                fontSize: 11,
                opacity: 0.45,
                color: "white",
                textAlign: isOverLimitScreen || showSubscribeInline ? "center" : undefined,
              }}
            >
              request_id: {resolvedUi.request_id}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function BillingShellGateSearchParamsBridge({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() || null;
  return <BillingShellGateInner projectId={projectId}>{children}</BillingShellGateInner>;
}

export function BillingShellGate({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<BillingShellGateInner projectId={null}>{children}</BillingShellGateInner>}>
      <BillingShellGateSearchParamsBridge>{children}</BillingShellGateSearchParamsBridge>
    </Suspense>
  );
}
