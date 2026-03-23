import { initializePaddle, type Paddle } from "@paddle/paddle-js";

let paddlePromise: Promise<Paddle | undefined> | null = null;

export function getPaddle() {
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      environment: "production",
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
    });
  }

  return paddlePromise;
}
