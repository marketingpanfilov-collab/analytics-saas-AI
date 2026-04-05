import crypto from "node:crypto";

function loginCheckoutHmacSecret(): string {
  return (
    process.env.BILLING_LOGIN_CHECKOUT_HMAC_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    (process.env.NODE_ENV === "development" ? "dev-login-checkout-hmac" : "")
  );
}

export function makeLoginCheckoutStatusToken(organizationId: string, emailNormalized: string): string {
  const secret = loginCheckoutHmacSecret();
  if (!secret) {
    throw new Error("Missing BILLING_LOGIN_CHECKOUT_HMAC_SECRET or SUPABASE_SERVICE_ROLE_KEY for login checkout");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${organizationId}:${emailNormalized}`)
    .digest("hex");
}

export function verifyLoginCheckoutStatusToken(
  organizationId: string,
  emailNormalized: string,
  token: string
): boolean {
  const secret = loginCheckoutHmacSecret();
  if (!secret || !token) return false;
  let expected: string;
  try {
    expected = makeLoginCheckoutStatusToken(organizationId, emailNormalized);
  } catch {
    return false;
  }
  if (expected.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
  } catch {
    return false;
  }
}
