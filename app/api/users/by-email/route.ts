import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * GET /api/users/by-email?email=...
 * Returns { success: true, user: { id, email } } or { success: false, error: "not_found" }.
 * Requires authenticated user (any logged-in user can look up by email for add-member flow).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim()?.toLowerCase();

  if (!email) {
    return NextResponse.json({ success: false, error: "email required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  if (!currentUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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
