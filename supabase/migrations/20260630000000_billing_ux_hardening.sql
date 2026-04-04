-- Billing UX hardening: pending plan flag on customer map + UI transition audit log.

ALTER TABLE public.billing_customer_map
  ADD COLUMN IF NOT EXISTS pending_plan_change boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.billing_customer_map.pending_plan_change IS
  'Set by webhook/job when upgrade initiated and effective_plan not yet consistent; cleared when snapshot matches. §13.1: suppressed in API when billing is not green.';

CREATE TABLE IF NOT EXISTS public.billing_ui_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid,
  prev_screen text,
  prev_reason text,
  next_screen text NOT NULL,
  next_reason text NOT NULL,
  request_id text NOT NULL,
  version text NOT NULL,
  source text NOT NULL CHECK (source IN ('bootstrap', 'user_action', 'webhook', 'multitab')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_ui_transitions_user_created
  ON public.billing_ui_state_transitions (user_id, created_at DESC);

COMMENT ON TABLE public.billing_ui_state_transitions IS
  'log_ui_state_transition (§14.3); dedup in app for identical screen+reason within few seconds.';
