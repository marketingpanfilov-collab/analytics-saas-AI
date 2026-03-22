/**
 * Sync journal: start/finish sync runs and record invariant checks.
 * Uses existing sync_runs table (legacy + hardening columns) and data_invariant_checks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type SyncRunStatus = "running" | "ok" | "error";

export type StartSyncRunParams = {
  projectId: string;
  platform: string;
  adAccountId: string | null;
  syncType?: string;
  dateStart: string;
  dateEnd: string;
  metadata?: Record<string, unknown>;
};

export type StartSyncRunResult = {
  id: string | null;
  alreadyRunning: boolean;
};

/**
 * Insert a new sync_runs row with status 'running'.
 * Uses the DB UNIQUE index as a lock: on conflict (already running) returns { id: null, alreadyRunning: true }.
 */
export async function startSyncRun(admin: Admin, params: StartSyncRunParams): Promise<StartSyncRunResult> {
  const row: Record<string, unknown> = {
    project_id: params.projectId,
    platform: params.platform,
    ad_account_id: params.adAccountId,
    sync_type: params.syncType ?? "insights",
    status: "running",
    date_start: params.dateStart,
    date_end: params.dateEnd,
    metadata: params.metadata ?? {},
  };

  const { data, error } = await admin.from("sync_runs").insert(row).select("id").single();

  if (error) {
    // 23505 = unique_violation → concurrent running sync for same platform/ad_account/date range
    const pgCode = (error as any)?.code as string | undefined;
    if (pgCode === "23505") {
      console.log("[SYNC_RUNS_START_ALREADY_RUNNING]", {
        projectId: params.projectId,
        platform: params.platform,
        adAccountId: params.adAccountId,
        dateStart: params.dateStart,
        dateEnd: params.dateEnd,
      });
      return { id: null, alreadyRunning: true };
    }

    console.log("[SYNC_RUNS_START_ERROR]", {
      error: error.message ?? error,
      projectId: params.projectId,
      platform: params.platform,
      adAccountId: params.adAccountId,
      dateStart: params.dateStart,
      dateEnd: params.dateEnd,
    });
    return { id: null, alreadyRunning: false };
  }
  return { id: (data as { id?: string } | null)?.id ?? null, alreadyRunning: false };
}

export type FinishSyncRunSuccessParams = {
  rowsWritten?: number;
  rowsInserted?: number;
  campaignRowsInserted?: number;
  accountRowsInserted?: number;
  rowsDeleted?: number;
  meta?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Update sync_runs to status 'ok' and set counts + metadata. Keeps legacy rows_written and meta.
 */
export async function finishSyncRunSuccess(
  admin: Admin,
  runId: string | null,
  params: FinishSyncRunSuccessParams
): Promise<void> {
  if (!runId) return;
  const finishedAt = new Date().toISOString();
  const row: Record<string, unknown> = {
    status: "ok",
    finished_at: finishedAt,
  };
  if (params.rowsWritten != null) row.rows_written = params.rowsWritten;
  if (params.rowsInserted != null) row.rows_inserted = params.rowsInserted;
  if (params.campaignRowsInserted != null) row.campaign_rows_inserted = params.campaignRowsInserted;
  if (params.accountRowsInserted != null) row.account_rows_inserted = params.accountRowsInserted;
  if (params.rowsDeleted != null) row.rows_deleted = params.rowsDeleted;
  const meta = params.meta ?? params.metadata ?? null;
  if (meta != null) {
    row.meta = meta;
    row.metadata = meta;
  }

  const { error } = await admin.from("sync_runs").update(row).eq("id", runId);
  if (error) {
    console.log("[SYNC_RUNS_FINISH_SUCCESS_ERROR]", { runId, error: error.message ?? error });
  }
}

/**
 * Update sync_runs to status 'error', set error_message and error_text, finished_at, optional metadata.
 */
export async function finishSyncRunError(
  admin: Admin,
  runId: string | null,
  errorText: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  if (!runId) return;
  const finishedAt = new Date().toISOString();
  const row: Record<string, unknown> = {
    status: "error",
    finished_at: finishedAt,
    error_message: errorText,
    error_text: errorText,
  };
  if (metadata != null) {
    row.meta = metadata;
    row.metadata = metadata;
  }

  const { error } = await admin.from("sync_runs").update(row).eq("id", runId);
  if (error) {
    console.log("[SYNC_RUNS_FINISH_ERROR_UPDATE_FAILED]", { runId, error: error.message ?? error });
  }
}

export type RecordInvariantCheckParams = {
  projectId: string;
  checkCode: string;
  severity: "critical" | "warning";
  status: "ok" | "failed";
  details?: Record<string, unknown>;
};

/**
 * Insert one row into data_invariant_checks. Does not throw; logs on insert error.
 */
export async function recordInvariantCheck(admin: Admin, params: RecordInvariantCheckParams): Promise<void> {
  const row = {
    project_id: params.projectId,
    check_code: params.checkCode,
    severity: params.severity,
    status: params.status,
    details: params.details ?? {},
  };

  const { error } = await admin.from("data_invariant_checks").insert(row);
  if (error) {
    console.log("[SYNC_RUNS_RECORD_INVARIANT_ERROR]", { checkCode: params.checkCode, error: error.message ?? error });
  }
}
