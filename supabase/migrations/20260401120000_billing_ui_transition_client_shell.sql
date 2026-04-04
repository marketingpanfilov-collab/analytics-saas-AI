-- Allow client-side shell transition logging (P1-RUN-05) after stabilization / dedup path.
ALTER TABLE public.billing_ui_state_transitions
  DROP CONSTRAINT IF EXISTS billing_ui_state_transitions_source_check;

ALTER TABLE public.billing_ui_state_transitions
  ADD CONSTRAINT billing_ui_state_transitions_source_check
  CHECK (source IN ('bootstrap', 'user_action', 'webhook', 'multitab', 'client_shell'));
