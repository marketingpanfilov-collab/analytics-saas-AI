/**
 * Phase 2 — widget-level data states derived from resolved_ui_state + plan_feature_matrix (no access_state branching).
 */
import type { PlanFeatureMatrix } from "@/app/lib/planConfig";
import { ReasonCode, ScreenId, type ResolvedUiStateV1 } from "@/app/lib/billingUiContract";

export type BillingWidgetState = "EMPTY" | "LIMITED" | "BLOCKED";

export type BillingWidgetStatePack = {
  state: BillingWidgetState;
  reasonCode: string;
  title: string;
  hint: string;
};

const REASON_LABELS: Partial<Record<ReasonCode, { title: string; hint: string }>> = {
  [ReasonCode.BOOTSTRAP_UNAVAILABLE]: {
    title: "Статус подписки не подтверждён",
    hint: "Повторите загрузку. Данные могут быть неполными до восстановления связи.",
  },
  [ReasonCode.BILLING_UNPAID]: {
    title: "Подписка не оплачена",
    hint: "Просмотр ограничен. Оформите оплату в настройках биллинга.",
  },
  [ReasonCode.BILLING_EXPIRED]: {
    title: "Подписка истекла",
    hint: "Продлите подписку, чтобы снова получить полный доступ к данным.",
  },
  [ReasonCode.BILLING_REFUNDED]: {
    title: "Доступ приостановлен",
    hint: "По подписке оформлен возврат. Обратитесь в поддержку или оформите новый тариф.",
  },
  [ReasonCode.BILLING_NO_SUBSCRIPTION]: {
    title: "Нужна подписка",
    hint: "Оформите тариф, чтобы видеть аналитику.",
  },
  [ReasonCode.PLAN_CHANGE_PENDING]: {
    title: "Обновляем тариф",
    hint: "После оплаты лимиты могут временно не совпадать с фактическим тарифом.",
  },
  [ReasonCode.BILLING_PAST_DUE]: {
    title: "Просрочен платёж",
    hint: "Синхронизация и тяжёлые операции могут быть ограничены до оплаты счёта.",
  },
  [ReasonCode.BILLING_GRACE]: {
    title: "Период отсрочки",
    hint: "Данные доступны в ограниченном режиме; погасите задолженность, чтобы избежать блокировки.",
  },
};

function pack(
  state: BillingWidgetState,
  reasonCode: string,
  title: string,
  hint: string
): BillingWidgetStatePack {
  return { state, reasonCode, title, hint };
}

/**
 * Dashboard / generic analytics chrome: uses resolver `data_state_default` when set, else maps reason.
 */
export function resolveDashboardWidgetState(resolved: ResolvedUiStateV1 | null): BillingWidgetStatePack {
  if (!resolved) {
    return pack("BLOCKED", "NO_RESOLVED", "Загрузка доступа", "Ожидайте инициализации сессии.");
  }
  if (resolved.screen === ScreenId.READ_ONLY_SHELL && resolved.blocking_level === "soft") {
    const lab = REASON_LABELS[resolved.reason as ReasonCode];
    return pack(
      "BLOCKED",
      resolved.reason,
      lab?.title ?? "Только просмотр",
      lab?.hint ?? "Подписка на паузе или не оплачена — тяжёлые действия отключены."
    );
  }
  if (resolved.reason === ReasonCode.BILLING_PAST_DUE || resolved.reason === ReasonCode.BILLING_GRACE) {
    const lab = REASON_LABELS[resolved.reason]!;
    return pack("LIMITED", resolved.reason, lab.title, lab.hint);
  }
  if (resolved.reason === ReasonCode.PLAN_CHANGE_PENDING) {
    const lab = REASON_LABELS[ReasonCode.PLAN_CHANGE_PENDING]!;
    return pack("LIMITED", resolved.reason, lab.title, lab.hint);
  }
  const ds = resolved.data_state_default;
  if (ds === "BLOCKED") {
    const lab = REASON_LABELS[resolved.reason as ReasonCode];
    return pack(
      "BLOCKED",
      resolved.reason,
      lab?.title ?? "Доступ ограничен",
      lab?.hint ?? "Текущий режим не позволяет показать полные данные."
    );
  }
  if (ds === "LIMITED") {
    const lab = REASON_LABELS[resolved.reason as ReasonCode];
    return pack(
      "LIMITED",
      resolved.reason,
      lab?.title ?? "Ограниченный режим",
      lab?.hint ?? "Часть метрик может быть скрыта до восстановления подписки."
    );
  }
  if (
    resolved.blocking_level === "hard" &&
    (resolved.screen === ScreenId.PAYWALL ||
      resolved.screen === ScreenId.BILLING_REFUNDED ||
      resolved.screen === ScreenId.NO_ORG_ACCESS ||
      resolved.reason === ReasonCode.BOOTSTRAP_UNAVAILABLE)
  ) {
    const lab = REASON_LABELS[resolved.reason as ReasonCode];
    return pack(
      "BLOCKED",
      resolved.reason,
      lab?.title ?? "Доступ ограничен",
      lab?.hint ?? "Недостаточно прав для просмотра данных."
    );
  }
  if (resolved.reason === ReasonCode.BOOTSTRAP_UNAVAILABLE) {
    const lab = REASON_LABELS[ReasonCode.BOOTSTRAP_UNAVAILABLE]!;
    return pack("BLOCKED", resolved.reason, lab.title, lab.hint);
  }
  return pack("EMPTY", resolved.reason, "", "");
}

export function resolveLtvWidgetState(
  resolved: ResolvedUiStateV1 | null,
  matrix: PlanFeatureMatrix | undefined
): BillingWidgetStatePack {
  const base = resolveDashboardWidgetState(resolved);
  if (base.state === "BLOCKED") return base;
  if (!matrix?.ltv_full_history) {
    return pack(
      "LIMITED",
      "PLAN_LIMIT_LTV_HISTORY",
      "LTV на тарифе Starter",
      "Полная история когорт и расширенные окна доступны на Growth и выше. Отображается урезанный срез."
    );
  }
  return base;
}

export function resolveReportsWidgetState(
  resolved: ResolvedUiStateV1 | null,
  matrix: PlanFeatureMatrix | undefined
): BillingWidgetStatePack {
  const base = resolveDashboardWidgetState(resolved);
  if (base.state === "BLOCKED") return base;
  if (matrix && matrix.marketing_summary === false) {
    return pack(
      "BLOCKED",
      "PLAN_LIMIT_MARKETING_SUMMARY",
      "Отчёт недоступен на текущем плане",
      "Marketing Summary включён в платные тарифы. Обновите подписку или дождитесь активации тарифа."
    );
  }
  return base;
}
