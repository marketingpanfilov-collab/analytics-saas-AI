-- Repair existing databases: ensure ON CONFLICT (site_id, visit_id) can infer
-- a non-partial unique index for visit_source_events upsert.

DROP INDEX IF EXISTS public.uq_visit_source_events_site_visit_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_source_events_site_visit_id
  ON public.visit_source_events (site_id, visit_id);

