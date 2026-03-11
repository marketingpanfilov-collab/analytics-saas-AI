import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const ORG_ROLES_ALLOWED = ["owner", "admin"];

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: myMem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!myMem) {
    return NextResponse.json({ success: false, error: "No organization membership" }, { status: 403 });
  }

  const myRole = (myMem.role ?? "member") as string;
  if (!ORG_ROLES_ALLOWED.includes(myRole)) {
    return NextResponse.json({ success: false, error: "Only owner or admin can view org members" }, { status: 403 });
  }

  const { data: rows, error } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, created_at")
    .eq("organization_id", myMem.organization_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const admin = supabaseAdmin();
  const members = await Promise.all(
    (rows ?? []).map(async (row: { id: string; organization_id: string; user_id: string; role: string; created_at: string }) => {
      let email: string | null = null;
      try {
        const { data: u } = await admin.auth.admin.getUserById(row.user_id);
        email = u?.user?.email ?? null;
      } catch {
        // leave email null
      }
      return {
        id: row.id,
        organization_id: row.organization_id,
        user_id: row.user_id,
        role: row.role,
        created_at: row.created_at,
        email,
      };
    })
  );

  return NextResponse.json({ success: true, members });
}
