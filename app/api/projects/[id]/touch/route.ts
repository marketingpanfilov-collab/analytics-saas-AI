import { NextResponse } from "next/server";

import { createServerSupabase } from "@/app/lib/supabaseServer";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = (await params).id?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: "Project ID required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("projects")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
