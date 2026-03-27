import { NextResponse } from "next/server";
import { requireOrgAdminOrSystemRole } from "@/app/lib/auth/requireOrgAdminOrSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

/**
 * GET /api/users/by-email?email=...
 * Returns { success: true, user: { id, email } } or { success: false, error: "not_found" }.
 * Requires either:
 * - organization owner/admin, or
 * - internal system role (service_admin/support/ops_manager).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim()?.toLowerCase();

  if (!email) {
    return NextResponse.json({ success: false, error: "email required" }, { status: 400 });
  }

  const access = await requireOrgAdminOrSystemRole();
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`users:by-email:${access.userId}:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const admin = supabaseAdmin();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) {
      return NextResponse.json({
        success: true,
        user: { id: found.id, email: found.email ?? null },
      });
    }
    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break; // safety cap
  }

  return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
}
