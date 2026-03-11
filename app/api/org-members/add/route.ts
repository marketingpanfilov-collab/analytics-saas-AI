import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const ORG_ROLES_ALLOWED = ["owner", "admin"];
const ADDABLE_ROLES = ["admin", "agency", "member"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = ADDABLE_ROLES.includes(body.role) ? body.role : "member";

  if (!email) {
    return NextResponse.json({ success: false, error: "email required" }, { status: 400 });
  }

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
    return NextResponse.json({ success: false, error: "Only owner or admin can add members" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  let page = 1;
  const perPage = 100;
  let foundUserId: string | null = null;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) {
      foundUserId = found.id;
      break;
    }
    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break;
  }

  if (!foundUserId) {
    return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 });
  }

  const { error: insertErr } = await admin
    .from("organization_members")
    .insert({
      organization_id: myMem.organization_id,
      user_id: foundUserId,
      role,
    });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ success: false, error: "Пользователь уже добавлен в организацию" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
