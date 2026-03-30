/**
 * Facebook Graph GET with limited retries on transient errors (rate limits, 5xx).
 * Invalid/expired tokens (e.g. OAuth 190) are not retried.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type GraphErrorBody = { error?: { code?: number; message?: string; error_subcode?: number } };

export type MetaGraphJsonResult =
  | { ok: true; json: unknown; httpStatus: number }
  | { ok: false; json: unknown; httpStatus: number; kind: "transient" | "permanent" };

function classifyGraphError(err: { code?: number; message?: string; error_subcode?: number }): "transient" | "permanent" {
  const code = Number(err.code);
  const sub = Number(err.error_subcode);
  if (code === 190 || code === 102) return "permanent";
  if (code === 459 || sub === 458) return "permanent";
  if ([4, 17, 32, 613, 80004, 80007, 80008].includes(code)) return "transient";
  if (code === 1 && /please reduce|too many|rate limit/i.test(String(err.message ?? ""))) return "transient";
  return "permanent";
}

/**
 * GET url (typically graph.facebook.com) and parse JSON. Retries on HTTP 429/5xx/408 and known Graph rate-limit codes.
 */
export async function fetchMetaGraphGetJsonWithRetry(
  url: string,
  opts?: { maxAttempts?: number; initialDelayMs?: number }
): Promise<MetaGraphJsonResult> {
  const maxAttempts = Math.min(6, Math.max(1, opts?.maxAttempts ?? 4));
  const initialDelayMs = opts?.initialDelayMs ?? 400;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch(url);
    const txt = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(txt) as GraphErrorBody;
    } catch {
      json = { error: { message: txt } };
    }

    const err = (json as GraphErrorBody)?.error;
    if (!err && r.ok) {
      return { ok: true, json, httpStatus: r.status };
    }

    if (err) {
      const kind = classifyGraphError(err);
      if (kind === "transient" && attempt < maxAttempts) {
        await sleep(initialDelayMs * attempt);
        continue;
      }
      return { ok: false, json, httpStatus: r.status, kind };
    }

    if (r.status === 429 || r.status === 408 || (r.status >= 500 && r.status <= 599)) {
      if (attempt < maxAttempts) {
        await sleep(initialDelayMs * attempt);
        continue;
      }
      return { ok: false, json, httpStatus: r.status, kind: "transient" };
    }

    return { ok: false, json, httpStatus: r.status, kind: "permanent" };
  }

  return { ok: false, json: {}, httpStatus: 0, kind: "transient" };
}
