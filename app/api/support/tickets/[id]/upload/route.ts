import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  ALLOWED_TYPES,
  MAX_BYTES,
  SUPPORT_ATTACHMENTS_BUCKET,
  attachmentPathPrefix,
  safeAttachmentFileName,
} from "@/app/lib/supportAttachments";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

type Params = { params: Promise<{ id: string }> };

function fileAllowed(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t && ALLOWED_TYPES.has(t)) return true;
  const n = file.name.toLowerCase();
  return n.endsWith(".zip");
}

export async function POST(req: Request, { params }: Params) {
  const { id: ticketId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: ticket } = await admin.from("support_tickets").select("id, user_id").eq("id", ticketId).maybeSingle();
  if (!ticket?.id) return NextResponse.json({ success: false, error: "ticket not found" }, { status: 404 });
  if (ticket.user_id !== user.id) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  const { data: trow } = await admin.from("support_tickets").select("status").eq("id", ticketId).maybeSingle();
  if (String(trow?.status ?? "").toLowerCase() === "closed") {
    return NextResponse.json({ success: false, error: "ticket is closed" }, { status: 400 });
  }

  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`support:upload:${user.id}:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: "invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ success: false, error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: "file too large (max 10 MB)" }, { status: 400 });
  }
  if (!fileAllowed(file)) {
    return NextResponse.json({ success: false, error: "unsupported file type" }, { status: 400 });
  }

  const safeName = safeAttachmentFileName(file.name);
  const objectPath = `${attachmentPathPrefix(user.id, ticketId)}${randomUUID()}_${safeName}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";

  const { error: upErr } = await admin.storage.from(SUPPORT_ATTACHMENTS_BUCKET).upload(objectPath, buf, {
    contentType,
    upsert: false,
  });

  if (upErr) {
    return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    file: {
      path: objectPath,
      name: safeName,
      size: file.size,
      content_type: contentType,
    },
  });
}
