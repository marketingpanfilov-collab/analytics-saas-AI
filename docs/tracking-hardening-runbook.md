# Tracking Hardening Runbook

Quick post-deploy flow:

- `docs/post-deploy-tracking-checklist.md`

## Scope

- Pixel/source ingest dedup by `visit_id` (`site_id + visit_id`).
- Conversion dedup by `(project_id, event_name, external_event_id)` when external id exists.
- Redirect logging uses transactional RPC.
- Ingest telemetry collected in `tracking_ingest_telemetry`.
- Retention via `/api/internal-sync/tracking-retention`.

## Required env

- `INTERNAL_SYNC_SECRET` (required for internal endpoints)
- `CRON_SECRET` (recommended for Vercel cron auth)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (recommended for distributed rate-limit)
- `TRACKING_RETENTION_CONVERSION_DAYS` (default 365)
- `TRACKING_RETENTION_VISIT_DAYS` (default 180)
- `TRACKING_RETENTION_REDIRECT_DAYS` (default 365)
- `TRACKING_RETENTION_TELEMETRY_DAYS` (default 90)

## Smoke SQL checks

```sql
-- 1) duplicate conversions by external_event_id (must be 0 after dedup migration)
select project_id, event_name, external_event_id, count(*) as cnt
from conversion_events
where external_event_id is not null
group by 1,2,3
having count(*) > 1
order by cnt desc;

-- 2) duplicate visits by site_id+visit_id (must be 0)
select site_id, visit_id, count(*) as cnt
from visit_source_events
where visit_id is not null
group by 1,2
having count(*) > 1
order by cnt desc;

-- 3) conversions without visitor_id/click_id by day (watch for spikes)
select date_trunc('day', coalesce(event_time, created_at)) as day_utc,
       count(*) filter (where visitor_id is null or visitor_id = '') as missing_visitor,
       count(*) filter (where click_id is null or click_id = '') as missing_click,
       count(*) as total
from conversion_events
where created_at >= now() - interval '14 days'
group by 1
order by 1 desc;

-- 4) direct/unknown spike near day boundaries
select date_trunc('hour', created_at) as hour_utc,
       count(*) filter (where source_classification in ('direct', 'unknown')) as direct_unknown,
       count(*) as total
from visit_source_events
where created_at >= now() - interval '3 days'
group by 1
order by 1 desc;

-- 5) spend vs conversion split mismatch by source class (sanity trend check)
select date_trunc('day', coalesce(c.event_time, c.created_at)) as day_utc,
       coalesce(v.source_classification, 'unknown') as source_classification,
       count(*) filter (where c.event_name = 'purchase') as purchases
from conversion_events c
left join lateral (
  select source_classification
  from visit_source_events v
  where v.site_id = c.project_id::text
    and v.visitor_id = c.visitor_id
    and v.created_at <= coalesce(c.event_time, c.created_at)
  order by v.created_at desc
  limit 1
) v on true
where c.created_at >= now() - interval '14 days'
group by 1,2
order by 1 desc, 3 desc;
```

## Rollback

1. Disable cron route `/api/internal-sync/tracking-retention` in `vercel.json`.
2. Revert API routes:
   - `/api/tracking/source`
   - `/api/tracking/source/pixel`
   - `/api/tracking/conversion`
   - `/r/[token]`
3. Revert migration `20260329000000_tracking_hardening_core.sql` only if no dependent code is deployed.
4. Keep telemetry table if uncertain; it is non-blocking and safe.

