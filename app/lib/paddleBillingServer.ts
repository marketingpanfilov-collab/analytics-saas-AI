/**
 * Server-side Paddle Billing API (Bearer). Used for subscription preview/update — not Paddle.js checkout.
 */
function getPaddleBillingApiBase(): string {
  const explicit = process.env.PADDLE_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.PADDLE_BILLING_ENV === "sandbox" || process.env.NEXT_PUBLIC_PADDLE_ENV === "sandbox") {
    return "https://sandbox-api.paddle.com";
  }
  return "https://api.paddle.com";
}

export type PaddleApiErrorBody = { error?: { type?: string; detail?: string; code?: string } };

export async function paddleBillingRequest<T = unknown>(
  method: "GET" | "PATCH",
  path: string,
  jsonBody?: unknown,
  options?: { idempotencyKey?: string }
): Promise<{ ok: true; data: T } | { ok: false; status: number; text: string; json?: PaddleApiErrorBody }> {
  const key = process.env.PADDLE_SERVER_API_KEY?.trim();
  if (!key) {
    return { ok: false, status: 500, text: "PADDLE_SERVER_API_KEY is not configured" };
  }
  const base = getPaddleBillingApiBase();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const idem = options?.idempotencyKey?.trim();
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
  };
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      text: text.slice(0, 2000),
      json: (parsed && typeof parsed === "object" ? parsed : undefined) as PaddleApiErrorBody | undefined,
    };
  }
  const data = (parsed as { data?: T })?.data ?? (parsed as T);
  return { ok: true, data: data as T };
}

/** Paddle Billing: proration for upgrades — immediate charge/credit on a transaction (see preview response). */
export const PADDLE_UPGRADE_PRORATION_MODE = "prorated_immediately" as const;
