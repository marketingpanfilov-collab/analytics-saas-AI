/**
 * Development-only diagnostics for Paddle.js checkout (401 on /pay, wrong catalog ids).
 * Does not log secrets — only env mode, token prefix, and id shapes.
 */

let loggedPaddleEnvMismatch = false;

export function logPaddleClientEnvMismatchOnce(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (loggedPaddleEnvMismatch) return;
  loggedPaddleEnvMismatch = true;

  const envRaw = process.env.NEXT_PUBLIC_PADDLE_ENV?.trim().toLowerCase();
  const env = envRaw === "sandbox" ? "sandbox" : "production";
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ?? "";
  if (!token) return;

  const prefix = token.startsWith("live_") ? "live" : token.startsWith("test_") ? "test" : "other";
  if (prefix === "other") {
    console.warn(
      "[paddle:diag] Client token does not start with live_ or test_ — verify Paddle → Developer tools → Authentication (client-side token)."
    );
    return;
  }
  if ((env === "production" && prefix === "test") || (env === "sandbox" && prefix === "live")) {
    console.warn(
      `[paddle:diag] Mismatch: NEXT_PUBLIC_PADDLE_ENV=${env} but client token uses ${prefix}_ prefix. Align sandbox/live or expect 401 on checkout-service .../pay.`
    );
  } else {
    console.info(`[paddle:diag] Checkout: NEXT_PUBLIC_PADDLE_ENV=${env}, client_token_prefix=${prefix}_`);
  }
}

export function warnPaddleCheckoutCatalogIds(args: {
  priceId: string;
  productId?: string | null;
  source: string;
}): void {
  if (process.env.NODE_ENV !== "development") return;
  const { priceId, productId, source } = args;
  const p = priceId.trim();
  const tag = `[paddle:diag:${source}]`;

  if (/\s/.test(p)) {
    console.warn(`${tag} priceId contains whitespace — check NEXT_PUBLIC_PADDLE_PRICE_* in env.`);
  }
  if (p.startsWith("pro_")) {
    console.error(
      `${tag} priceId looks like a product id (pro_). NEXT_PUBLIC_PADDLE_PRICE_* must be Paddle Price IDs (pri_).`
    );
  } else if (p.length > 0 && !p.startsWith("pri_")) {
    console.warn(`${tag} priceId does not start with pri_ — confirm Catalog → Prices in Paddle.`);
  }

  const pr = productId?.trim();
  if (!pr) return;
  if (/\s/.test(pr)) {
    console.warn(`${tag} product id contains whitespace — check NEXT_PUBLIC_PADDLE_PRODUCT_*.`);
  }
  if (pr.startsWith("pri_")) {
    console.error(
      `${tag} product id looks like a price id (pri_). NEXT_PUBLIC_PADDLE_PRODUCT_* must be pro_.`
    );
  }
}
