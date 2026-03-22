"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { buildChainTimeline, formatDeltaShort, formatTimeToEvent } from "@/app/lib/attributionTimeline";
import { ATTRIBUTION_STATE_LABELS } from "@/app/lib/trafficSourceDetection";

type ChainStatus = "complete" | "partial" | "broken";
type MatchQuality = "high" | "medium" | "low";
type ViewMode = "chains" | "orphans" | "all" | "journeys" | "budget" | "executive" | "assisted";

type AssistedChannel = { traffic_source: string; direct_conversions: number; assisted_conversions: number };
type AssistedConversion = {
  conversion: { id: string; event_name: string; visitor_id: string | null; created_at: string; user_external_id: string | null; value?: number | null; currency?: string | null };
  path: {
    visits: Array<{ traffic_source: string | null; traffic_platform: string | null; created_at: string; role: "first_touch" | "assist" | "last_touch" }>;
    first_touch: { traffic_source: string | null; traffic_platform: string | null } | null;
    last_touch: { traffic_source: string | null; traffic_platform: string | null } | null;
    assists: unknown[];
  };
};

type JourneyItem = {
  journey_id: string;
  project_id: string;
  identity: { user_external_id: string | null; visitor_ids: string[]; click_ids: string[] };
  summary: {
    first_touch_source: string | null;
    first_touch_platform: string | null;
    last_touch_source: string | null;
    last_touch_platform: string | null;
    clicks_count: number;
    visits_count: number;
    registrations_count: number;
    purchases_count: number;
    revenue_total: number;
    first_event_at: string | null;
    last_event_at: string | null;
    clicks_before_registration: number;
    clicks_before_purchase: number;
  };
  touchpoints: Array<{
    type: "click" | "visit" | "registration" | "purchase";
    source: string | null;
    platform: string | null;
    timestamp: string;
    click_id: string | null;
    visit_id: string | null;
    user_external_id: string | null;
    value: number | null;
    currency: string | null;
    external_event_id: string | null;
  }>;
  chains: unknown[];
  journey_health_score: number;
  journey_health_label: string;
  journey_insights: string[];
  attribution_models?: {
    first_touch: Record<string, number>;
    last_touch: Record<string, number>;
    linear: Record<string, number>;
    position_based: Record<string, number>;
    data_driven: Record<string, number>;
  };
};

type ChainItem = {
  chain_id: string;
  project_id: string;
  status: ChainStatus;
  click: { exists: true; bq_click_id: string; traffic_source: string | null; traffic_platform: string | null; utm_source: string | null; utm_campaign: string | null; utm_medium: string | null; created_at: string } | { exists: false };
  visit: { exists: true; visit_id: string | null; click_id: string | null; visitor_id: string; traffic_source: string | null; traffic_platform: string | null; created_at: string } | { exists: false };
  registration: { exists: true; event_id: string; user_external_id: string | null; click_id: string | null; visitor_id: string | null; traffic_source: string | null; created_at: string } | { exists: false };
  purchase: { exists: true; event_id: string; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; click_id: string | null; visitor_id: string | null; traffic_source: string | null; created_at: string } | { exists: false };
  gaps: string[];
  match_quality: MatchQuality;
  explanation: string;
  last_event_at: string;
  summary?: {
    visits_count: number;
    registrations_count: number;
    purchases_count: number;
    revenue_total: number;
    repeat_purchases_count?: number;
  };
  /** One-to-many: all visits linked by click_id (API shape) */
  visits?: Array<{ visit_id: string | null; click_id: string | null; visitor_id: string; traffic_source: string | null; traffic_platform: string | null; created_at: string }>;
  registrations?: Array<{ event_id: string; user_external_id: string | null; click_id: string | null; visitor_id: string | null; traffic_source: string | null; created_at: string }>;
  purchases?: Array<{ event_id: string; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; click_id: string | null; visitor_id: string | null; traffic_source: string | null; created_at: string }>;
  suggested_fixes?: Array<{ severity: string; type: string; title: string; description: string; suggested_action: string; impact: string }>;
};

type OrphanItem =
  | {
      type: "orphan_visit";
      status: string;
      visit_id: string | null;
      click_id: string | null;
      visitor_id: string;
      traffic_source: string | null;
      traffic_platform: string | null;
      created_at: string;
      reason: string;
    }
  | {
      type: "unmatched_registration";
      status: string;
      event_id: string;
      click_id: string | null;
      visitor_id: string | null;
      user_external_id: string | null;
      traffic_source: string | null;
      created_at: string;
      reason: string;
    }
  | {
      type: "unmatched_purchase";
      status: string;
      event_id: string;
      click_id: string | null;
      visitor_id: string | null;
      user_external_id: string | null;
      external_event_id: string | null;
      value: number | null;
      currency: string | null;
      traffic_source: string | null;
      created_at: string;
      reason: string;
    };

const statusColors: Record<ChainStatus, { bg: string; text: string }> = {
  complete: { bg: "rgba(34,197,94,0.18)", text: "rgb(134,239,172)" },
  partial: { bg: "rgba(234,179,8,0.18)", text: "rgb(253,224,71)" },
  broken: { bg: "rgba(239,68,68,0.18)", text: "rgb(252,165,165)" },
};

const qualityColors: Record<MatchQuality, { bg: string; text: string }> = {
  high: { bg: "rgba(34,197,94,0.15)", text: "rgb(134,239,172)" },
  medium: { bg: "rgba(234,179,8,0.15)", text: "rgb(253,224,71)" },
  low: { bg: "rgba(239,68,68,0.15)", text: "rgb(252,165,165)" },
};

const orphanTypeColors: Record<string, { bg: string; text: string }> = {
  orphan_visit: { bg: "rgba(234,179,8,0.2)", text: "rgb(253,224,71)" },
  unmatched_registration: { bg: "rgba(249,115,22,0.2)", text: "rgb(251,146,60)" },
  unmatched_purchase: { bg: "rgba(239,68,68,0.2)", text: "rgb(252,165,165)" },
};

type AttributionAnomaly = {
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  current_value: number | null;
  baseline_value: number | null;
  change: number | null;
  detected_at: string;
  suggested_action?: string;
};

const anomalySeverityColors: Record<string, { bg: string; text: string }> = {
  high: { bg: "rgba(239,68,68,0.25)", text: "#fca5a5" },
  medium: { bg: "rgba(249,115,22,0.25)", text: "#fdba74" },
  low: { bg: "rgba(234,179,8,0.25)", text: "#fde047" },
};

type BudgetChannelMetric = {
  channel: string;
  revenue_first_touch: number;
  revenue_last_touch: number;
  revenue_linear: number;
  revenue_position_based: number;
  revenue_data_driven: number;
  purchases_count: number;
  registrations_count: number;
  clicks_count: number;
  visits_count: number;
  spend: number | null;
  roas_first_touch: number | null;
  roas_last_touch: number | null;
  roas_data_driven: number | null;
};
type BudgetInsight = {
  type: string;
  severity: "high" | "medium" | "low";
  channel: string;
  title: string;
  description: string;
  evidence: Record<string, number | string>;
  recommended_action: string;
};
type BudgetPortfolioSummary = {
  top_growth_candidate: string | null;
  top_overvalued_channel: string | null;
  top_underattributed_channel: string | null;
  top_closing_channel: string | null;
  top_first_touch_channel: string | null;
  total_revenue: number;
  has_spend: boolean;
};
type BudgetOptimizationResult = {
  channel_metrics: BudgetChannelMetric[];
  insights: BudgetInsight[];
  portfolio_summary: BudgetPortfolioSummary;
  priority_actions: string[];
};

type AssistantDiagnosis = {
  code: string;
  title: string;
  confidence: "high" | "medium" | "low";
  why_this_happened: string;
  impact: string;
  priority: number;
};

