import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";

export type StoredAttachment = {
  path: string;
  name: string;
  size: number;
  content_type?: string;
};

export type AttachmentWithUrl = StoredAttachment & { url: string };

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

export function safeAttachmentFileName(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "file";
  return base.slice(0, 120);
}

export function attachmentPathPrefix(userId: string, ticketId: string): string {
  return `${userId}/${ticketId}/`;
}

/** Reject paths that are not under this user's folder for this ticket. */
export function validateAttachmentPathsForUserTicket(
  userId: string,
  ticketId: string,
  raw: unknown
): { ok: true; items: StoredAttachment[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, items: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments must be an array" };
  if (raw.length > MAX_ATTACHMENTS) return { ok: false, error: `max ${MAX_ATTACHMENTS} attachments` };

  const prefix = attachmentPathPrefix(userId, ticketId);
  const items: StoredAttachment[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "invalid attachment" };
    const o = entry as Record<string, unknown>;
    const path = String(o.path ?? "").trim();
    const name = String(o.name ?? "").trim();
    const size = Number(o.size);
    const content_type = o.content_type != null ? String(o.content_type) : undefined;

    if (!path.startsWith(prefix)) return { ok: false, error: "invalid attachment path" };
    if (path.includes("..") || path.includes("//")) return { ok: false, error: "invalid attachment path" };
    if (!name) return { ok: false, error: "attachment name required" };
    if (!Number.isFinite(size) || size < 0 || size > MAX_BYTES) return { ok: false, error: "invalid attachment size" };

    items.push({ path, name, size, content_type });
  }

  return { ok: true, items };
}

export async function signSupportAttachments(
  admin: SupabaseClient,
  list: unknown,
  expiresInSec = 86400
): Promise<AttachmentWithUrl[]> {
  if (!Array.isArray(list) || list.length === 0) return [];

  const out: AttachmentWithUrl[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const path = String(o.path ?? "").trim();
    const name = String(o.name ?? "file");
    const size = Number(o.size) || 0;
    const content_type = o.content_type != null ? String(o.content_type) : undefined;
    if (!path) continue;

    const { data, error } = await admin.storage
      .from(SUPPORT_ATTACHMENTS_BUCKET)
      .createSignedUrl(path, expiresInSec);
    if (error || !data?.signedUrl) continue;

    out.push({ path, name, size, content_type, url: data.signedUrl });
  }
  return out;
}

export { MAX_ATTACHMENTS, MAX_BYTES, ALLOWED_TYPES };
