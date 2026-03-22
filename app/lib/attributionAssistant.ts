/**
 * Attribution Debugger v7: Attribution AI Assistant
 * Rule-based explanation engine (no LLM). Builds summary, diagnoses, priority actions
 * from anomalies, data quality issues, and recommendations.
 */

import type { AttributionAnomaly } from "./attributionAnomalies";
import type { DataQualityResult, DataQualityIssue } from "./dataQualityScore";

export type DiagnosisConfidence = "high" | "medium" | "low";

export type AttributionDiagnosis = {
  code: string;
  title: string;
  confidence: DiagnosisConfidence;
  why_this_happened: string;
  impact: string;
  priority: number;
  related_issue_codes?: string[];
  related_anomaly_codes?: string[];
};

export type AttributionAssistantResponse = {
  summary: string;
  diagnoses: AttributionDiagnosis[];
  priority_actions: string[];
};

export type AttributionAssistantInput = {
  anomalies: AttributionAnomaly[];
  dataQuality: DataQualityResult | null;
};

function hasAnomaly(anomalies: AttributionAnomaly[], type: string): boolean {
  return anomalies.some((a) => a.type === type);
}

function hasIssue(dataQuality: DataQualityResult | null, code: string): boolean {
  if (!dataQuality?.issues?.length) return false;
  return dataQuality.issues.some((i) => i.code === code);
}

function getIssue(dataQuality: DataQualityResult | null, code: string): DataQualityIssue | undefined {
  return dataQuality?.issues?.find((i) => i.code === code);
}

function highIssue(dataQuality: DataQualityResult | null, code: string): boolean {
  const i = getIssue(dataQuality, code);
  return !!(i && (i.severity === "high" || i.percent >= 25));
}

/** A. Missing click_id on conversions */
function ruleMissingClickIdOnConversions(input: AttributionAssistantInput): AttributionDiagnosis | null {
  const { anomalies, dataQuality } = input;
  const anomaly = hasAnomaly(anomalies, "missing_click_id_conversions");
  const issue = hasIssue(dataQuality, "conversions_without_click_id");
  if (!anomaly && !issue) return null;
  const confidence: DiagnosisConfidence = anomaly && issue ? "high" : anomaly || highIssue(dataQuality, "conversions_without_click_id") ? "high" : "medium";
  return {
    code: "missing_click_id_on_conversions",
    title: "Обнаружено отсутствие click_id",
    confidence,
    why_this_happened:
      "События регистрации и покупки поступают без click_id. Это означает, что идентификатор клика теряется между визитом и конверсией.",
    impact: "ROAS и атрибуция рекламных каналов могут быть занижены.",
    priority: 1,
    related_issue_codes: issue ? ["conversions_without_click_id"] : undefined,
    related_anomaly_codes: anomaly ? ["missing_click_id_conversions"] : undefined,
  };
}

/** B. Lost attribution on visits (referrer from paid/social but no click_id/UTM) */
function ruleLostAttributionOnVisits(input: AttributionAssistantInput): AttributionDiagnosis | null {
  const { anomalies, dataQuality } = input;
  const issue = hasIssue(dataQuality, "visits_with_lost_attribution");
  const anomalyClickVisit = hasAnomaly(anomalies, "click_to_visit_drop");
  if (!issue && !anomalyClickVisit) return null;
  const confidence: DiagnosisConfidence = issue && anomalyClickVisit ? "high" : "medium";
  return {
    code: "lost_attribution_on_visits",
    title: "Обнаружены визиты, где атрибуция могла быть потеряна",
    confidence,
    why_this_happened:
      "Переходы с рекламных/социальных источников (Facebook, Google, TikTok, Yandex) приходят без click_id и UTM — метки теряются при переходе.",
    impact: "Часть визитов с платного трафика не атрибутируется.",
    priority: 2,
    related_issue_codes: issue ? ["visits_with_lost_attribution"] : undefined,
    related_anomaly_codes: anomalyClickVisit ? ["click_to_visit_drop"] : undefined,
  };
}

/** C. Pixel / landing tracking issue */
function rulePixelLandingIssue(input: AttributionAssistantInput): AttributionDiagnosis | null {
  if (!hasAnomaly(input.anomalies, "click_to_visit_drop")) return null;
  return {
    code: "pixel_landing_issue",
    title: "Возможны проблемы с отслеживанием на лендингах",
    confidence: "high",
    why_this_happened: "Клики записываются, но визиты резко упали. Пиксель может не загружаться или приём визитов может быть нарушен.",
    impact: "Клики не превращаются в визиты в аналитике.",
    priority: 1,
    related_anomaly_codes: ["click_to_visit_drop"],
  };
}

