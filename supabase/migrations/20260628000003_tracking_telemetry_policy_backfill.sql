-- Backfill policy creation for environments where tracking hardening migration
-- ran before system_user_roles existed.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'tracking_ingest_telemetry'
      AND c.relkind = 'r'
  )
  AND EXISTS (
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

