/**
 * Идемпотентность apply апгрейда: Supabase (source of truth) + L1 in-memory (скорость на инстансе).
 * Ключ: subscription_id | target_price_id | idempotency_key (клиентский UUID v4).
 */

import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const SETTLED_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 350;
const POLL_MAX_ATTEMPTS = 75;

type SettledL1 = { at: number; statusCode: number; body: Record<string, unknown> };

const settledL1 = new Map<string, SettledL1>();
const inflightL1 = new Map<string, Promise<{ statusCode: number; body: Record<string, unknown> }>>();

function pruneL1(): void {
  const now = Date.now();
  for (const [k, v] of settledL1) {
    if (now - v.at > SETTLED_TTL_MS) settledL1.delete(k);
  }
}

export function makeBillingApplyCompositeKey(
  subscriptionId: string,
  targetPriceId: string,
  clientIdempotencyKey: string
): string {
  return `${subscriptionId}|${targetPriceId}|${clientIdempotencyKey}`;
}

const IN_PROGRESS_BODY: Record<string, unknown> = {
  success: false,
  apply_status: "in_progress",
  error:
    "Обновление подписки уже выполняется. Подождите несколько секунд и повторите запрос с тем же idempotency_key.",
};

type IdemRow = {
  status: string;
  response_json: Record<string, unknown> | null;
  http_status: number | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "23505") return true;
  return String(err.message ?? "").toLowerCase().includes("duplicate");
}

async function deleteExpiredForKey(
  admin: ReturnType<typeof supabaseAdmin>,
  subscriptionId: string,
  targetPriceId: string,
  idempotencyKey: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("billing_idempotency_keys")
    .delete()
    .eq("subscription_id", subscriptionId)
    .eq("target_price_id", targetPriceId)
    .eq("idempotency_key", idempotencyKey)
    .lt("expires_at", nowIso);
}

async function selectActiveRow(
  admin: ReturnType<typeof supabaseAdmin>,
  subscriptionId: string,
  targetPriceId: string,
  idempotencyKey: string
): Promise<IdemRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("billing_idempotency_keys")
    .select("status, response_json, http_status")
    .eq("subscription_id", subscriptionId)
    .eq("target_price_id", targetPriceId)
    .eq("idempotency_key", idempotencyKey)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as IdemRow;
}

function rowToResponse(row: IdemRow): { statusCode: number; body: Record<string, unknown> } {
  const body =
    row.response_json && typeof row.response_json === "object"
      ? { ...row.response_json }
      : { success: false, error: "Пустой кэш идемпотентности." };
  return { statusCode: row.http_status ?? 500, body };
}

async function pollUntilSettled(
  admin: ReturnType<typeof supabaseAdmin>,
  subscriptionId: string,
  targetPriceId: string,
  idempotencyKey: string
): Promise<{ statusCode: number; body: Record<string, unknown> } | null> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const row = await selectActiveRow(admin, subscriptionId, targetPriceId, idempotencyKey);
    if (!row) return null;
    if (row.status === "completed" || row.status === "failed") {
      return rowToResponse(row);
    }
  }
  return null;
}

async function insertInProgress(
  admin: ReturnType<typeof supabaseAdmin>,
  subscriptionId: string,
  targetPriceId: string,
  idempotencyKey: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const expires_at = new Date(Date.now() + SETTLED_TTL_MS).toISOString();
  const { error } = await admin.from("billing_idempotency_keys").insert({
    subscription_id: subscriptionId,
    target_price_id: targetPriceId,
    idempotency_key: idempotencyKey,
    status: "in_progress",
    expires_at,
    response_json: null,
    http_status: null,
  });
  return { error: error as { code?: string; message?: string } | null };
}

async function updateFinished(
  admin: ReturnType<typeof supabaseAdmin>,
  subscriptionId: string,
  targetPriceId: string,
  idempotencyKey: string,
  status: "completed" | "failed",
  httpStatus: number,
  responseBody: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from("billing_idempotency_keys")
    .update({
      status,
      http_status: httpStatus,
      response_json: responseBody,
    })
    .eq("subscription_id", subscriptionId)
    .eq("target_price_id", targetPriceId)
    .eq("idempotency_key", idempotencyKey);
  if (error) {
    console.error("[billing_idempotency] update_finished_failed", error);
  }
}

async function executePersistedIdempotent(
  subscriptionId: string,
  targetPriceId: string,
  idempotencyKey: string,
  executeApply: () => Promise<{ statusCode: number; body: Record<string, unknown> }>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const admin = supabaseAdmin();

  await deleteExpiredForKey(admin, subscriptionId, targetPriceId, idempotencyKey);

  let row = await selectActiveRow(admin, subscriptionId, targetPriceId, idempotencyKey);
  if (row?.status === "completed" || row?.status === "failed") {
    return rowToResponse(row);
  }
  if (row?.status === "in_progress") {
    const polled = await pollUntilSettled(admin, subscriptionId, targetPriceId, idempotencyKey);
    if (polled) return polled;
    return { statusCode: 202, body: { ...IN_PROGRESS_BODY } };
  }

  const { error: insErr } = await insertInProgress(admin, subscriptionId, targetPriceId, idempotencyKey);
  if (insErr) {
    if (isUniqueViolation(insErr)) {
      row = await selectActiveRow(admin, subscriptionId, targetPriceId, idempotencyKey);
      if (row?.status === "in_progress") {
        const polled = await pollUntilSettled(admin, subscriptionId, targetPriceId, idempotencyKey);
        if (polled) return polled;
        return { statusCode: 202, body: { ...IN_PROGRESS_BODY } };
      }
      if (row?.status === "completed" || row?.status === "failed") {
        return rowToResponse(row);
      }
    }
    console.error("[billing_idempotency] insert_error", insErr);
    throw new Error(insErr.message ?? "billing_idempotency insert failed");
  }

  try {
    const result = await executeApply();
    const fin: "completed" | "failed" = result.statusCode < 400 ? "completed" : "failed";
    await updateFinished(
      admin,
      subscriptionId,
      targetPriceId,
      idempotencyKey,
      fin,
      result.statusCode,
      result.body
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const body = { success: false, error: msg };
    await updateFinished(admin, subscriptionId, targetPriceId, idempotencyKey, "failed", 500, body);
    throw e;
  }
}

/**
 * L1 single-flight на инстансе + Supabase для кросс-инстанс идемпотентности.
 */
export async function runBillingApplyIdempotent(
  args: {
    subscriptionId: string;
    targetPriceId: string;
    clientIdempotencyKey: string;
  },
  executeApply: () => Promise<{ statusCode: number; body: Record<string, unknown> }>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const composite = makeBillingApplyCompositeKey(
    args.subscriptionId,
    args.targetPriceId,
    args.clientIdempotencyKey
  );

  pruneL1();
  const mem = settledL1.get(composite);
  if (mem && Date.now() - mem.at <= SETTLED_TTL_MS) {
    return { statusCode: mem.statusCode, body: { ...mem.body } };
  }

  const existing = inflightL1.get(composite);
  if (existing) {
    return existing;
  }

  const p = (async () => {
    return executePersistedIdempotent(
      args.subscriptionId,
      args.targetPriceId,
      args.clientIdempotencyKey,
      executeApply
    );
  })();

  inflightL1.set(composite, p);
  try {
    const r = await p;
    settledL1.set(composite, { at: Date.now(), statusCode: r.statusCode, body: { ...r.body } });
    return r;
  } finally {
    inflightL1.delete(composite);
  }
}
