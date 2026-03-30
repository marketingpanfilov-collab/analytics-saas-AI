/**
 * AbortSignal / fetch cancellation helpers.
 * Next.js dev overlay can flag "Signal is aborted…" if rejections are unhandled or abort() has no explicit reason.
 */

export function isAbortError(e: unknown, depth = 0): boolean {
  if (depth > 12 || e == null) return false;

  if (typeof e === "object" && e !== null && "errors" in e && Array.isArray((e as AggregateError).errors)) {
    for (const sub of (e as AggregateError).errors) {
      if (isAbortError(sub, depth + 1)) return true;
    }
  }

  let cur: unknown = e;
  for (let walk = 0; walk < 10 && cur != null; walk++) {
    if (typeof cur !== "object") break;
    const o = cur as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    const message = typeof o.message === "string" ? o.message : String(o.message ?? "");
    const code = o.code;
    if (name === "AbortError") return true;
    const codeNum = typeof code === "number" ? code : Number(code);
    const codeStr = typeof code === "string" ? code : "";
    if (name === "DOMException" && (codeNum === 20 || codeStr === "AbortError" || /abort/i.test(message))) return true;
    if (
      /aborted|signal is aborted|without reason|cancelled|canceled|operation was aborted|user aborted a request/i.test(
        message
      )
    ) {
      return true;
    }
    cur = o.cause;
  }
  return false;
}

export function safeAbortController(c: AbortController | null | undefined): void {
  if (!c) return;
  try {
    if (c.signal.aborted) return;
    // No custom reason: a DOMException message becomes the Next.js dev overlay headline.
    c.abort();
  } catch {
    /* ignore */
  }
}

/** Use with `void` fire-and-forget promises so abort never surfaces as unhandled rejection in dev. */
export function ignoreAbortRejection(p: Promise<unknown>, label?: string): void {
  void p.catch((e: unknown) => {
    if (isAbortError(e)) return;
    if (label) console.warn(`[${label}]`, e);
  });
}
