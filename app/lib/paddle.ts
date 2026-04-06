import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";

/**
 * Ops note: Paddle may decline $0-today checkouts with a heavy promo (e.g. 100% off). That is usually
 * account/card/3DS or Paddle-side rules — not fixed by changing checkout.open. Align NEXT_PUBLIC_PADDLE_ENV
 * with the dashboard (live vs sandbox), client token, and price IDs; contact Paddle support if it persists.
 */

type PaddleEnv = "production" | "sandbox";

function paddleEnvironmentFromEnv(): PaddleEnv {
  const raw = process.env.NEXT_PUBLIC_PADDLE_ENV?.trim().toLowerCase();
  return raw === "sandbox" ? "sandbox" : "production";
}

let paddlePromise: Promise<Paddle | undefined> | null = null;
let eventHandler: ((event: PaddleEventData) => void) | null = null;
const extraEventListeners = new Set<(event: PaddleEventData) => void>();
let initializedPwCustomerId: string | null = null;

function dispatchPaddleEvent(event: PaddleEventData) {
  eventHandler?.(event);
  for (const fn of extraEventListeners) {
    try {
      fn(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

type GetPaddleOptions = {
  /** Paddle customer id (ctm_...) for Retain on authenticated pages */
  pwCustomerId?: string | null;
};

async function syncPwCustomer(paddle: Paddle | undefined, pwCustomerId: string | null) {
  if (!paddle || typeof paddle.Update !== "function") return;
  const next = pwCustomerId && pwCustomerId.startsWith("ctm_") ? pwCustomerId : null;
  if (initializedPwCustomerId === next) return;
  try {
    if (!next) return;
    paddle.Update({ pwCustomer: { id: next } });
    initializedPwCustomerId = next;
  } catch {
    // non-fatal; checkout can still work without Retain customer context
  }
}

export async function getPaddle(options?: GetPaddleOptions) {
  const nextPwCustomerId = options?.pwCustomerId ?? null;
  if (!paddlePromise) {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ?? "";
    if (!token) {
      console.error(
        "[paddle] NEXT_PUBLIC_PADDLE_CLIENT_TOKEN пустой — checkout не сможет авторизоваться (в т.ч. 401 на /pay)."
      );
      paddlePromise = Promise.resolve(undefined);
    } else {
      if (process.env.NODE_ENV === "development" && token.length < 20) {
        console.warn(
          "[paddle] Client-side token выглядит слишком коротким; проверьте, что скопировали полностью из Paddle → Developer tools → Authentication."
        );
      }
      initializedPwCustomerId = nextPwCustomerId && nextPwCustomerId.startsWith("ctm_") ? nextPwCustomerId : null;
      const environment = paddleEnvironmentFromEnv();
      paddlePromise = initializePaddle({
        environment,
        token,
        ...(initializedPwCustomerId ? { pwCustomer: { id: initializedPwCustomerId } } : {}),
        eventCallback: (event) => {
          dispatchPaddleEvent(event as PaddleEventData);
        },
      });
    }
  }
  const paddle = await paddlePromise;
  await syncPwCustomer(paddle, nextPwCustomerId);
  return paddle;
}

export function setPaddleEventHandler(handler: ((event: PaddleEventData) => void) | null) {
  eventHandler = handler;
}

/** Runs after the primary handler (e.g. login signup checkout). */
export function addPaddleEventListener(handler: (event: PaddleEventData) => void): () => void {
  extraEventListeners.add(handler);
  return () => {
    extraEventListeners.delete(handler);
  };
}
