-- Strict RLS policies for internal admin and support entities.
-- This keeps direct client access locked down even if someone tries querying tables manually.

CREATE OR REPLACE FUNCTION public.has_system_role(_role text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.system_user_roles r
    WHERE r.user_id = auth.uid()
      AND r.role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_system_role(_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.system_user_roles r
    WHERE r.user_id = auth.uid()
      AND r.role = ANY(_roles)
  );
$$;

DROP POLICY IF EXISTS p_support_tickets_user_select ON public.support_tickets;
CREATE POLICY p_support_tickets_user_select
ON public.support_tickets
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_any_system_role(ARRAY['service_admin','support','ops_manager']::text[])
);

DROP POLICY IF EXISTS p_support_tickets_user_insert ON public.support_tickets;
CREATE POLICY p_support_tickets_user_insert
ON public.support_tickets
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_support_tickets_support_update ON public.support_tickets;
CREATE POLICY p_support_tickets_support_update
ON public.support_tickets
FOR UPDATE
TO authenticated
USING (public.has_any_system_role(ARRAY['service_admin','support','ops_manager']::text[]))
WITH CHECK (public.has_any_system_role(ARRAY['service_admin','support','ops_manager']::text[]));

DROP POLICY IF EXISTS p_support_ticket_messages_select ON public.support_ticket_messages;
CREATE POLICY p_support_ticket_messages_select
ON public.support_ticket_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.support_tickets t
    WHERE t.id = support_ticket_messages.ticket_id
      AND (t.user_id = auth.uid() OR public.has_any_system_role(ARRAY['service_admin','support','ops_manager']::text[]))
  )
);

DROP POLICY IF EXISTS p_support_ticket_messages_user_insert ON public.support_ticket_messages;
CREATE POLICY p_support_ticket_messages_user_insert
ON public.support_ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (
  (
    sender_user_id = auth.uid()
    AND sender_role = 'user'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_ticket_messages.ticket_id
        AND t.user_id = auth.uid()
    )
  )
  OR (
    public.has_any_system_role(ARRAY['service_admin','support','ops_manager']::text[])
    AND sender_role IN ('support','ops_manager','service_admin','system')
  )
);

DROP POLICY IF EXISTS p_billing_entitlements_admin_all ON public.billing_entitlements;
CREATE POLICY p_billing_entitlements_admin_all
ON public.billing_entitlements
FOR ALL
TO authenticated
USING (public.has_system_role('service_admin'))
WITH CHECK (public.has_system_role('service_admin'));

DROP POLICY IF EXISTS p_system_user_roles_admin_all ON public.system_user_roles;
CREATE POLICY p_system_user_roles_admin_all
ON public.system_user_roles
FOR ALL
TO authenticated
USING (public.has_system_role('service_admin'))
WITH CHECK (public.has_system_role('service_admin'));

DROP POLICY IF EXISTS p_system_role_audit_log_admin_select ON public.system_role_audit_log;
CREATE POLICY p_system_role_audit_log_admin_select
ON public.system_role_audit_log
FOR SELECT
TO authenticated
USING (public.has_system_role('service_admin'));

DROP POLICY IF EXISTS p_billing_entitlement_audit_log_admin_select ON public.billing_entitlement_audit_log;
CREATE POLICY p_billing_entitlement_audit_log_admin_select
ON public.billing_entitlement_audit_log
FOR SELECT
TO authenticated
USING (public.has_system_role('service_admin'));

DROP POLICY IF EXISTS p_support_ticket_audit_log_support_select ON public.support_ticket_audit_log;
CREATE POLICY p_support_ticket_audit_log_support_select
ON public.support_ticket_audit_log
FOR SELECT
TO authenticated
USING (public.has_any_system_role(ARRAY['service_admin','support','ops_manager']::text[]));

