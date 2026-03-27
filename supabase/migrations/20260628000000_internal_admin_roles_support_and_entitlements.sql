-- Internal admin foundation:
-- - system roles (service_admin, support, ops_manager)
-- - support tickets
-- - billing entitlements (admin overrides above provider status)

CREATE TABLE IF NOT EXISTS public.system_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('service_admin', 'support', 'ops_manager')),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_system_user_roles_user_id ON public.system_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_system_user_roles_role ON public.system_user_roles(role);

CREATE TABLE IF NOT EXISTS public.system_role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text CHECK (role IN ('service_admin', 'support', 'ops_manager')),
  action text NOT NULL CHECK (action IN ('grant', 'revoke', 'create_user')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_role_audit_log_created_at
  ON public.system_role_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no bigserial UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('user', 'support', 'ops_manager', 'service_admin', 'system')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id
  ON public.support_ticket_messages(ticket_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.support_ticket_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('create', 'status_change', 'priority_change', 'reply')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_audit_log_ticket_id
  ON public.support_ticket_audit_log(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_override text CHECK (plan_override IN ('starter', 'growth', 'agency')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason text,
  source text NOT NULL DEFAULT 'admin_grant' CHECK (source IN ('admin_grant', 'admin_revoke', 'promo')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_user_id ON public.billing_entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_entitlements_status ON public.billing_entitlements(status);
CREATE INDEX IF NOT EXISTS idx_billing_entitlements_ends_at ON public.billing_entitlements(ends_at);

CREATE TABLE IF NOT EXISTS public.billing_entitlement_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entitlement_id uuid REFERENCES public.billing_entitlements(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('grant', 'revoke', 'expire', 'update')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_entitlement_audit_created_at
  ON public.billing_entitlement_audit_log(created_at DESC);

ALTER TABLE public.system_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_role_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_entitlement_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.system_user_roles IS 'Internal service roles for backoffice access.';
COMMENT ON TABLE public.support_tickets IS 'User support tickets for support team queue.';
COMMENT ON TABLE public.billing_entitlements IS 'Admin-issued access overrides layered over provider subscriptions.';
