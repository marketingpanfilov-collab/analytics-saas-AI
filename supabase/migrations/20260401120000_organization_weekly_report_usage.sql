-- Организационный лимит weekly board report для Starter (счётчик по UTC-календарному месяцу).
-- Идемпотентность: UNIQUE(organization_id, idempotency_key) — без двойного списания при ретраях.

CREATE TABLE IF NOT EXISTS public.organization_weekly_report_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  usage_month_utc text NOT NULL,
  idempotency_key text NOT NULL,
  project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'generated',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_weekly_report_usage_idem UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_org_weekly_report_usage_month
  ON public.organization_weekly_report_usage (organization_id, usage_month_utc);

COMMENT ON TABLE public.organization_weekly_report_usage IS 'Успешные генерации weekly board report; лимит на organization_id, месяц UTC.';

ALTER TABLE public.organization_weekly_report_usage ENABLE ROW LEVEL SECURITY;

-- Атомарное списание с блокировкой по org+месяц (без гонок 9/10 → 11).
CREATE OR REPLACE FUNCTION public.consume_org_weekly_report_usage(
  p_organization_id uuid,
  p_usage_month_utc text,
  p_idempotency_key text,
  p_project_id uuid,
  p_limit int,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'unlimited');
  END IF;

  PERFORM pg_advisory_xact_lock(
    842901,
    hashtext(p_organization_id::text || ':' || p_usage_month_utc)
  );

  IF EXISTS (
    SELECT 1 FROM public.organization_weekly_report_usage
    WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT COUNT(*)::int INTO v_count
    FROM public.organization_weekly_report_usage
    WHERE organization_id = p_organization_id AND usage_month_utc = p_usage_month_utc;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'used', v_count);
  END IF;

  SELECT COUNT(*)::int INTO v_count
  FROM public.organization_weekly_report_usage
  WHERE organization_id = p_organization_id AND usage_month_utc = p_usage_month_utc;

  IF v_count >= p_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'WEEKLY_REPORT_LIMIT_REACHED',
      'used', v_count,
      'limit', p_limit
    );
  END IF;

  INSERT INTO public.organization_weekly_report_usage (
    organization_id, usage_month_utc, idempotency_key, project_id, action, metadata
  ) VALUES (
    p_organization_id, p_usage_month_utc, p_idempotency_key, p_project_id, 'generated', COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'used', v_count + 1, 'limit', p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_org_weekly_report_usage(uuid, text, text, uuid, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_org_weekly_report_usage(uuid, text, text, uuid, int, jsonb) TO service_role;
