import crypto from "node:crypto";
import { NextResponse } from "next/server";

type PaddleWebhookEvent = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: Record<string, unknown>;
};

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

function parsePaddleSignature(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  const parts = header.split(";").map((x) => x.trim());
  const map = new Map<string, string>();
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k && v) map.set(k, v);
  }
  const ts = map.get("ts");
  const h1 = map.get("h1");
  if (!ts || !h1) return null;
  return { ts, h1 };
}

function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean {
  const parsed = parsePaddleSignature(header);
  if (!parsed) return false;

  const tsNum = Number(parsed.ts);
  if (!Number.isFinite(tsNum)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (age > MAX_SIGNATURE_AGE_SECONDS) return false;

  const signedPayload = `${parsed.ts}:${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // timing safe compare
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(parsed.h1, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export async function GET() {
  return NextResponse.json({
    success: true,
    provider: "paddle",
    hint: "Send POST with Paddle-Signature header",
  });
}

export async function POST(req: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "PADDLE_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Paddle-Signature");
  const valid = verifyPaddleSignature(rawBody, signatureHeader, secret);
  if (!valid) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: PaddleWebhookEvent | null = null;
  try {
    payload = JSON.parse(rawBody) as PaddleWebhookEvent;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = String(payload?.event_type ?? "");
  const eventId = String(payload?.event_id ?? "");

  // NOTE: no billing tables yet. For now we verify + acknowledge event delivery
  // so Notification Destination can be enabled and tested.
  console.log("[PADDLE_WEBHOOK_RECEIVED]", {
    event_id: eventId || null,
    event_type: eventType || null,
    occurred_at: payload?.occurred_at ?? null,
  });

  switch (eventType) {
    case "transaction.completed":
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
      // Placeholder for future business logic (entitlements, user plan, etc.)
      break;
    default:
      break;
  }

  return NextResponse.json({ success: true, received: true });
}

