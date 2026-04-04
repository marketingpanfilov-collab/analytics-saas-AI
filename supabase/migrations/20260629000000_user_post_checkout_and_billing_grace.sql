-- Post-checkout onboarding (BoardIQ billing lifecycle) + optional subscription grace window.

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS grace_until timestamptz;

COMMENT ON COLUMN public.billing_subscriptions.grace_until IS
  'Optional product grace end for past_due (soft access). Set by webhook or reconcile job.';

CREATE TABLE IF NOT EXISTS public.user_post_checkout_onboarding (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step smallint NOT NULL DEFAULT 1,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_post_checkout_onboarding_step_check CHECK (current_step >= 1 AND current_step <= 3)
);

CREATE INDEX IF NOT EXISTS idx_user_post_checkout_completed_at
  ON public.user_post_checkout_onboarding (completed_at);

COMMENT ON TABLE public.user_post_checkout_onboarding IS
  'Mandatory post-checkout modal progress (per user). completed_at null = flow not finished.';

-- Existing Paddle payers: treat onboarding as already completed (no blocking modal on deploy).
INSERT INTO public.user_post_checkout_onboarding (user_id, current_step, completed_at, updated_at)
SELECT DISTINCT bcm.user_id, 3, now(), now()
FROM public.billing_customer_map bcm
WHERE bcm.user_id IS NOT NULL
  AND bcm.provider = 'paddle'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.user_post_checkout_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_post_checkout_select_own ON public.user_post_checkout_onboarding;

CREATE POLICY user_post_checkout_select_own
  ON public.user_post_checkout_onboarding
  FOR SELECT
  USING (auth.uid() = user_id);
