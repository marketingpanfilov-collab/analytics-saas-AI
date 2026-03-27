# Internal Admin Smoke Checklist

Run this checklist after deploying migrations and app changes.

## 1) Access boundaries
- Non-auth user cannot open `/app/internal-admin/support` (redirect to `/login`).
- Authenticated user without system role cannot open `/app/internal-admin/*` (redirect to `/app`).
- `support` role can open `/app/internal-admin/support` only.
- `service_admin` can open support/billing/users sections.

## 2) Support flow
- User can create ticket at `/app/support`.
- User sees own ticket list only.
- User opens ticket thread and sends message.
- Internal support sees new ticket and thread.
- Internal support reply moves ticket status from `open` to `in_progress`.
- Reply to `closed` ticket is rejected for both user and support.

## 3) Billing entitlements
- `service_admin` can grant entitlement for target user.
- `current-plan` resolves entitlement first (effective plan changes immediately).
- `service_admin` can revoke active entitlement.
- Entitlement history list is visible in billing internal UI.

## 4) User roles
- `service_admin` can create new user with initial role.
- If role assignment fails, auth user is not left orphaned.
- Grant/revoke role works for existing user.
- System prevents revoking the last `service_admin`.

## 5) Rate limiting
- Burst repeated calls to internal role/billing endpoints returns `429`.
- User ticket create/reply endpoints return `429` on excessive spam.

