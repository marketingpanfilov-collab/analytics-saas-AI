-- Redirect links: denormalized click counter and last click time for fast UI.
ALTER TABLE public.redirect_links
  ADD COLUMN IF NOT EXISTS clicks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_click_at timestamptz;

-- Redirect click events: fingerprint for antifraud and dedup (sha256(ip + user_agent)).
ALTER TABLE public.redirect_click_events
  ADD COLUMN IF NOT EXISTS fingerprint_hash text;

CREATE INDEX IF NOT EXISTS idx_redirect_click_events_fingerprint_hash
  ON public.redirect_click_events(fingerprint_hash);

COMMENT ON COLUMN public.redirect_links.clicks_count IS 'Incremented on each redirect; used for UI without aggregation.';
COMMENT ON COLUMN public.redirect_links.last_click_at IS 'Updated on each redirect.';
COMMENT ON COLUMN public.redirect_click_events.fingerprint_hash IS 'sha256(ip + user_agent) for antifraud and deduplication.';

-- Atomic increment for redirect_links click counter (called from redirect handler).
CREATE OR REPLACE FUNCTION public.increment_redirect_link_clicks(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.redirect_links
  SET clicks_count = clicks_count + 1,
      last_click_at = now()
  WHERE id = p_link_id;
$$;
