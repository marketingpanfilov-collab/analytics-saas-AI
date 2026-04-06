/** Matches client `newCheckoutAttemptId()` (UUID) and Meta-style `ca-…` ids used elsewhere. */
export function isValidCheckoutAttemptId(id: string): boolean {
  const s = id.trim();
  if (!s) return false;
  return /^[0-9a-f-]{36}$/i.test(s) || /^ca-\d+-[a-f0-9]+$/i.test(s);
}