const assistantConfidenceColors: Record<string, { bg: string; text: string }> = {
  high: { bg: "rgba(34,197,94,0.2)", text: "#86efac" },
  medium: { bg: "rgba(234,179,8,0.2)", text: "#fde047" },
  low: { bg: "rgba(148,163,184,0.2)", text: "#94a3b8" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function orphanKey(item: OrphanItem): string {
  if (item.type === "orphan_visit") return `visit-${item.visitor_id}-${item.created_at}`;
  return `${item.type}-${item.event_id}`;
}

// ——— Локализация (EN → RU), только UI
const chainStatusLabel: Record<ChainStatus, string> = {
  complete: "Полная цепочка",
  partial: "Частичная цепочка",
  broken: "Нарушенная цепочка",
};
const matchQualityLabel: Record<MatchQuality, string> = {
  high: "Высокая точность",
  medium: "Средняя точность",
  low: "Низкая точность",
};
const GAP_LABEL: Record<string, string> = {
  click_without_visit: "Есть клик, но отсутствует визит",
  visit_without_registration: "Есть визит, но отсутствует регистрация",
  visits_without_registration: "Есть визиты, но отсутствует регистрация",
  visit_without_traffic_source: "У визита отсутствует источник трафика",
  visit_lost_attribution: "Потеря атрибуции",
  purchase_without_user_external_id: "У покупки отсутствует идентификатор пользователя",
  purchase_without_value: "У покупки отсутствует сумма",
};
function translateGap(code: string): string {
  return GAP_LABEL[code] ?? code;
}
function translateExplanation(en: string): string {
  const map: Record<string, string> = {
    "Registration matched by visitor_id": "Регистрация связана через visitor_id",
    "Purchase matched by user_external_id": "Покупка связана через user_external_id",
    "Matched by click_id": "Связано через click_id",
  };
  return map[en] ?? en;
}
function trafficSourceLabel(source: string | null): string {
  if (!source) return "—";
  const map: Record<string, string> = {
    meta: "Meta Ads",
    google: "Google Ads",
    tiktok: "TikTok Ads",
    yandex: "Яндекс Директ",
    direct: "Прямой переход",
  };
  return map[source.toLowerCase()] ?? source;
}
const stepTypeLabel: Record<string, string> = {
  click: "Клик",
  visit: "Визит",
  registration: "Регистрация",
  purchase: "Покупка",
};
function translateTimelineTitle(title: string): string {
  if (title === "Ad Click") return "Рекламный клик";
  if (title === "Landing Visit") return "Визит на сайт";
  if (title.startsWith("Visit #")) return title.replace("Visit #", "Визит #");
  if (title === "Registration") return "Регистрация";
  if (title === "Purchase") return "Покупка";
  if (title.startsWith("Purchase #")) return title.replace("Purchase #", "Покупка #");
  if (title === "No registration detected") return "Регистрация не обнаружена";
  if (title === "No purchase detected") return "Покупка не обнаружена";
  return title;
}
function translateTimelineDesc(desc: string): string {
  if (desc === "Registration present but no purchase in this chain.") return "В цепочке есть регистрация, но нет покупки.";
  if (desc === "Missing registration event in this chain.") return "В цепочке отсутствует событие регистрации.";
  return desc;
}

function translateAnomalyTitle(title: string): string {
  const map: Record<string, string> = {
    "Conversions missing click_id": "Конверсии без click_id",
    "Click to visit rate dropped": "Снизилась конверсия из клика в визит",
    "Visit to registration rate dropped": "Снизилась конверсия из визита в регистрацию",
    "Registration to purchase rate dropped": "Снизилась конверсия из регистрации в покупку",
    "Sudden spike in orphan visits": "Резкий рост визитов без клика",
    "Orphan visits appeared": "Появились визиты без сопоставленного клика",
    "Purchase events missing revenue data": "В событиях покупки отсутствуют данные о выручке",
    "Attribution match quality dropped": "Снизилось качество связывания атрибуции",
  };
  if (map[title]) return map[title];
  if (title.startsWith("Traffic source ") && title.includes("disappeared")) {
    const m = title.match(/^Traffic source "([^"]+)" disappeared$/);
    return m ? `Источник трафика «${m[1]}» исчез` : title;
  }
  return title;
}

function translateAnomalyDescription(description: string, title: string): string {
  if (title === "Conversions missing click_id") return "Значительная доля событий конверсии не содержит click_id, хотя ранее он присутствовал.";
  if (title.startsWith("Traffic source ") && title.includes("disappeared")) return "Трафик из этого источника был в базовом периоде, в текущем окне почти отсутствует.";
  const map: Record<string, string> = {
    "Click to visit rate dropped": "Доля визитов после клика снизилась по сравнению с базовым периодом.",
    "Visit to registration rate dropped": "Доля регистраций после визита снизилась по сравнению с базовым периодом.",
    "Registration to purchase rate dropped": "Доля покупок после регистрации снизилась по сравнению с базовым периодом.",
    "Sudden spike in orphan visits": "Резко выросло число визитов без сопоставленного рекламного клика.",
    "Orphan visits appeared": "Начали появляться визиты без сопоставленного клика.",
    "Purchase events missing revenue data": "События покупки поступают без суммы или валюты.",
    "Attribution match quality dropped": "Конверсии всё чаще связываются по слабым признакам (user_external_id, visitor_id), а не по click_id.",
  };
  return map[title] ?? description;
}

function translateAnomalySuggestedAction(action: string): string {
  if (action.includes("click_id") && action.toLowerCase().includes("bqcid")) return "Проверьте, что click_id (bqcid) передаётся в события регистрации и покупки.";
  return action;
}

export default function AttributionDebuggerClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [viewMode, setViewMode] = useState<ViewMode>("chains");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [days, setDays] = useState(30);
  const [filterStatus, setFilterStatus] = useState<ChainStatus | "">("");
  const [filterSource, setFilterSource] = useState("");
  const [orphanType, setOrphanType] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [chains, setChains] = useState<ChainItem[]>([]);
  const [orphans, setOrphans] = useState<OrphanItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalOrphans, setTotalOrphans] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<AttributionAnomaly[]>([]);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [assistantSummary, setAssistantSummary] = useState<string>("");
  const [assistantDiagnoses, setAssistantDiagnoses] = useState<AssistantDiagnosis[]>([]);
  const [assistantActions, setAssistantActions] = useState<string[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [journeys, setJourneys] = useState<JourneyItem[]>([]);
  const [journeysTotal, setJourneysTotal] = useState(0);
  const [expandedJourneyId, setExpandedJourneyId] = useState<string | null>(null);
  const [budgetResult, setBudgetResult] = useState<BudgetOptimizationResult | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  type ExecSummaryResult = {
    has_sufficient_data: boolean;
    summary: string;
    key_findings: string[];
    key_risks: string[];
    growth_opportunities: string[];
    priority_actions: string[];
  };
  const [execSummary, setExecSummary] = useState<ExecSummaryResult | null>(null);
  const [execSummaryLoading, setExecSummaryLoading] = useState(false);
  const [assistedChannels, setAssistedChannels] = useState<AssistedChannel[]>([]);
  const [assistedConversions, setAssistedConversions] = useState<AssistedConversion[]>([]);
  const [assistedLoading, setAssistedLoading] = useState(false);
  const [expandedAssistedId, setExpandedAssistedId] = useState<string | null>(null);

  const fetchAnomalies = useCallback(async () => {
    if (!projectId) return;
    setAnomaliesLoading(true);
    try {
      const res = await fetch(`/api/attribution-anomalies?project_id=${encodeURIComponent(projectId)}&window=24h`, { cache: "no-store" });
      const json = await res.json();
      if (json?.success && Array.isArray(json.anomalies)) setAnomalies(json.anomalies);
      else setAnomalies([]);
    } catch {
      setAnomalies([]);
    } finally {
      setAnomaliesLoading(false);
    }
  }, [projectId]);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    if (viewMode === "budget" || viewMode === "executive") return;
    setLoading(true);
    try {
      if (viewMode === "assisted") {
        setAssistedLoading(true);
        const params = new URLSearchParams();
        params.set("project_id", projectId);
        params.set("days", String(days));
        if (filterSource) params.set("source", filterSource);
        const res = await fetch(`/api/assisted-attribution?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        setAssistedLoading(false);
        if (!json?.success) {
          setAssistedChannels([]);
          setAssistedConversions([]);
        } else {
          setAssistedChannels(Array.isArray(json.channels) ? json.channels : []);
          setAssistedConversions(Array.isArray(json.conversions) ? json.conversions : []);
        }
        setChains([]);
        setOrphans([]);
        setTotal(0);
        setTotalOrphans(0);
        setLoading(false);
        return;
      }
      if (viewMode === "journeys") {
        const params = new URLSearchParams();
        params.set("project_id", projectId);
        params.set("days", String(days));
        params.set("page", String(page));
        params.set("page_size", String(pageSize));
        if (searchApplied) params.set("search", searchApplied);
        if (filterSource) params.set("filter_source", filterSource);
        const res = await fetch(`/api/attribution-journeys?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!json?.success) {
          setJourneys([]);
          setJourneysTotal(0);
          return;
        }
        setJourneys(Array.isArray(json.journeys) ? json.journeys : []);
        setJourneysTotal(Number(json.total) ?? 0);
        setChains([]);
        setOrphans([]);
        setTotal(0);
        setTotalOrphans(0);
      } else {
        const params = new URLSearchParams();
        params.set("project_id", projectId);
        params.set("days", String(days));
        params.set("page", String(page));
        params.set("page_size", String(pageSize));
        params.set("view_mode", viewMode);
        if (searchApplied) params.set("search", searchApplied);
        if (viewMode === "chains" || viewMode === "all") {
          if (filterStatus) params.set("filter_status", filterStatus);
          if (filterSource) params.set("filter_source", filterSource);
        }
        if ((viewMode === "orphans" || viewMode === "all") && orphanType)
          params.set("orphan_type", orphanType);

        const res = await fetch(`/api/attribution-debugger?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!json?.success) {
          setChains([]);
          setOrphans([]);
          setTotal(0);
          setTotalOrphans(0);
          return;
        }
        setChains(Array.isArray(json.chains) ? json.chains : []);
        setOrphans(Array.isArray(json.orphans) ? json.orphans : []);
        setTotal(Number(json.total) ?? 0);
        setTotalOrphans(Number(json.total_orphans) ?? json.orphans?.length ?? 0);
        setJourneys([]);
        setJourneysTotal(0);
      }
    } catch {
      setChains([]);
      setOrphans([]);
      setTotal(0);
      setTotalOrphans(0);
      setJourneys([]);
      setJourneysTotal(0);
    } finally {
      setLoading(false);
    }
  }, [projectId, days, page, pageSize, viewMode, searchApplied, filterStatus, filterSource, orphanType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchAssistant = useCallback(async () => {
    if (!projectId) return;
    setAssistantLoading(true);
    try {
      const res = await fetch(`/api/attribution-assistant?project_id=${encodeURIComponent(projectId)}&days=${days}`, { cache: "no-store" });
      const json = await res.json();
      if (json?.success) {
        setAssistantSummary(json.summary ?? "");
        setAssistantDiagnoses(Array.isArray(json.diagnoses) ? json.diagnoses : []);
        setAssistantActions(Array.isArray(json.priority_actions) ? json.priority_actions : []);
      } else {
        setAssistantSummary("");
        setAssistantDiagnoses([]);
        setAssistantActions([]);
      }
    } catch {
      setAssistantSummary("");
      setAssistantDiagnoses([]);
      setAssistantActions([]);
    } finally {
      setAssistantLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => {
    fetchAnomalies();
  }, [fetchAnomalies]);

  useEffect(() => {
    fetchAssistant();
  }, [fetchAssistant]);

  useEffect(() => {
    setPage(1);
  }, [days, filterStatus, filterSource, searchApplied, viewMode, orphanType]);

  const fetchBudgetInsights = useCallback(async () => {
    if (!projectId || viewMode !== "budget") return;
    setBudgetLoading(true);
    try {
      const res = await fetch(
        `/api/budget-optimization-insights?project_id=${encodeURIComponent(projectId)}&days=${days}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success) {
        setBudgetResult({
          channel_metrics: json.channel_metrics ?? [],
          insights: json.insights ?? [],
          portfolio_summary: json.portfolio_summary ?? {},
          priority_actions: json.priority_actions ?? [],
        });
      } else {
        setBudgetResult(null);
      }
    } catch {
      setBudgetResult(null);
    } finally {
      setBudgetLoading(false);
    }
  }, [projectId, days, viewMode]);

  useEffect(() => {
    if (viewMode === "budget") fetchBudgetInsights();
    else setBudgetResult(null);
  }, [viewMode, fetchBudgetInsights]);

  const fetchExecSummary = useCallback(async () => {
    if (!projectId || viewMode !== "executive") return;
    setExecSummaryLoading(true);
    try {
      const res = await fetch(
        `/api/executive-summary?project_id=${encodeURIComponent(projectId)}&days=${days}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success) {
        setExecSummary({
          has_sufficient_data: json.has_sufficient_data ?? false,
          summary: json.summary ?? "",
          key_findings: Array.isArray(json.key_findings) ? json.key_findings : [],
          key_risks: Array.isArray(json.key_risks) ? json.key_risks : [],
          growth_opportunities: Array.isArray(json.growth_opportunities) ? json.growth_opportunities : [],
          priority_actions: Array.isArray(json.priority_actions) ? json.priority_actions : [],
        });
      } else {
        setExecSummary(null);
      }
    } catch {
      setExecSummary(null);
    } finally {
      setExecSummaryLoading(false);
    }
  }, [projectId, days, viewMode]);

  useEffect(() => {
    if (viewMode === "executive") fetchExecSummary();
    else setExecSummary(null);
  }, [viewMode, fetchExecSummary]);

  if (!projectId) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/70">Выберите проект.</p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil((viewMode === "journeys" ? journeysTotal : viewMode === "orphans" ? total : total) / pageSize));
  const showChains = viewMode === "chains" || viewMode === "all";
  const showOrphans = viewMode === "orphans" || viewMode === "all";
  const showJourneys = viewMode === "journeys";
  const showBudget = viewMode === "budget";
  const showExecutive = viewMode === "executive";
  const showAssisted = viewMode === "assisted";

  function getChannelLabel(channel: string, insights: BudgetInsight[]): string | null {
    const byChannel = insights.filter((i) => i.channel === channel);
    if (byChannel.some((i) => i.type === "scaling_opportunity")) return "Growth candidate";
    if (byChannel.some((i) => i.type === "over_attributed_channel")) return "Overvalued by last-click";
    if (byChannel.some((i) => i.type === "under_attributed_channel")) return "Under-attributed";
    if (byChannel.some((i) => i.type === "strong_closing_channel")) return "Strong closer";
    if (byChannel.some((i) => i.type === "strong_first_touch_channel")) return "Strong first-touch";
    if (byChannel.some((i) => i.type === "weak_channel")) return "Weak contributor";
    if (byChannel.some((i) => i.type === "budget_waste_signal")) return "Budget waste signal";
    return null;
  }

  return (
    <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-white">Проверка атрибуции</h1>
        <p className="mt-1 text-sm text-white/60">
          Показывает путь пользователя от клика до покупки и помогает выявить проблемы атрибуции.
        </p>
      </header>

      <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <h2 className="mb-1 text-lg font-semibold text-white/90">ИИ-помощник атрибуции</h2>
        <p className="mb-3 text-sm text-white/55">Автоматический анализ качества атрибуции и рекомендации по улучшению данных.</p>
        {assistantLoading ? (
          <p className="text-sm text-white/50">Анализ атрибуции…</p>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-sm font-medium text-white/70 mb-1">Основные выводы</p>
              <p className="text-sm text-white/90">{assistantSummary || "Проблем не обнаружено за выбранный период."}</p>
            </div>
            {assistantDiagnoses.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-white/70 mb-2">Обнаруженные проблемы</p>
                <ul className="space-y-2">
                  {assistantDiagnoses.map((d) => {
                    const confStyle = assistantConfidenceColors[d.confidence] ?? assistantConfidenceColors.low;
                    const confidenceLabel = d.confidence === "high" ? "высокая уверенность" : d.confidence === "medium" ? "средняя уверенность" : "низкая уверенность";
                    return (
                      <li key={d.code} className="flex flex-wrap items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2">
                        <span className="text-white/50 font-mono text-xs">#{d.priority}</span>
                        <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: confStyle.bg, color: confStyle.text }}>{confidenceLabel}</span>
                        <span className="font-medium text-white/90">{d.title}</span>
                        <p className="w-full text-xs text-white/60 mt-0.5">{d.why_this_happened}</p>
                        <p className="w-full text-xs text-white/50">Влияние: {d.impact}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {assistantActions.length > 0 && (
              <div>
                <p className="text-sm font-medium text-white/70 mb-2">Рекомендации</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-white/85">
                  {assistantActions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </section>

      {anomalies.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-white/90">Предупреждения атрибуции</h2>
          <div className="space-y-3">
            {anomalies.map((a, idx) => {
              const style = anomalySeverityColors[a.severity] ?? anomalySeverityColors.low;
              return (
                <div key={`${a.type}-${idx}-${a.title}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: style.bg, color: style.text }}>{a.severity === "high" ? "Высокая" : a.severity === "medium" ? "Средняя" : "Низкая"}</span>
                    <span className="font-semibold text-white/90">{translateAnomalyTitle(a.title)}</span>
                  </div>
                  <p className="text-sm text-white/70 mb-2">{translateAnomalyDescription(a.description, a.title)}</p>
                  {(a.current_value != null || a.baseline_value != null) && (
                    <p className="text-xs text-white/60 mb-1">
                      Текущее значение: {a.current_value != null ? String(a.current_value) : "—"} · Базовое значение: {a.baseline_value != null ? String(a.baseline_value) : "—"}
                      {a.change != null && ` · Изменение: ${a.change}%`}
                    </p>
                  )}
                  {a.suggested_action && (
                    <p className="text-xs text-amber-200/90"><span className="text-white/60">Рекомендуемое действие:</span> {translateAnomalySuggestedAction(a.suggested_action)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {anomaliesLoading && anomalies.length === 0 && (
        <div className="mb-6 text-sm text-white/50">Проверка аномалий…</div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-white/12 bg-white/5 p-1">
          {(["executive", "chains", "orphans", "journeys", "assisted", "all", "budget"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                viewMode === mode ? "bg-white/15 text-white" : "text-white/60 hover:text-white/80"
              }`}
            >
              {mode === "executive" ? "Сводка" : mode === "chains" ? "Цепочки" : mode === "orphans" ? "Без цепочки" : mode === "journeys" ? "Пути" : mode === "assisted" ? "Помогающая атрибуция" : mode === "all" ? "Всё" : "Оптимизация бюджета"}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Поиск: click_id, visit_id, user_external_id, external_event_id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSearchApplied(search)}
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          style={{ minWidth: 280 }}
        />
        <button
          type="button"
          onClick={() => setSearchApplied(search)}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
        >
          Найти
        </button>
        {showChains && (
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus((e.target.value || "") as ChainStatus | "")}
            className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">Все статусы</option>
            <option value="complete">Полная цепочка</option>
            <option value="partial">Частичная цепочка</option>
            <option value="broken">Нарушенная цепочка</option>
          </select>
        )}
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
        >
          <option value="">Все источники</option>
          <option value="meta">Meta Ads</option>
          <option value="google">Google Ads</option>
          <option value="tiktok">TikTok Ads</option>
          <option value="yandex">Яндекс Директ</option>
        </select>
        {showOrphans && (
          <select
            value={orphanType}
            onChange={(e) => setOrphanType(e.target.value)}
            className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">Все типы</option>
            <option value="orphan_visit">Визит без цепочки</option>
            <option value="unmatched_registration">Регистрация без цепочки</option>
            <option value="unmatched_purchase">Покупка без цепочки</option>
          </select>
        )}
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
        >
          <option value={7}>7 дней</option>
          <option value={30}>30 дней</option>
          <option value={90}>90 дней</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-white/50">Загрузка…</div>
      ) : showExecutive ? (
        execSummaryLoading ? (
          <div className="flex items-center justify-center py-16 text-white/50">Загрузка Executive Summary…</div>
        ) : execSummary ? (
          <div className="mx-auto max-w-4xl space-y-8">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-lg">
              <h2 className="mb-4 text-xl font-semibold tracking-tight text-white/95">Executive Summary</h2>
              <p className="leading-relaxed text-white/85">{execSummary.summary}</p>
            </div>
            {execSummary.key_findings.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white/95">
                  <span className="text-emerald-400" aria-hidden>●</span> Key findings
                </h3>
                <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
                  {execSummary.key_findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </section>
            )}
            {execSummary.key_risks.length > 0 && (
              <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-amber-200/95">
                  <span className="text-amber-400" aria-hidden>⚠</span> Key risks
                </h3>
                <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
                  {execSummary.key_risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </section>
            )}
            {execSummary.growth_opportunities.length > 0 && (
              <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-emerald-200/95">
                  <span className="text-emerald-400" aria-hidden>↑</span> Growth opportunities
                </h3>
                <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
                  {execSummary.growth_opportunities.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </section>
            )}
            {execSummary.priority_actions.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white/95">
                  <span className="text-sky-400" aria-hidden>✓</span> Priority actions
                </h3>
                <ol className="list-inside list-decimal space-y-2 text-sm font-medium text-white/90">
                  {execSummary.priority_actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
            <p className="text-white/60">Недостаточно данных для формирования управленческой сводки за выбранный период.</p>
          </div>
        )
      ) : showBudget ? (
        budgetLoading ? (
          <div className="flex items-center justify-center py-16 text-white/50">Загрузка Budget Optimization…</div>
        ) : budgetResult ? (
          <div className="space-y-8">
            {!budgetResult.portfolio_summary.has_spend && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
                Spend data is unavailable; recommendations are based on attribution contribution only.
              </div>
            )}
            <section>
              <h2 className="mb-3 text-lg font-semibold text-white/90">Portfolio summary</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {budgetResult.portfolio_summary.top_growth_candidate && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/50">Growth candidate</div>
                    <div className="font-semibold capitalize text-white">{budgetResult.portfolio_summary.top_growth_candidate}</div>
                  </div>
                )}
                {budgetResult.portfolio_summary.top_overvalued_channel && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/50">Overvalued (last-click)</div>
                    <div className="font-semibold capitalize text-white">{budgetResult.portfolio_summary.top_overvalued_channel}</div>
                  </div>
                )}
                {budgetResult.portfolio_summary.top_underattributed_channel && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/50">Under-attributed</div>
                    <div className="font-semibold capitalize text-white">{budgetResult.portfolio_summary.top_underattributed_channel}</div>
                  </div>
                )}
                {budgetResult.portfolio_summary.top_closing_channel && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/50">Strong closer</div>
                    <div className="font-semibold capitalize text-white">{budgetResult.portfolio_summary.top_closing_channel}</div>
                  </div>
                )}
                {budgetResult.portfolio_summary.top_first_touch_channel && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/50">Strong first-touch</div>
                    <div className="font-semibold capitalize text-white">{budgetResult.portfolio_summary.top_first_touch_channel}</div>
                  </div>
                )}
              </div>
              <p className="mt-2 text-sm text-white/50">Total revenue (data-driven): {budgetResult.portfolio_summary.total_revenue}</p>
            </section>
            <section>
              <h2 className="mb-3 text-lg font-semibold text-white/90">Channel comparison</h2>
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-white/60">
                      <th className="p-3 font-semibold">Channel</th>
                      <th className="p-3 font-semibold">First Touch Rev</th>
                      <th className="p-3 font-semibold">Last Touch Rev</th>
                      <th className="p-3 font-semibold">Linear Rev</th>
                      <th className="p-3 font-semibold">Data-Driven Rev</th>
                      {budgetResult.portfolio_summary.has_spend && <th className="p-3 font-semibold">Spend</th>}
                      {budgetResult.portfolio_summary.has_spend && <th className="p-3 font-semibold">ROAS</th>}
                      <th className="p-3 font-semibold">Insight / status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetResult.channel_metrics.map((m) => {
                      const label = getChannelLabel(m.channel, budgetResult.insights);
                      return (
                        <tr key={m.channel} className="border-b border-white/5 hover:bg-white/[0.03]">
                          <td className="p-3 font-medium capitalize text-white/90">{m.channel}</td>
                          <td className="p-3 text-white/80">{m.revenue_first_touch > 0 ? m.revenue_first_touch.toFixed(2) : "—"}</td>
                          <td className="p-3 text-white/80">{m.revenue_last_touch > 0 ? m.revenue_last_touch.toFixed(2) : "—"}</td>
                          <td className="p-3 text-white/80">{m.revenue_linear > 0 ? m.revenue_linear.toFixed(2) : "—"}</td>
                          <td className="p-3 text-white/80">{m.revenue_data_driven > 0 ? m.revenue_data_driven.toFixed(2) : "—"}</td>
                          {budgetResult.portfolio_summary.has_spend && (
                            <td className="p-3 text-white/80">{m.spend != null ? m.spend.toFixed(2) : "—"}</td>
                          )}
                          {budgetResult.portfolio_summary.has_spend && (
                            <td className="p-3 text-white/80">{m.roas_data_driven != null ? m.roas_data_driven.toFixed(2) : "—"}</td>
                          )}
                          <td className="p-3">
                            {label ? (
                              <span
                                className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  label === "Growth candidate"
                                    ? "bg-emerald-500/20 text-emerald-300"
                                    : label === "Overvalued by last-click"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : label === "Under-attributed"
                                    ? "bg-blue-500/20 text-blue-300"
                                    : label === "Strong closer" || label === "Strong first-touch"
                                    ? "bg-violet-500/20 text-violet-300"
                                    : label === "Weak contributor"
                                    ? "bg-slate-500/20 text-slate-300"
                                    : "bg-red-500/20 text-red-300"
                                }`}
                              >
                                {label}
                              </span>
                            ) : (
                              <span className="text-white/40">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            {budgetResult.insights.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-white/90">Insights</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {budgetResult.insights.map((ins, idx) => (
                    <div
                      key={`${ins.channel}-${ins.type}-${idx}`}
                      className={`rounded-lg border p-4 ${
                        ins.severity === "high"
                          ? "border-amber-500/30 bg-amber-500/5"
                          : ins.severity === "medium"
                          ? "border-white/15 bg-white/5"
                          : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <div className="font-semibold capitalize text-white/95">{ins.title}</div>
                      <p className="mt-1 text-sm text-white/70">{ins.description}</p>
                      {Object.keys(ins.evidence).length > 0 && (
                        <div className="mt-2 text-xs text-white/50">
                          {Object.entries(ins.evidence).map(([k, v]) => (
                            <span key={k} className="mr-3">
                              {k.replace(/_/g, " ")}: {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-sm text-emerald-200/90">{ins.recommended_action}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {budgetResult.priority_actions.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-white/90">Priority actions</h2>
                <ul className="list-inside list-disc space-y-1 text-sm text-white/80">
                  {budgetResult.priority_actions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-white/50">Нет данных по оптимизации бюджета за выбранный период.</div>
        )
      ) : showAssisted ? (
        <div className="space-y-8">
          {assistedLoading ? (
            <div className="flex items-center justify-center py-16 text-white/50">Загрузка помогающей атрибуции…</div>
          ) : (
            <>
              <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <h2 className="mb-3 text-lg font-semibold text-white/90">Помогающая атрибуция</h2>
                <p className="mb-4 text-sm text-white/50">Прямые конверсии — канал последнего касания. Вспомогательные — участие канала в пути до конверсии.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-white/60">
                        <th className="p-3 font-semibold">Источник трафика</th>
                        <th className="p-3 font-semibold">Прямые конверсии</th>
                        <th className="p-3 font-semibold">Вспомогательные конверсии</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assistedChannels.length === 0 ? (
                        <tr><td colSpan={3} className="p-6 text-center text-white/50">Нет данных за выбранный период.</td></tr>
                      ) : (
                        assistedChannels.map((row) => (
                          <tr key={row.traffic_source} className="border-b border-white/5 hover:bg-white/[0.03]">
                            <td className="p-3 font-medium text-white/90">{trafficSourceLabel(row.traffic_source)}</td>
                            <td className="p-3 text-white/80">{row.direct_conversions}</td>
                            <td className="p-3 text-white/80">{row.assisted_conversions}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <h3 className="mb-3 text-base font-semibold text-white/90">Цепочки конверсий</h3>
                <p className="mb-4 text-sm text-white/50">Раскройте строку, чтобы увидеть путь пользователя: first touch → assist → last touch.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-white/60">
                        <th className="w-8 p-3" />
                        <th className="p-3 font-semibold">Событие</th>
                        <th className="p-3 font-semibold">visitor_id</th>
                        <th className="p-3 font-semibold">Дата</th>
                        <th className="p-3 font-semibold">Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assistedConversions.length === 0 ? (
                        <tr><td colSpan={5} className="p-6 text-center text-white/50">Нет конверсий за период.</td></tr>
                      ) : (
                        assistedConversions.map((item) => {
                          const conv = item.conversion;
                          const open = expandedAssistedId === conv.id;
                          return (
                            <React.Fragment key={conv.id}>
                              <tr
                                className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer"
                                onClick={() => setExpandedAssistedId(open ? null : conv.id)}
                              >
                                <td className="p-3 text-white/50">{open ? "▼" : "▶"}</td>
                                <td className="p-3 font-medium text-white/90">{conv.event_name === "purchase" ? "Покупка" : "Регистрация"}</td>
                                <td className="p-3 font-mono text-white/70 truncate max-w-[140px]" title={conv.visitor_id ?? ""}>{conv.visitor_id ?? "—"}</td>
                                <td className="p-3 text-white/70">{new Date(conv.created_at).toLocaleString("ru-RU")}</td>
                                <td className="p-3 text-white/80">{conv.event_name === "purchase" && conv.value != null ? `${conv.value} ${conv.currency ?? ""}` : "—"}</td>
                              </tr>
                              {open && (
                                <tr className="bg-white/[0.02]">
                                  <td colSpan={5} className="p-4">
                                    {item.path.visits.length > 0 ? (
                                      <div className="flex flex-wrap gap-2">
                                        {item.path.visits.map((v, i) => (
                                          <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
                                            <span className="font-medium text-white/90">{trafficSourceLabel(v.traffic_source)}</span>
                                            <span className="text-white/50 text-xs">
                                              {v.role === "first_touch" ? "(первое касание)" : v.role === "last_touch" ? "(последнее касание)" : "(помощь)"}
                                            </span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-white/50">Нет визитов до конверсии в выбранном периоде.</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      ) : (
        <>
          {showChains && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white/90">Цепочки</h2>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                {chains.length === 0 ? (
                  <div className="py-12 text-center text-white/50">Нет цепочек за выбранный период.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-white/60">
                          <th className="w-8 p-3" />
                          <th className="p-3 font-semibold">Статус</th>
                          <th className="p-3 font-semibold">Источник</th>
                          <th className="p-3 font-semibold">ID клика</th>
                          <th className="p-3 font-semibold">Визиты</th>
                          <th className="p-3 font-semibold">Рег.</th>
                          <th className="p-3 font-semibold">Покупки</th>
                          <th className="p-3 font-semibold">Выручка</th>
                          <th className="p-3 font-semibold">Последнее событие</th>
                          <th className="p-3 font-semibold">Качество связи</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chains.map((c) => {
                          const open = expandedId === c.chain_id;
                          const sc = statusColors[c.status];
                          const qc = qualityColors[c.match_quality];
                          const clickId = c.click.exists ? c.click.bq_click_id : "—";
                          const sum = c.summary ?? { visits_count: 0, registrations_count: 0, purchases_count: 0, revenue_total: 0, repeat_purchases_count: 0 };
                          return (
                            <React.Fragment key={c.chain_id}>
                              <tr
                                className="border-b border-white/5 hover:bg-white/[0.03]"
                                onClick={() => setExpandedId(open ? null : c.chain_id)}
                                style={{ cursor: "pointer" }}
                                aria-label={open ? "Скрыть" : "Показать детали"}
                              >
                                <td className="p-3 text-white/50">{open ? "▼" : "▶"}</td>
                                <td className="p-3">
                                  <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: sc.bg, color: sc.text }}>
                                    {chainStatusLabel[c.status]}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-white/80">{trafficSourceLabel(c.click.exists ? c.click.traffic_source : null)}</td>
                                <td className="max-w-[120px] truncate p-3 font-mono text-white/70" title={clickId}>{clickId}</td>
                                <td className="p-3 text-white/80">{sum.visits_count}</td>
                                <td className="p-3 text-white/80">{sum.registrations_count}</td>
                                <td className="p-3 text-white/80">{sum.purchases_count}{(sum.repeat_purchases_count ?? 0) > 0 ? ` (${sum.repeat_purchases_count ?? 0} повт.)` : ""}</td>
                                <td className="p-3 text-white/80">{sum.revenue_total > 0 ? `${sum.revenue_total}` : "—"}</td>
                                <td className="p-3 text-white/60">{fmtTime(c.last_event_at)}</td>
                                <td className="p-3">
                                  <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: qc.bg, color: qc.text }}>
                                    {matchQualityLabel[c.match_quality]}
                                  </span>
                                </td>
                              </tr>
                              {open && (
                                <tr className="border-b border-white/10 bg-white/[0.04]">
                                  <td colSpan={10} className="p-4">
                                    <div className="space-y-4 text-sm">
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-green-400/90">Клик</div>
                                        {c.click.exists ? (
                                          <div className="mt-1 space-y-0.5 font-mono text-xs text-white/80">
                                            <div>bq_click_id: {c.click.bq_click_id}</div>
                                            <div>source: {cell(c.click.traffic_source)} platform: {cell(c.click.traffic_platform)}</div>
                                            <div>{fmtTime(c.click.created_at)}</div>
                                          </div>
                                        ) : (
                                          <div className="mt-1 text-white/50">—</div>
                                        )}
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-blue-400/90">Визиты ({(c.visits ?? []).length})</div>
                                        {(c.visits ?? []).length === 0 ? (
                                          <div className="mt-1 text-white/50">—</div>
                                        ) : (
                                          <ul className="mt-2 space-y-2">
                                            {(c.visits ?? []).map((v, i) => (
                                              <li key={v.visit_id ?? i} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5 font-mono text-xs text-white/80">
                                                visit_id: {cell(v.visit_id)} | visitor_id: {v.visitor_id} | source: {cell(v.traffic_source)} | {fmtTime(v.created_at)}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-amber-400/90">Регистрации ({(c.registrations ?? []).length})</div>
                                        {(c.registrations ?? []).length === 0 ? (
                                          <div className="mt-1 text-white/50">—</div>
                                        ) : (
                                          <ul className="mt-2 space-y-2">
                                            {(c.registrations ?? []).map((r, i) => (
                                              <li key={r.event_id} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5 font-mono text-xs text-white/80">
                                                event_id: {r.event_id} | user_external_id: {cell(r.user_external_id)} | click_id: {cell(r.click_id)} | visitor_id: {cell(r.visitor_id)} | {fmtTime(r.created_at)}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-purple-400/90">Покупки ({(c.purchases ?? []).length})</div>
                                        {(c.purchases ?? []).length === 0 ? (
                                          <div className="mt-1 text-white/50">—</div>
                                        ) : (
                                          <ul className="mt-2 space-y-2">
                                            {(c.purchases ?? []).map((p, i) => (
                                              <li key={p.event_id} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5 font-mono text-xs text-white/80">
                                                event_id: {p.event_id} | external_event_id: {cell(p.external_event_id)} | user_external_id: {cell(p.user_external_id)} | value: {cell(p.value)} {cell(p.currency)} | click_id: {cell(p.click_id)} | visitor_id: {cell(p.visitor_id)} | {fmtTime(p.created_at)}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-white/80 mb-2">Воспроизведение цепочки</div>
                                        {(() => {
                                          try {
                                            const { events, summary } = buildChainTimeline(c as unknown as import("@/app/lib/attributionDebugger").ChainItem);
                                            const typeColors: Record<string, { dot: string; border: string }> = {
                                              click: { dot: "bg-indigo-500", border: "border-indigo-500/50" },
                                              visit: { dot: "bg-cyan-500", border: "border-cyan-500/50" },
                                              registration: { dot: "bg-amber-500", border: "border-amber-500/50" },
                                              purchase: { dot: "bg-emerald-500", border: "border-emerald-500/50" },
                                              gap: { dot: "bg-white/30", border: "border-amber-500/30" },
                                            };
                                            return (
                                              <>
                                                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                                                  <span>Всего событий: {summary.total_events}</span>
                                                  {summary.first_click_at && <span>Первый клик: {fmtTime(summary.first_click_at)}</span>}
                                                  {summary.last_event_at && <span>Последнее событие: {fmtTime(summary.last_event_at)}</span>}
                                                  {summary.time_to_registration_ms != null ? (
                                                    <span>Время до регистрации: {formatTimeToEvent(summary.time_to_registration_ms)}</span>
                                                  ) : (
                                                    (c as { visits?: unknown[] }).visits?.length ? <span>Время до регистрации: —</span> : null
                                                  )}
                                                  {summary.time_to_purchase_ms != null ? (
                                                    <span>Время до покупки: {formatTimeToEvent(summary.time_to_purchase_ms)}</span>
                                                  ) : (
                                                    (c as { registrations?: unknown[] }).registrations?.length ? <span>Время до покупки: Не достигнуто</span> : null
                                                  )}
                                                  {summary.repeat_purchases_count > 0 && <span>Повторные покупки: {summary.repeat_purchases_count}</span>}
                                                </div>
                                                <div className="relative max-h-[320px] overflow-y-auto">
                                                  <div className="absolute left-[11px] top-0 bottom-0 w-px bg-white/15" />
                                                  <ul className="space-y-0">
                                                    {events.map((ev, i) => {
                                                      const style = typeColors[ev.event_type] ?? typeColors.gap;
                                                      const isWarning = ev.status === "warning" || ev.status === "error";
                                                      return (
                                                        <li key={ev.id} className="relative flex gap-3 pl-0 pb-2 last:pb-0">
                                                          <div className={`relative z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full ${style.dot} ${isWarning ? "ring-2 ring-amber-400/60" : ""}`} />
                                                          <div className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${style.border} ${isWarning ? "bg-amber-500/5 border-amber-500/40" : "bg-white/[0.03] border-white/10"}`}>
                                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                              {i > 0 && ev.delta_from_previous_ms != null && (
                                                                <span className="text-white/45 font-mono">{formatDeltaShort(ev.delta_from_previous_ms)}</span>
                                                              )}
                                                              <span className="font-medium text-white/90">{translateTimelineTitle(ev.title)}</span>
                                                              {ev.event_subtype === "repeat" && <span className="text-white/50">(повтор)</span>}
                                                            </div>
                                                            <p className="mt-0.5 text-white/70">{translateTimelineDesc(ev.description)}</p>
                                                            {ev.event_type === "visit" && (ev.source || (ev as { source_type?: string }).source_type) ? (
                                                              <p className="mt-0.5 text-white/60">
                                                                {ev.source ? trafficSourceLabel(ev.source) : ATTRIBUTION_STATE_LABELS[(ev as { source_type: keyof typeof ATTRIBUTION_STATE_LABELS }).source_type]}
                                                              </p>
                                                            ) : null}
                                                            <p className="mt-0.5 text-white/50">{fmtTime(ev.timestamp)}</p>
                                                            {ev.event_type === "click" && ev.metadata?.bq_click_id ? (
                                                              <p className="mt-0.5 font-mono text-white/50 truncate">id: {String(ev.metadata.bq_click_id)}</p>
                                                            ) : null}
                                                            {ev.event_type === "visit" && (ev.metadata?.visit_id || ev.metadata?.visitor_id) ? (
                                                              <p className="mt-0.5 font-mono text-white/50 truncate">visit_id: {cell(ev.metadata.visit_id as string | null)} visitor_id: {String(ev.metadata.visitor_id ?? "")}</p>
                                                            ) : null}
                                                            {ev.event_type === "registration" && ev.metadata?.user_external_id ? (
                                                              <p className="mt-0.5 font-mono text-white/50 truncate">user: {cell(ev.metadata.user_external_id as string | null)}</p>
                                                            ) : null}
                                                            {ev.event_type === "purchase" && (ev.metadata?.value != null || ev.metadata?.external_event_id) ? (
                                                              <p className="mt-0.5 font-mono text-white/50 truncate">value: {cell(ev.metadata.value as number | null)} {cell(ev.metadata.currency as string | null)} · ext_id: {cell(ev.metadata.external_event_id as string | null)}</p>
                                                            ) : null}
                                                          </div>
                                                        </li>
                                                      );
                                                    })}
                                                  </ul>
                                                </div>
                                              </>
                                            );
                                          } catch {
                                            return <p className="text-white/50 text-xs">Таймлайн для этой цепочки недоступен.</p>;
                                          }
                                        })()}
                                      </div>
                                      {c.gaps.length > 0 && (
                                        <div>
                                          <div className="font-semibold text-white/80">Проблемы цепочки</div>
                                          <ul className="mt-1 list-inside list-disc text-white/60">{c.gaps.map((g) => <li key={g}>{translateGap(g)}</li>)}</ul>
                                        </div>
                                      )}
                                      <div>
                                        <div className="font-semibold text-white/80">Объяснение связи</div>
                                        <p className="mt-1 text-white/60">{translateExplanation(c.explanation)}</p>
                                      </div>
                                      {(c.suggested_fixes?.length ?? 0) > 0 && (
                                        <div>
                                          <div className="font-semibold text-white/80 mb-2">Рекомендуемые исправления</div>
                                          <div className="space-y-3">
                                            {(c.suggested_fixes ?? []).map((fix, idx) => {
                                              const severityStyle = fix.severity === "high" ? { bg: "rgba(239,68,68,0.2)", text: "#fca5a5" } : fix.severity === "medium" ? { bg: "rgba(234,179,8,0.2)", text: "#fde047" } : { bg: "rgba(148,163,184,0.2)", text: "#94a3b8" };
                                              return (
                                                <div key={fix.type} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                                                  <div className="flex items-center gap-2 mb-1.5">
                                                    <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: severityStyle.bg, color: severityStyle.text }}>{fix.severity}</span>
                                                    <span className="font-medium text-white/90">{fix.title}</span>
                                                  </div>
                                                  <p className="text-xs text-white/70 mb-1.5">{fix.description}</p>
                                                  <p className="text-xs text-amber-200/90 mb-1"><span className="text-white/60">Рекомендуемое действие:</span> {fix.suggested_action}</p>
                                                  <p className="text-xs text-white/50"><span className="text-white/60">Влияние:</span> {fix.impact}</p>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {showChains && total > 0 && (viewMode === "chains" || viewMode === "all") && (
                <div className="mt-3 flex items-center justify-between text-sm text-white/60">
                  <span>Цепочки: {chains.length} из {total}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-white/12 bg-white/5 px-3 py-1 disabled:opacity-40">Назад</button>
                    <span className="py-1">{page} / {totalPages}</span>
                    <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded border border-white/12 bg-white/5 px-3 py-1 disabled:opacity-40">Вперёд</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {showJourneys && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white/90">Пути пользователей (между цепочками)</h2>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                {journeys.length === 0 ? (
                  <div className="py-12 text-center text-white/50">Нет путей за выбранный период.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-white/60">
                          <th className="w-8 p-3" />
                          <th className="p-3 font-semibold">ID пользователя</th>
                          <th className="p-3 font-semibold">Первый касание</th>
                          <th className="p-3 font-semibold">Последний касание</th>
                          <th className="p-3 font-semibold">Клики</th>
                          <th className="p-3 font-semibold">Визиты</th>
                          <th className="p-3 font-semibold">Покупки</th>
                          <th className="p-3 font-semibold">Выручка</th>
                          <th className="p-3 font-semibold">Здоровье</th>
                          <th className="p-3 font-semibold">Последнее событие</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journeys.map((j) => {
                          const open = expandedJourneyId === j.journey_id;
                          const userId = j.identity.user_external_id ?? j.identity.visitor_ids[0] ?? "—";
                          const healthColors: Record<string, { bg: string; text: string }> = {
                            Excellent: { bg: "rgba(34,197,94,0.2)", text: "#86efac" },
                            Strong: { bg: "rgba(34,197,94,0.15)", text: "#86efac" },
                            Fair: { bg: "rgba(234,179,8,0.2)", text: "#fde047" },
                            Weak: { bg: "rgba(249,115,22,0.2)", text: "#fdba74" },
                            Broken: { bg: "rgba(239,68,68,0.2)", text: "#fca5a5" },
                          };
                          const hc = healthColors[j.journey_health_label] ?? healthColors.Weak;
                          const typeColors: Record<string, string> = { click: "bg-indigo-500", visit: "bg-cyan-500", registration: "bg-amber-500", purchase: "bg-emerald-500" };
                          return (
                            <React.Fragment key={j.journey_id}>
                              <tr
                                className="border-b border-white/5 hover:bg-white/[0.03]"
                                onClick={() => setExpandedJourneyId(open ? null : j.journey_id)}
                                style={{ cursor: "pointer" }}
                                aria-label={open ? "Скрыть" : "Показать детали"}
                              >
                                <td className="p-3 text-white/50">{open ? "▼" : "▶"}</td>
                                <td className="max-w-[140px] truncate p-3 font-mono text-white/80" title={userId}>{userId}</td>
                                <td className="p-3 text-white/80">{cell(j.summary.first_touch_source)}</td>
                                <td className="p-3 text-white/80">{cell(j.summary.last_touch_source)}</td>
                                <td className="p-3 text-white/80">{j.summary.clicks_count}</td>
                                <td className="p-3 text-white/80">{j.summary.visits_count}</td>
                                <td className="p-3 text-white/80">{j.summary.purchases_count}</td>
                                <td className="p-3 text-white/80">{j.summary.revenue_total > 0 ? j.summary.revenue_total : "—"}</td>
                                <td className="p-3">
                                  <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: hc.bg, color: hc.text }}>{j.journey_health_label} ({j.journey_health_score})</span>
                                </td>
                                <td className="p-3 text-white/60">{fmtTime(j.summary.last_event_at)}</td>
                              </tr>
                              {open && (
                                <tr className="border-b border-white/10 bg-white/[0.04]">
                                  <td colSpan={10} className="p-4">
                                    <div className="space-y-4 text-sm">
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-white/80 mb-1">Identity</div>
                                        <p className="text-xs text-white/60">user_external_id: {cell(j.identity.user_external_id)}</p>
                                        <p className="text-xs text-white/50">visitor_ids: {j.identity.visitor_ids.slice(0, 5).join(", ")}{j.identity.visitor_ids.length > 5 ? "…" : ""}</p>
                                        <p className="text-xs text-white/50">click_ids: {j.identity.click_ids.slice(0, 3).join(", ")}{j.identity.click_ids.length > 3 ? "…" : ""}</p>
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-white/80 mb-1">First / Last touch</div>
                                        <p className="text-xs text-white/70">First touch: {cell(j.summary.first_touch_source)} {cell(j.summary.first_touch_platform)} · Last touch: {cell(j.summary.last_touch_source)} {cell(j.summary.last_touch_platform)}</p>
                                        <p className="text-xs text-white/50 mt-1">Clicks before registration: {j.summary.clicks_before_registration} · Clicks before purchase: {j.summary.clicks_before_purchase}</p>
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-white/80 mb-2">Journey timeline</div>
                                        <div className="relative max-h-[280px] overflow-y-auto">
                                          <div className="absolute left-[11px] top-0 bottom-0 w-px bg-white/15" />
                                          <ul className="space-y-0">
                                            {j.touchpoints.map((t, i) => (
                                              <li key={i} className="relative flex gap-3 pl-0 pb-2 last:pb-0">
                                                <div className={`relative z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full ${typeColors[t.type] ?? "bg-white/30"}`} />
                                                <div className="min-w-0 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs">
                                                  <span className="font-medium text-white/90">{stepTypeLabel[t.type] ?? t.type}</span>
                                                  {t.source && <span className="text-white/60 ml-1">· {trafficSourceLabel(t.source)}</span>}
                                                  <p className="mt-0.5 text-white/50">{fmtTime(t.timestamp)}</p>
                                                  {t.type === "purchase" && t.value != null && <p className="text-white/60">{t.value} {cell(t.currency)}</p>}
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="font-semibold text-white/80">Includes {j.chains.length} attribution chain(s)</div>
                                      </div>
                                      {j.attribution_models && j.summary.revenue_total > 0 && (
                                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                          <div className="font-semibold text-white/80 mb-2">Attribution Model Comparison</div>
                                          <p className="text-xs text-white/50 mb-2">Revenue ${j.summary.revenue_total} distributed by model</p>
                                          {(() => {
                                            const am = j.attribution_models;
                                            const models = [
                                              { key: "first_touch", label: "First Touch" },
                                              { key: "last_touch", label: "Last Touch" },
                                              { key: "linear", label: "Linear" },
                                              { key: "position_based", label: "Position (40/20/40)" },
                                              { key: "data_driven", label: "Data-driven" },
                                            ] as const;
                                            const allSources = new Set<string>();
                                            models.forEach((m) => Object.keys(am[m.key] ?? {}).forEach((s) => allSources.add(s)));
                                            const sources = Array.from(allSources).sort((a, b) => (a === "unknown" ? 1 : b === "unknown" ? -1 : a.localeCompare(b)));
                                            const totalByModel = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
                                            return (
                                              <>
                                                <div className="overflow-x-auto">
                                                  <table className="w-full text-xs text-left">
                                                    <thead>
                                                      <tr className="text-white/60 border-b border-white/10">
                                                        <th className="py-1.5 pr-3 font-semibold">Model</th>
                                                        {sources.map((s) => (
                                                          <th key={s} className="py-1.5 px-2 font-medium">{trafficSourceLabel(s)}</th>
                                                        ))}
                                                    </tr>
                                                    </thead>
                                                    <tbody>
                                                      {models.map((m) => {
                                                        const rec = am[m.key] ?? {};
                                                        return (
                                                          <tr key={m.key} className="border-b border-white/5">
                                                            <td className="py-1.5 pr-3 text-white/80">{m.label}</td>
                                                            {sources.map((src) => (
                                                              <td key={src} className="py-1.5 px-2 text-white/70">{(rec[src] ?? 0) > 0 ? rec[src] : "—"}</td>
                                                            ))}
                                                          </tr>
                                                        );
                                                      })}
                                                    </tbody>
                                                  </table>
                                                </div>
                                                <div className="mt-3 space-y-1.5">
                                                  {models.map((m) => {
                                                    const rec = am[m.key] ?? {};
                                                    const total = totalByModel(rec);
                                                    return (
                                                      <div key={m.key} className="flex items-center gap-2">
                                                        <span className="w-28 shrink-0 text-xs text-white/60">{m.label}</span>
                                                        <div className="flex-1 flex gap-0.5 h-4 rounded overflow-hidden bg-white/5">
                                                          {sources.map((src) => {
                                                            const v = rec[src] ?? 0;
                                                            const pct = total > 0 ? (v / total) * 100 : 0;
                                                            const colors: Record<string, string> = { meta: "bg-blue-500", google: "bg-red-500", tiktok: "bg-pink-500", yandex: "bg-yellow-600", unknown: "bg-white/20", direct: "bg-white/30" };
                                                            return pct > 0 ? (
                                                              <div key={src} className={`${colors[src] ?? "bg-white/40"}`} style={{ width: `${pct}%` }} title={`${trafficSourceLabel(src)}: ${v}`} />
                                                            ) : null;
                                                          })}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              </>
                                            );
                                          })()}
                                        </div>
                                      )}
                                      {j.journey_insights.length > 0 && (
                                        <div>
                                          <div className="font-semibold text-white/80 mb-1">Insights</div>
                                          <ul className="list-disc list-inside text-xs text-white/60">{j.journey_insights.map((ins, i) => <li key={i}>{ins}</li>)}</ul>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {showJourneys && journeysTotal > 0 && (
                <div className="mt-3 flex items-center justify-between text-sm text-white/60">
                  <span>Пути: {journeys.length} из {journeysTotal}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-white/12 bg-white/5 px-3 py-1 disabled:opacity-40">Назад</button>
                    <span className="py-1">{page} / {totalPages}</span>
                    <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded border border-white/12 bg-white/5 px-3 py-1 disabled:opacity-40">Вперёд</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {showOrphans && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-white/90">События без привязки к цепочке</h2>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                {orphans.length === 0 ? (
                  <div className="py-12 text-center text-white/50">Нет событий без цепочки за выбранный период.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-white/60">
                          <th className="p-3 font-semibold">Тип</th>
                          <th className="p-3 font-semibold">Источник</th>
                          <th className="p-3 font-semibold">ID клика</th>
                          <th className="p-3 font-semibold">ID визита</th>
                          <th className="p-3 font-semibold">ID пользователя</th>
                          <th className="p-3 font-semibold">External event ID</th>
                          <th className="p-3 font-semibold">Сумма / Валюта</th>
                          <th className="p-3 font-semibold">Создано</th>
                          <th className="p-3 font-semibold">Причина</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orphans.map((item) => {
                          const colors = orphanTypeColors[item.type] ?? { bg: "rgba(255,255,255,0.08)", text: "rgb(255,255,255)" };
                          const typeLabel = item.type === "orphan_visit" ? "Визит без цепочки" : item.type === "unmatched_registration" ? "Регистрация без цепочки" : "Покупка без цепочки";
                          const source = item.traffic_source ?? "—";
                          const clickId = "click_id" in item ? item.click_id : "—";
                          const visitId = item.type === "orphan_visit" ? item.visit_id : "—";
                          const userId = "user_external_id" in item ? item.user_external_id : "—";
                          const extId = item.type === "unmatched_purchase" ? item.external_event_id : "—";
                          const valueCur = item.type === "unmatched_purchase" ? `${cell(item.value)} ${cell(item.currency)}` : "—";
                          return (
                            <tr key={orphanKey(item)} className="border-b border-white/5 hover:bg-white/[0.03]">
                              <td className="p-3">
                                <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: colors.bg, color: colors.text }}>
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="p-3 font-mono text-white/80">{trafficSourceLabel(source)}</td>
                              <td className="max-w-[100px] truncate p-3 font-mono text-white/70" title={String(clickId)}>{cell(clickId)}</td>
                              <td className="max-w-[100px] truncate p-3 font-mono text-white/70" title={String(visitId)}>{cell(visitId)}</td>
                              <td className="max-w-[100px] truncate p-3 font-mono text-white/70" title={String(userId)}>{cell(userId)}</td>
                              <td className="max-w-[100px] truncate p-3 font-mono text-white/70" title={String(extId)}>{cell(extId)}</td>
                              <td className="p-3 text-white/80">{valueCur}</td>
                              <td className="p-3 text-white/60">{fmtTime(item.created_at)}</td>
                              <td className="max-w-[220px] p-3 text-xs text-white/70" title={item.reason}>{item.reason}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {showOrphans && (viewMode === "orphans" ? total : totalOrphans) > 0 && viewMode === "orphans" && (
                <div className="mt-3 flex items-center justify-between text-sm text-white/60">
                  <span>Без цепочки: {orphans.length} из {total}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-white/12 bg-white/5 px-3 py-1 disabled:opacity-40">Назад</button>
                    <span className="py-1">{page} / {totalPages}</span>
                    <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded border border-white/12 bg-white/5 px-3 py-1 disabled:opacity-40">Вперёд</button>
                  </div>
                </div>
              )}
              {showOrphans && viewMode === "all" && totalOrphans > 0 && (
                <div className="mt-3 text-sm text-white/60">Показано {orphans.length} из {totalOrphans} событий без цепочки (без пагинации)</div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
