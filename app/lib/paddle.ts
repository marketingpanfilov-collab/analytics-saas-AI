import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";

let paddlePromise: Promise<Paddle | undefined> | null = null;
let eventHandler: ((event: PaddleEventData) => void) | null = null;

export function getPaddle() {
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      environment: "production",
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      eventCallback: (event) => {
        eventHandler?.(event as PaddleEventData);
      },
    });
  }
  return paddlePromise;
}

export function setPaddleEventHandler(handler: ((event: PaddleEventData) => void) | null) {
  eventHandler = handler;
}
