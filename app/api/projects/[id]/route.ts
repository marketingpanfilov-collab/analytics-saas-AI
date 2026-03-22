import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { canRenameProject } from "@/app/lib/auth/projectPermissions";

const NAME_MAX_LENGTH = 256;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = (await params).id?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: "Project ID required" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ success: false, error: "Name is required" }, { status: 400 });
  }
  if (name.length > NAME_MAX_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Name must be at most ${NAME_MAX_LENGTH} characters` },
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
  if (!canRenameProject(access.role)) {
    return NextResponse.json(
      { success: false, error: "You do not have permission to rename this project" },
      { status: 403 }
    );
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("projects")
    .update({ name })
    .eq("id", projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
