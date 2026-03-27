-- Tracking hardening core:
-- 1) Dedup constraints for conversion and visits
-- 2) Telemetry table for ingest failures
-- 3) Transactional redirect logging RPC
-- 4) Retention cleanup function

-- 1) Dedup / indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversion_events_project_event_external
  ON public.conversion_events (project_id, event_name, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_source_events_site_visit_id
  ON public.visit_source_events (site_id, visit_id);

CREATE INDEX IF NOT EXISTS idx_visit_source_events_site_visitor_created_at
  ON public.visit_source_events (site_id, visitor_id, created_at DESC);

-- 2) Telemetry for non-blocking ingest observability
CREATE TABLE IF NOT EXISTS public.tracking_ingest_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  site_id text NULL,
  severity text NOT NULL DEFAULT 'error',
  event_name text NULL,
  reason_code text NOT NULL,
  message text NULL,
  payload jsonb NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_ingest_telemetry_created_at
  ON public.tracking_ingest_telemetry (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_ingest_telemetry_endpoint_created_at
  ON public.tracking_ingest_telemetry (endpoint, created_at DESC);

ALTER TABLE public.tracking_ingest_telemetry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Fresh DBs may not have system_user_roles yet at this migration point.
  -- Create the policy only when the dependency table exists.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'system_user_roles'
      AND c.relkind = 'r'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tracking_ingest_telemetry'
      AND policyname = 'tracking_ingest_telemetry_select_admin'
  ) THEN
    CREATE POLICY tracking_ingest_telemetry_select_admin
      ON public.tracking_ingest_telemetry
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.system_user_roles sur
          WHERE sur.user_id = auth.uid()
            AND sur.role IN ('service_admin', 'support', 'ops_manager')
        )
      );
  END IF;
END $$;

-- 3) Atomic redirect logging + click counter increment
CREATE OR REPLACE FUNCTION public.log_redirect_click_and_increment(
  p_link_id uuid,
  p_project_id uuid,
  p_bq_click_id text,
  p_destination_url text,
  p_full_url text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_utm_content text,
  p_utm_term text,
  p_utm_id text,
  p_campaign_intent text,
  p_fbclid text,
  p_gclid text,
  p_ttclid text,
  p_yclid text,
  p_referrer text,
  p_user_agent text,
  p_ip text,
  p_fbp text,
  p_fbc text,
  p_fingerprint_hash text,
  p_traffic_source text,
  p_traffic_platform text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.redirect_click_events (
    project_id,
    redirect_link_id,
    bq_click_id,
    destination_url,
    full_url,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    utm_id,
    campaign_intent,
    fbclid,
    gclid,
    ttclid,
    yclid,
    referrer,
    user_agent,
    ip,
    fbp,
    fbc,
    fingerprint_hash,
    traffic_source,
    traffic_platform
  ) VALUES (
    p_project_id,
    p_link_id,
    p_bq_click_id,
    p_destination_url,
    p_full_url,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    p_utm_content,
    p_utm_term,
    p_utm_id,
    p_campaign_intent,
    p_fbclid,
    p_gclid,
    p_ttclid,
    p_yclid,
    p_referrer,
    p_user_agent,
    p_ip,
    p_fbp,
    p_fbc,
    p_fingerprint_hash,
    p_traffic_source,
    p_traffic_platform
  );

  UPDATE public.redirect_links
  SET clicks_count = COALESCE(clicks_count, 0) + 1,
      last_click_at = now()
  WHERE id = p_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_redirect_click_and_increment(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;

-- 4) Retention cleanup function (invoked by internal cron)
CREATE OR REPLACE FUNCTION public.cleanup_old_tracking_data(
  p_conversion_days integer DEFAULT 365,
  p_visit_days integer DEFAULT 180,
  p_redirect_days integer DEFAULT 365,
  p_telemetry_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_deleted integer := 0;
  v_visit_deleted integer := 0;
  v_redirect_deleted integer := 0;
  v_telemetry_deleted integer := 0;
BEGIN
  DELETE FROM public.conversion_events
  WHERE created_at < now() - make_interval(days => p_conversion_days);
  GET DIAGNOSTICS v_conv_deleted = ROW_COUNT;

  DELETE FROM public.visit_source_events
  WHERE created_at < now() - make_interval(days => p_visit_days);
  GET DIAGNOSTICS v_visit_deleted = ROW_COUNT;

  DELETE FROM public.redirect_click_events
  WHERE created_at < now() - make_interval(days => p_redirect_days);
  GET DIAGNOSTICS v_redirect_deleted = ROW_COUNT;

  DELETE FROM public.tracking_ingest_telemetry
  WHERE created_at < now() - make_interval(days => p_telemetry_days);
  GET DIAGNOSTICS v_telemetry_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'conversion_events_deleted', v_conv_deleted,
    'visit_source_events_deleted', v_visit_deleted,
    'redirect_click_events_deleted', v_redirect_deleted,
    'tracking_ingest_telemetry_deleted', v_telemetry_deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_old_tracking_data(integer, integer, integer, integer)
  TO service_role;

