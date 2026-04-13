import { describe, expect, it } from "vitest";
import { ChannelState, resolveChannelState, type ChannelStateInput } from "@/app/lib/channelState";

function base(over: Partial<ChannelStateInput> = {}): ChannelStateInput {
  return {
    connected: true,
    oauth_valid: true,
    enabled_accounts: 1,
    status: "healthy",
    reason: null,
    last_sync_status: "ok",
    data_max_date: "2026-04-09",
    ...over,
  };
}

describe("resolveChannelState", () => {
  it("maps not_connected / disconnected integration to NOT_CONNECTED", () => {
    expect(
      resolveChannelState(
        base({ connected: false, oauth_valid: false, enabled_accounts: 0, status: "not_connected", data_max_date: null })
      )
    ).toBe(ChannelState.NOT_CONNECTED);
  });

  it("maps internal_error-style payload to ERROR", () => {
    expect(
      resolveChannelState(
        base({
          connected: false,
          oauth_valid: false,
          enabled_accounts: 0,
          status: "error",
          reason: "internal_error",
          data_max_date: null,
        })
      )
    ).toBe(ChannelState.ERROR);
  });

  it("prefers SYNCING over summary status when last sync is running", () => {
    expect(
      resolveChannelState(
        base({
          last_sync_status: "running",
          status: "healthy",
        })
      )
    ).toBe(ChannelState.SYNCING);
  });

  it("maps disconnected summary to DISCONNECTED", () => {
    expect(
      resolveChannelState(
        base({
          status: "disconnected",
          reason: "disconnected",
          last_sync_status: null,
        })
      )
    ).toBe(ChannelState.DISCONNECTED);
  });

  it("maps no_accounts to CONNECTED_NO_ACCOUNTS", () => {
    expect(
      resolveChannelState(
        base({
          status: "no_accounts",
          enabled_accounts: 0,
          data_max_date: null,
          last_sync_status: null,
        })
      )
    ).toBe(ChannelState.CONNECTED_NO_ACCOUNTS);
  });

  it("maps healthy + metrics to ACTIVE", () => {
    expect(resolveChannelState(base({ status: "healthy", data_max_date: "2026-04-10" }))).toBe(ChannelState.ACTIVE);
  });

  it("maps stale with lagging data to STALE", () => {
    expect(
      resolveChannelState(
        base({
          status: "stale",
          reason: "sync_old",
          data_max_date: "2026-04-08",
        })
      )
    ).toBe(ChannelState.STALE);
  });

  it("maps accounts selected but no metrics max date + data_behind to ACCOUNTS_SELECTED_NO_DATA", () => {
    expect(
      resolveChannelState(
        base({
          status: "stale",
          reason: "data_behind",
          data_max_date: null,
          enabled_accounts: 2,
        })
      )
    ).toBe(ChannelState.ACCOUNTS_SELECTED_NO_DATA);
  });

  it("maps no_data_updates_today to ACCOUNTS_SELECTED_NO_DATA when accounts enabled", () => {
    expect(
      resolveChannelState(
        base({
          status: "error",
          reason: "no_data_updates_today",
          data_max_date: null,
          enabled_accounts: 1,
        })
      )
    ).toBe(ChannelState.ACCOUNTS_SELECTED_NO_DATA);
  });

  it("maps sync_failed to ERROR", () => {
    expect(
      resolveChannelState(
        base({
          status: "error",
          reason: "sync_failed",
          data_max_date: null,
          enabled_accounts: 1,
        })
      )
    ).toBe(ChannelState.ERROR);
  });
});
