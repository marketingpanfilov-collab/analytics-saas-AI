-- V14: Share links for weekly board report (open link with revoke).
-- One active share per (project_id, report_type). Snapshot stored in report_snapshot (live-render fallback by period_end_iso).

CREATE TABLE IF NOT EXISTS public.report_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  report_type text NOT NULL DEFAULT 'weekly_board_report',
  period_end_iso timestamptz NOT NULL,
  report_snapshot jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_share_links_token ON public.report_share_links(token);
CREATE INDEX IF NOT EXISTS idx_report_share_links_project_type_active
  ON public.report_share_links(project_id, report_type) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.report_share_links IS 'V14: Public share links for reports. Readonly access by token; revokable. report_snapshot = frozen report JSON.';
