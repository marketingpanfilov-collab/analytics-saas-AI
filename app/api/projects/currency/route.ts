import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

const ALLOWED_CURRENCIES = ["USD", "KZT"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
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

  const { data: proj, error } = await supabase
    .from("projects")
    .select("id, currency")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!proj) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, currency: proj.currency ?? "USD" });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { project_id?: string; currency?: string };
  const projectId = body.project_id?.trim();
  const currency = body.currency?.trim().toUpperCase();

  if (!projectId || !currency) {
    return NextResponse.json(
      { success: false, error: "project_id and currency required" },
      { status: 400 }
    );
  }
  if (!ALLOWED_CURRENCIES.includes(currency)) {
    return NextResponse.json(
      { success: false, error: "Unsupported currency" },
      { status: 400 }
    );
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

  // allow only owner/admin/project_admin (same as other project-level mutations)
  if (!["owner", "admin", "project_admin"].includes(access.role)) {
    return NextResponse.json({ success: false, error: "Not allowed to edit project" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("projects")
    .update({ currency })
    .eq("id", projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, currency });
}

