-- Rate limit buckets for POST /api/tracking/conversion (per IP, per project/minute, per project/day).
-- ip: client IP for ip_minute bucket; '' for project-level buckets (proj_minute, proj_day). Kept nullable for schema match.
CREATE TABLE IF NOT EXISTS public.ingest_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  ip text,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_rate_limits_project_bucket_window
  ON public.ingest_rate_limits (project_id, bucket, window_start);

CREATE INDEX IF NOT EXISTS idx_ingest_rate_limits_ip_bucket_window
  ON public.ingest_rate_limits (ip, bucket, window_start);

-- Unique for upsert; RPC always uses non-null ip ('' for project buckets, client IP for ip_minute).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingest_rate_limits_upsert_uniq'
  ) THEN
    ALTER TABLE public.ingest_rate_limits
      ADD CONSTRAINT ingest_rate_limits_upsert_uniq UNIQUE (project_id, ip, bucket, window_start);
  END IF;
END $$;

COMMENT ON TABLE public.ingest_rate_limits IS 'Rate limit counters for conversion ingest: ip_minute (per IP), proj_minute (per project/min), proj_day (per project/day).';

-- Atomic check-and-increment; raises RATE_LIMIT_IP, RATE_LIMIT_PROJ_MINUTE, or RATE_LIMIT_PROJ_DAY when exceeded.
-- IP bucket uses project_id = zeros; project buckets use ip = ''.
CREATE OR REPLACE FUNCTION public.check_and_increment_ingest_rate(
  p_project_id uuid,
  p_ip text,
  p_minute_ts timestamptz,
  p_day_ts timestamptz
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
  v_ip_sentinel uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
BEGIN
  -- 1) Per IP: 20/min (ip never null in inserts so constraint works)
  INSERT INTO public.ingest_rate_limits (project_id, ip, bucket, window_start, request_count, updated_at)
  VALUES (v_ip_sentinel, COALESCE(NULLIF(trim(p_ip), ''), '0.0.0.0'), 'ip_minute', p_minute_ts, 1, v_now)
  ON CONFLICT (project_id, ip, bucket, window_start)
  DO UPDATE SET request_count = public.ingest_rate_limits.request_count + 1, updated_at = v_now
  RETURNING request_count INTO v_count;
  IF v_count > 20 THEN RAISE EXCEPTION 'RATE_LIMIT_IP' USING errcode = 'P0001'; END IF;

  -- 2) Per project: 60/min
  INSERT INTO public.ingest_rate_limits (project_id, ip, bucket, window_start, request_count, updated_at)
  VALUES (p_project_id, '', 'proj_minute', p_minute_ts, 1, v_now)
  ON CONFLICT (project_id, ip, bucket, window_start)
  DO UPDATE SET request_count = public.ingest_rate_limits.request_count + 1, updated_at = v_now
  RETURNING request_count INTO v_count;
  IF v_count > 60 THEN RAISE EXCEPTION 'RATE_LIMIT_PROJ_MINUTE' USING errcode = 'P0001'; END IF;

  -- 3) Per project: 2000/day
  INSERT INTO public.ingest_rate_limits (project_id, ip, bucket, window_start, request_count, updated_at)
  VALUES (p_project_id, '', 'proj_day', p_day_ts, 1, v_now)
  ON CONFLICT (project_id, ip, bucket, window_start)
  DO UPDATE SET request_count = public.ingest_rate_limits.request_count + 1, updated_at = v_now
  RETURNING request_count INTO v_count;
  IF v_count > 2000 THEN RAISE EXCEPTION 'RATE_LIMIT_PROJ_DAY' USING errcode = 'P0001'; END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.check_and_increment_ingest_rate IS 'Increments ingest rate buckets; raises on limit exceeded (20/IP/min, 60/project/min, 2000/project/day).';
