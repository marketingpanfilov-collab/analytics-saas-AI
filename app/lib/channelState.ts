/**
 * System channel state (v1). Single source of truth for “where is this integration in the pipeline”.
 * UI copy maps elsewhere — this module must not contain user-facing strings.
 *
 * Inputs are expected to match the data already combined by GET /api/oauth/integration/status:
 * - integrations / token health → connected, oauth_valid, status (disconnected / stale when token issues)
 * - ad_accounts → enabled_accounts
 * - daily_ad_metrics → data_max_date
 * - sync_runs → last_sync_status (+ timestamps used upstream to compute status / reason)
 *
 * Precedence (first match wins):
 * 1. !connected → NOT_CONNECTED, except status "error" (e.g. internal_error) → ERROR
 * 2. last_sync_status "running" → SYNCING
 * 3. status "disconnected" → DISCONNECTED
 * 4. status "no_accounts" or enabled_accounts === 0 → CONNECTED_NO_ACCOUNTS
 * 5. enabled_accounts > 0 and no data_max_date → ACCOUNTS_SELECTED_NO_DATA vs ERROR vs STALE (by status + reason)
 * 6. status "healthy" → ACTIVE, "stale" → STALE, "error" → ERROR
 */

export enum ChannelState {
  NOT_CONNECTED = "NOT_CONNECTED",
  CONNECTED_NO_ACCOUNTS = "CONNECTED_NO_ACCOUNTS",
  ACCOUNTS_SELECTED_NO_DATA = "ACCOUNTS_SELECTED_NO_DATA",
  SYNCING = "SYNCING",
  ACTIVE = "ACTIVE",
  STALE = "STALE",
  ERROR = "ERROR",
  DISCONNECTED = "DISCONNECTED",
}

/** Tier-1 status from integration status API (before ChannelState). */
export type IntegrationSummaryStatus =
  | "healthy"
  | "error"
  | "stale"
  | "disconnected"
  | "no_accounts"
  | "not_connected";

export type ChannelStateInput = {
  connected: boolean;
  oauth_valid: boolean;
  enabled_accounts: number;
  status: IntegrationSummaryStatus;
  reason: string | null | undefined;
  last_sync_status: string | null | undefined;
  data_max_date: string | null | undefined;
};

function normSyncStatus(last: string | null | undefined): string {
  return String(last ?? "").trim().toLowerCase();
}

function hasMetricsMaxDate(dataMaxDate: string | null | undefined): boolean {
  return dataMaxDate != null && String(dataMaxDate).trim() !== "";
}

export function resolveChannelState(channelData: ChannelStateInput): ChannelState {
  const {
    connected,
    enabled_accounts: enabledRaw,
    status,
    reason,
    last_sync_status: lastSync,
    data_max_date: dataMaxDate,
  } = channelData;

  const enabled_accounts = Number.isFinite(Number(enabledRaw)) ? Number(enabledRaw) : 0;

  if (!connected) {
    if (status === "error") return ChannelState.ERROR;
    return ChannelState.NOT_CONNECTED;
  }

  if (normSyncStatus(lastSync) === "running") {
    return ChannelState.SYNCING;
  }

  if (status === "disconnected") {
    return ChannelState.DISCONNECTED;
  }

  if (status === "no_accounts" || enabled_accounts === 0) {
    return ChannelState.CONNECTED_NO_ACCOUNTS;
  }

  const hasData = hasMetricsMaxDate(dataMaxDate);

  if (!hasData) {
    if (status === "error") {
      if (reason === "sync_failed") return ChannelState.ERROR;
      if (reason === "no_data_updates_today") return ChannelState.ACCOUNTS_SELECTED_NO_DATA;
      return ChannelState.ERROR;
    }
    if (status === "stale") {
      if (reason === "data_behind") return ChannelState.ACCOUNTS_SELECTED_NO_DATA;
      return ChannelState.STALE;
    }
    if (status === "healthy") return ChannelState.ACTIVE;
    return ChannelState.STALE;
  }

  if (status === "healthy") return ChannelState.ACTIVE;
  if (status === "stale") return ChannelState.STALE;
  if (status === "error") return ChannelState.ERROR;

  return ChannelState.ERROR;
}