/** D. Conversion payload incomplete */
function ruleConversionPayloadIncomplete(input: AttributionAssistantInput): AttributionDiagnosis | null {
  const { anomalies, dataQuality } = input;
  const anomaly = hasAnomaly(anomalies, "missing_purchase_value");
  const hasValue = hasIssue(dataQuality, "purchases_without_value");
  const hasCurrency = hasIssue(dataQuality, "purchases_without_currency");
  const hasExtId = hasIssue(dataQuality, "purchases_without_external_event_id");
  if (!anomaly && !hasValue && !hasCurrency && !hasExtId) return null;
  const confidence: DiagnosisConfidence = (anomaly || highIssue(dataQuality, "purchases_without_value") || highIssue(dataQuality, "purchases_without_currency")) ? "high" : "medium";
  return {
    code: "conversion_payload_incomplete",
    title: "У некоторых покупок отсутствует сумма",
    confidence,
    why_this_happened: "В событиях покупки отсутствуют сумма, валюта или external_event_id.",
    impact: "ROAS и учёт выручки ненадёжны.",
    priority: 2,
    related_issue_codes: [hasValue && "purchases_without_value", hasCurrency && "purchases_without_currency", hasExtId && "purchases_without_external_event_id"].filter(Boolean) as string[],
    related_anomaly_codes: anomaly ? ["missing_purchase_value"] : undefined,
  };
}

/** E. Missing user identity */
function ruleMissingUserIdentity(input: AttributionAssistantInput): AttributionDiagnosis | null {
  const { dataQuality } = input;
  const reg = hasIssue(dataQuality, "registrations_without_user_external_id");
  const purch = hasIssue(dataQuality, "purchases_without_user_external_id");
  if (!reg && !purch) return null;
  return {
    code: "missing_user_identity",
    title: "Идентификатор пользователя передаётся не везде",
    confidence: reg && purch ? "high" : "medium",
    why_this_happened: "В регистрациях или покупках отсутствует user_external_id.",
    impact: "Путь пользователя неполный; сложнее связать регистрации и покупки.",
    priority: 3,
    related_issue_codes: [reg && "registrations_without_user_external_id", purch && "purchases_without_user_external_id"].filter(Boolean) as string[],
  };
}

/** F. Source disappearance */
function ruleSourceDisappearance(input: AttributionAssistantInput): AttributionDiagnosis | null {
  if (!hasAnomaly(input.anomalies, "traffic_source_disappearance")) return null;
  return {
    code: "source_disappearance",
    title: "Источник трафика неожиданно исчез",
    confidence: "high",
    why_this_happened: "Крупный источник трафика был в базовом периоде, но почти отсутствует в текущем окне.",
    impact: "Один рекламный канал перестал атрибутироваться.",
    priority: 2,
    related_anomaly_codes: ["traffic_source_disappearance"],
  };
}

/** G. Weak matching */
function ruleWeakMatching(input: AttributionAssistantInput): AttributionDiagnosis | null {
  if (!hasAnomaly(input.anomalies, "match_quality_degradation")) return null;
  const hasClickIdIssue = hasIssue(input.dataQuality, "conversions_without_click_id");
  return {
    code: "weak_matching",
    title: "Атрибуция трафика может быть неточной",
    confidence: hasClickIdIssue ? "high" : "medium",
    why_this_happened: "Многие конверсии связаны только по user_external_id или visitor_id, а не по click_id.",
    impact: "Данные менее надёжны; выше вероятность ошибок атрибуции.",
    priority: 2,
    related_anomaly_codes: ["match_quality_degradation"],
    related_issue_codes: hasClickIdIssue ? ["conversions_without_click_id"] : undefined,
  };
}

/** H. Orphan purchases spike */
function ruleOrphanPurchasesSpike(input: AttributionAssistantInput): AttributionDiagnosis | null {
  const { anomalies, dataQuality } = input;
  const orphanSpike = hasAnomaly(anomalies, "orphan_spike");
  const missingClickId = hasAnomaly(anomalies, "missing_click_id_conversions");
  const convIssue = hasIssue(dataQuality, "conversions_without_click_id");
  if (!orphanSpike && !(missingClickId && (convIssue || hasIssue(dataQuality, "purchases_without_user_external_id")))) return null;
  return {
    code: "orphan_purchases_spike",
    title: "Покупки без пути атрибуции",
    confidence: orphanSpike && missingClickId ? "high" : "medium",
    why_this_happened: "Покупки не связаны с кликами или визитами. Это может происходить, если click_id или user_external_id не передаются в события покупки.",
    impact: "Выручка фиксируется, но не может быть корректно отнесена к рекламному каналу.",
    priority: 2,
    related_anomaly_codes: [...(orphanSpike ? ["orphan_spike"] : []), ...(missingClickId ? ["missing_click_id_conversions"] : [])],
    related_issue_codes: convIssue ? ["conversions_without_click_id"] : undefined,
  };
}

