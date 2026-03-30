import { NextResponse } from "next/server";
import { deleteCanonicalIntegrationById } from "@/app/lib/disconnectCanonicalIntegration";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId =
    typeof (body as Record<string, unknown>)?.project_id === "string"
      ? ((body as Record<string, unknown>).project_id as string).trim()
      : "";

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (!integration?.id) {
    return NextResponse.json({ success: true, disconnected: true, message: "Already disconnected" });
  }

  const { error: delErr } = await deleteCanonicalIntegrationById(admin, integration.id);
  if (delErr) {
    return NextResponse.json({ success: false, error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    disconnected: true,
    message: "TikTok integration disconnected.",
  });
}
