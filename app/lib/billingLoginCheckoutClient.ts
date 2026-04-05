const KEY = "login_checkout_finalize_org_id";

export function persistLoginCheckoutFinalizeOrg(organizationId: string) {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(KEY, organizationId);
  } catch {
    /* ignore */
  }
}

export function readLoginCheckoutFinalizeOrg(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearLoginCheckoutFinalizeOrg() {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