const RULES: Array<(input: AttributionAssistantInput) => AttributionDiagnosis | null> = [
  ruleMissingClickIdOnConversions,
  rulePixelLandingIssue,
  ruleLostAttributionOnVisits,
  ruleConversionPayloadIncomplete,
  ruleMissingUserIdentity,
  ruleSourceDisappearance,
  ruleWeakMatching,
  ruleOrphanPurchasesSpike,
];

/** Dedupe and sort by priority; merge same-root diagnoses (e.g. missing_click_id + weak_matching) into one if they share root cause. */
function dedupeDiagnoses(diagnoses: AttributionDiagnosis[]): AttributionDiagnosis[] {
  const byCode = new Map<string, AttributionDiagnosis>();
  for (const d of diagnoses) {
    const existing = byCode.get(d.code);
    if (!existing || (d.confidence === "high" && existing.confidence !== "high")) byCode.set(d.code, d);
  }
  return Array.from(byCode.values()).sort((a, b) => a.priority - b.priority);
}

export function buildAttributionDiagnoses(input: AttributionAssistantInput): AttributionDiagnosis[] {
  const list: AttributionDiagnosis[] = [];
  for (const rule of RULES) {
    const d = rule(input);
    if (d) list.push(d);
  }
  const deduped = dedupeDiagnoses(list);
  for (let i = 0; i < deduped.length; i++) deduped[i].priority = i + 1;
  return deduped;
}

const ACTION_PHRASES: Record<string, string> = {
  missing_click_id_on_conversions: "Проверьте, что click_id (bqcid) передаётся в события регистрации и покупки.",
  lost_attribution_on_visits: "Проверьте передачу UTM и click_id с landing URL в pixel/source-запросах.",
  missing_traffic_source_on_visits: "Убедитесь, что в рекламных кабинетах используются tracking-ссылки.",
  pixel_landing_issue: "Проверьте корректность установки пикселя на лендингах.",
  conversion_payload_incomplete: "Добавьте сумму и валюту в события покупки.",
  missing_user_identity: "Передавайте user_external_id в регистрациях и покупках.",
  source_disappearance: "Проверьте параметры и redirect для пропавшего источника.",
  weak_matching: "Используйте click_id и visit_id как основные ключи связывания конверсий.",
  orphan_purchases_spike: "Убедитесь, что в покупках передаются click_id и user_external_id, redirect сохраняет bqcid.",
};

export function buildPriorityActions(diagnoses: AttributionDiagnosis[], _input: AttributionAssistantInput): string[] {
  const seen = new Set<string>();
  const actions: string[] = [];
  for (const d of diagnoses) {
    const phrase = ACTION_PHRASES[d.code];
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      actions.push(phrase);
    }
  }
  return actions.slice(0, 5);
}

export function buildAttributionAssistantSummary(input: AttributionAssistantInput, diagnoses: AttributionDiagnosis[]): string {
  if (diagnoses.length === 0) {
    if (!input.dataQuality?.has_data) return "Недостаточно данных для анализа атрибуции.";
    const label = input.dataQuality?.label ?? "";
    if (label === "Excellent" || label === "Good")
      return "Атрибуция и качество данных в порядке за этот период. Часть визитов является прямыми переходами — это нормальное поведение пользователей.";
    return "Ознакомьтесь с проблемами данных и рекомендациями ниже, чтобы улучшить атрибуцию.";
  }
  const top = diagnoses[0];
  if (top.code === "missing_click_id_on_conversions" || top.code === "orphan_purchases_spike")
    return "Качество атрибуции снизилось: многие конверсии приходят без click_id.";
  if (top.code === "pixel_landing_issue")
    return "Возможны проблемы с отслеживанием на лендингах: клики не превращаются в визиты.";
  if (top.code === "conversion_payload_incomplete")
    return "События покупки приходят, но у многих нет суммы и валюты.";
  if (top.code === "lost_attribution_on_visits")
    return "Обнаружены визиты, где атрибуция могла быть потеряна.";
  if (top.code === "missing_traffic_source_on_visits")
    return "Визиты не связываются с источником трафика стабильно.";
  if (top.code === "weak_matching")
    return "Атрибуция опирается на слабое связывание; улучшите передачу click_id и visit_id.";
  if (top.code === "source_disappearance")
    return "Крупный источник трафика исчез из недавних данных.";
  if (top.code === "missing_user_identity")
    return "Идентификатор пользователя (user_external_id) отсутствует в части регистраций или покупок.";
  return "Обнаружены проблемы атрибуции. См. выводы и рекомендации ниже.";
}

export function buildAttributionAssistant(input: AttributionAssistantInput): AttributionAssistantResponse {
  const diagnoses = buildAttributionDiagnoses(input);
  const summary = buildAttributionAssistantSummary(input, diagnoses);
  const priority_actions = buildPriorityActions(diagnoses, input);
  return { summary, diagnoses, priority_actions };
}
