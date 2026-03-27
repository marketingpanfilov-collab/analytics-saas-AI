# Post-Deploy Checklist: Tracking Hardening

## 1) Set environment variables

Required:

- `INTERNAL_SYNC_SECRET`
- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional (retention tuning):

- `TRACKING_RETENTION_CONVERSION_DAYS` (default `365`)
- `TRACKING_RETENTION_VISIT_DAYS` (default `180`)
- `TRACKING_RETENTION_REDIRECT_DAYS` (default `365`)
- `TRACKING_RETENTION_TELEMETRY_DAYS` (default `90`)

## 2) Verify internal endpoints

- `GET /api/internal-sync/tracking-telemetry?hours=24` with `x-internal-sync-secret`.
- `POST /api/internal-sync/tracking-retention` with `x-internal-sync-secret`.
- Confirm both endpoints return `success: true`.

## 3) API smoke (tracking flow)

- `POST /api/tracking/source` with valid `X-BoardIQ-Key` returns success.
- `GET /api/tracking/source/pixel` returns `200` GIF response.
- `POST /api/tracking/conversion` returns success.
- Repeat conversion with same idempotency token/external_event_id returns `duplicate: true`.
- `GET /r/[token]` returns redirect (`302`), no 5xx.

## 4) Run SQL smoke checks in this exact order

1. Duplicate conversions by `external_event_id` (must be zero duplicates).
2. Duplicate visits by `site_id + visit_id` (must be zero duplicates).
3. Missing `visitor_id` / `click_id` trend by day (no anomalous spike).
4. Direct/unknown spike at hour boundaries (no anomaly).
5. Spend-vs-conversion channel split trend (no sharp mismatch).

Use SQL from:

- `docs/tracking-hardening-runbook.md` -> section `Smoke SQL checks`.

## 5) Final acceptance

- Dashboard source options include expected classes (`direct`, `organic_search`, `paid`, `referral`, `unknown` where applicable).
- Redirect + pixel + conversion chain is stable for at least 2 test runs.
- No ingest errors surge in `tracking-ingest-telemetry` for last 24h.

