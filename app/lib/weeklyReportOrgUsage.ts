/**
 * Организационный лимит weekly board report (Starter): UTC-календарный месяц, идемпотентность по ключу запроса.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanFeatureMatrix } from "@/app/lib/planConfig";
import type { EffectivePlan } from "@/app/lib/accessState";

/** YYYY-MM в UTC (канон биллинга / отчётов). */
export function weeklyReportUsageMonthUtc(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function weeklyReportIdempotencyKey(
  projectId: string,
  start: string,
  end: string,
  sources: string[],
  accountIds: string[]
): string {
  const s = [...sources].map((x) => x.trim().toLowerCase()).filter(Boolean).sort().join(",");
  const a = [...accountIds].map((x) => x.trim()).filter(Boolean).sort().join(",");
  return `wb:v1:${projectId}:${start}:${end}:${s}:${a}`;
}

/**
 * Печать / Save as PDF: ключ включает `attemptNonce` (UUID с клиента на каждое нажатие),
 * чтобы каждое сохранение в PDF списывало квоту, а не только первое за период.
 * Повтор с тем же nonce идемпотентен (ретрай сети).
 */
export function weeklyReportExportIdempotencyKey(
  projectId: string,
  start: string,
  end: string,
  sources: string[],
  accountIds: string[],
  attemptNonce: string
): string {
  const s = [...sources].map((x) => x.trim().toLowerCase()).filter(Boolean).sort().join(",");
  const a = [...accountIds].map((x) => x.trim()).filter(Boolean).sort().join(",");
  const n = attemptNonce.trim().toLowerCase();
  return `wb:export:v2:${projectId}:${start}:${end}:${s}:${a}:${n}`;
}

/** Отдельный ключ от просмотра отчёта: одно списание на успешное создание открытой ссылки (период + фильтры). */
/**
 * Уникальный идентификатор попытки печати/PDF (UUID или запасной формат с клиента).
 * Ретрай с тем же телом не списывает квоту дважды.
 */
export function isValidWeeklyReportExportNonce(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 16 || t.length > 128) return false;
  if (/[\s<>"']/.test(t)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) || /^[0-9a-z-]{16,128}$/i.test(t);
}

export function weeklyReportShareIdempotencyKey(
  projectId: string,
  start: string,
  end: string,
  sources: string[],
  accountIds: string[]
): string {
  const s = [...sources].map((x) => x.trim().toLowerCase()).filter(Boolean).sort().join(",");
  const a = [...accountIds].map((x) => x.trim()).filter(Boolean).sort().join(",");
  return `wb:share:v1:${projectId}:${start}:${end}:${s}:${a}`;
}

export async function loadProjectOrganizationId(
  admin: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data } = await admin.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  const oid = (data as { organization_id?: string | null } | null)?.organization_id;
  return typeof oid === "string" && oid.length > 0 ? oid : null;
}

export async function countWeeklyReportUsageForMonth(
  admin: SupabaseClient,
  organizationId: string,
  usageMonthUtc: string
): Promise<number> {
  const { count, error } = await admin
    .from("organization_weekly_report_usage")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("usage_month_utc", usageMonthUtc);
  if (error) {
    console.error("[weekly_report_usage_count]", error);
    return 0;
  }
  return count ?? 0;
}

export type ConsumeWeeklyReportUsageResult =
  | { ok: true; duplicate: boolean; used: number; limit: number | null }
  | { ok: false; code: "WEEKLY_REPORT_LIMIT_REACHED"; used: number; limit: number };

export type WeeklyReportUsageConsumeKind = "share_link" | "export_print" | "report_view";

/**
 * Списывает квоту после успешной операции (достаточно данных).
 * `share_link` | `export_print` | `report_view` — разные idempotency-ключи.
 * Для `export_print` нужен `exportAttemptNonce` (уникальный на каждое действие печати/PDF).
 * Growth/Scale: maxPerMonth null → без RPC.
 */
export async function consumeWeeklyReportUsageAfterSuccess(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    projectId: string;
    start: string;
    end: string;
    sources: string[];
    accountIds: string[];
    maxPerMonth: number | null;
    kind: WeeklyReportUsageConsumeKind;
    /** Обязателен при kind === `export_print` */
    exportAttemptNonce?: string;
  }
): Promise<ConsumeWeeklyReportUsageResult> {
  const month = weeklyReportUsageMonthUtc();
  const idempotencyKey =
    params.kind === "share_link"
      ? weeklyReportShareIdempotencyKey(
          params.projectId,
          params.start,
          params.end,
          params.sources,
          params.accountIds
        )
      : params.kind === "export_print"
        ? weeklyReportExportIdempotencyKey(
            params.projectId,
            params.start,
            params.end,
            params.sources,
            params.accountIds,
            params.exportAttemptNonce ?? ""
          )
        : weeklyReportIdempotencyKey(
            params.projectId,
            params.start,
            params.end,
            params.sources,
            params.accountIds
          );

  if (params.maxPerMonth == null) {
    return { ok: true, duplicate: false, used: 0, limit: null };
  }

  const { data, error } = await admin.rpc("consume_org_weekly_report_usage", {
    p_organization_id: params.organizationId,
    p_usage_month_utc: month,
    p_idempotency_key: idempotencyKey,
    p_project_id: params.projectId,
    p_limit: params.maxPerMonth,
    p_metadata: {},
  });

  if (error) {
    console.error("[consume_org_weekly_report_usage]", error);
    return {
      ok: false,
      code: "WEEKLY_REPORT_LIMIT_REACHED",
      used: await countWeeklyReportUsageForMonth(admin, params.organizationId, month),
      limit: params.maxPerMonth,
    };
  }

  const row = data as Record<string, unknown> | null;
  if (!row || row.ok !== true) {
    const used = typeof row?.used === "number" ? row.used : 0;
    const lim = typeof row?.limit === "number" ? row.limit : params.maxPerMonth;
    if (row?.code === "WEEKLY_REPORT_LIMIT_REACHED") {
      return { ok: false, code: "WEEKLY_REPORT_LIMIT_REACHED", used, limit: lim };
    }
    return { ok: false, code: "WEEKLY_REPORT_LIMIT_REACHED", used, limit: params.maxPerMonth };
  }

  if (row.skipped === true) {
    return { ok: true, duplicate: false, used: 0, limit: null };
  }

  return {
    ok: true,
    duplicate: row.duplicate === true,
    used: typeof row.used === "number" ? row.used : 0,
    limit: typeof row.limit === "number" ? row.limit : params.maxPerMonth,
  };
}

export function maxWeeklyReportsForEffectivePlan(effectivePlan: EffectivePlan): number | null {
  if (effectivePlan == null) return null;
  const m = getPlanFeatureMatrix(effectivePlan);
  return m.max_weekly_reports_per_month;
}
