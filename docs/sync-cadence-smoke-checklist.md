# Sync Cadence Smoke Checklist

## Cron: every 3 hours (paid/active projects)
1. Verify the cron job is enabled (Vercel UI).
2. In logs, you should see entries like:
   - `[INTERNAL_SYNC_CRON_SELECTION]` (paid_users/paid_projects counts)
   - `[INTERNAL_SYNC_CRON_START]` (how many projects will be processed)
   - `[INTERNAL_SYNC_CRON_PROJECT_WARNINGS]` (if any platform sync partially failed)
   - `[INTERNAL_SYNC_CRON_DONE]` (queued/skipped/failed summary)
3. Security sanity check:
   - Call `/api/internal-sync/cron` without headers and confirm `401 Unauthorized`.
   - Call with `Authorization: Bearer <CRON_SECRET>` (or `x-internal-sync-secret: <INTERNAL_SYNC_SECRET>` in local dev) and confirm `200`.

## Client: force sync on entry + 15-minute refresh while online
1. Open dashboard page in a visible browser tab while online:
   - In the browser console, you should see:
     - `[BOARD_FORCE_SYNC_ENTRY_TRIGGER]` (first load forced refresh)
     - Network: `POST /api/dashboard/refresh`
2. Keep the tab visible and online:
   - Every ~15 minutes you should see `[BOARD_AUTO_REFRESH_TRIGGER]` and a new `POST /api/dashboard/refresh`.
3. Offline / hidden tab behavior:
   - Disable network or switch to a hidden tab.
   - Confirm that no `POST /api/dashboard/refresh` is triggered during that period.
4. Page reload after delay:
   - Reload the page after waiting > 15 minutes.
   - Confirm `[BOARD_FORCE_SYNC_ENTRY_TRIGGER]` appears again and a refresh is triggered.

## Integration status: stale/error alignment (~3 hours)
1. After cron/refresh has run, integration status should typically become `healthy` when `data_max_date` reaches today.
2. If data for today is missing, `stale/error` should escalate only after approximately ~3 hours (not ~20–60 minutes).

## Debug keys
- Internal cron logs: `app/api/internal-sync/cron/route.ts`
- Dashboard refresh triggers: `app/app/AppDashboardClient.tsx`
- Integration status logic: `app/api/oauth/integration/status/route.ts`

