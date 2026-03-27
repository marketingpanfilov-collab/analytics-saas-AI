import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";

let paddlePromise: Promise<Paddle | undefined> | null = null;
let eventHandler: ((event: PaddleEventData) => void) | null = null;
let initializedPwCustomerId: string | null = null;

type GetPaddleOptions = {
  /** Paddle customer id (ctm_...) for Retain on authenticated pages */
  pwCustomerId?: string | null;
};

async function syncPwCustomer(paddle: Paddle | undefined, pwCustomerId: string | null) {
  if (!paddle || typeof paddle.Update !== "function") return;
  const next = pwCustomerId && pwCustomerId.startsWith("ctm_") ? pwCustomerId : null;
  if (initializedPwCustomerId === next) return;
  try {
    if (next) {
      paddle.Update({ pwCustomer: { id: next } });
    } else {
      paddle.Update({ pwCustomer: {} });
    }
    initializedPwCustomerId = next;
  } catch {
    // non-fatal; checkout can still work without Retain customer context
  }
}

export async function getPaddle(options?: GetPaddleOptions) {
  const nextPwCustomerId = options?.pwCustomerId ?? null;
  if (!paddlePromise) {
    initializedPwCustomerId = nextPwCustomerId && nextPwCustomerId.startsWith("ctm_") ? nextPwCustomerId : null;
    paddlePromise = initializePaddle({
      environment: "production",
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      ...(initializedPwCustomerId ? { pwCustomer: { id: initializedPwCustomerId } } : {}),
      eventCallback: (event) => {
        eventHandler?.(event as PaddleEventData);
      },
    });
  }
  const paddle = await paddlePromise;
  await syncPwCustomer(paddle, nextPwCustomerId);
  return paddle;
}

export function setPaddleEventHandler(handler: ((event: PaddleEventData) => void) | null) {
  eventHandler = handler;
}
