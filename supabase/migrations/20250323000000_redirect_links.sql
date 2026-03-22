-- Redirect service: links and click events for UTM/click tracking and attribution.

-- Links created in UTM Builder (one row per saved link).
CREATE TABLE IF NOT EXISTS public.redirect_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token text NOT NULL,
  destination_url text NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_redirect_links_project_id ON public.redirect_links(project_id);
CREATE INDEX IF NOT EXISTS idx_redirect_links_token ON public.redirect_links(token);
CREATE INDEX IF NOT EXISTS idx_redirect_links_created_at ON public.redirect_links(project_id, created_at DESC);

-- One row per redirect (click) for attribution and analytics.
CREATE TABLE IF NOT EXISTS public.redirect_click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  redirect_link_id uuid REFERENCES public.redirect_links(id) ON DELETE SET NULL,
  bq_click_id text NOT NULL,
  destination_url text NOT NULL,
  full_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  ttclid text,
  yclid text,
  referrer text,
  user_agent text,
  ip text,
  fbp text,
  fbc text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redirect_click_events_project_id ON public.redirect_click_events(project_id);
CREATE INDEX IF NOT EXISTS idx_redirect_click_events_redirect_link_id ON public.redirect_click_events(redirect_link_id);
CREATE INDEX IF NOT EXISTS idx_redirect_click_events_bq_click_id ON public.redirect_click_events(bq_click_id);
CREATE INDEX IF NOT EXISTS idx_redirect_click_events_created_at ON public.redirect_click_events(created_at);

COMMENT ON TABLE public.redirect_links IS 'Saved UTM/redirect links from UTM Builder. Token used in /r/{token} URL.';
COMMENT ON TABLE public.redirect_click_events IS 'One row per redirect (click). bq_click_id (bqcid) is passed to destination and used by pixel/conversion for attribution.';
