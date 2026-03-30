/**
 * Structured logs for correlating incidents with cabinet-selection writes.
 * Grep production logs for `[CABINET_STATE]`.
 */
export function logCabinetState(event: string, data: Record<string, unknown>) {
  console.log("[CABINET_STATE]", { event, ts: new Date().toISOString(), ...data });
}
