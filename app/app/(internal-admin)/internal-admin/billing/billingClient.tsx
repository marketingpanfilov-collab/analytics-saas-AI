"use client";

import { useState } from "react";

type Entitlement = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  plan_override: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  reason: string | null;
};

export default function InternalBillingPageClient() {
  const [organizationId, setOrganizationId] = useState("");
  const [auditUserId, setAuditUserId] = useState("");
  const [plan, setPlan] = useState("starter");
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Entitlement[]>([]);

  async function loadEntitlements() {
    const oid = organizationId.trim();
    if (!/^[0-9a-f-]{36}$/i.test(oid)) {
      setHistory([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/internal-admin/billing/entitlements?organization_id=${encodeURIComponent(oid)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setHistory([]);
        return;
      }
      setHistory(Array.isArray(json.entitlements) ? json.entitlements : []);
    } catch {
      setHistory([]);
    }
  }

  async function grantEntitlement(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        organization_id: organizationId.trim(),
        plan_override: plan,
        days: Number(days),
        reason: reason.trim(),
      };
      const au = auditUserId.trim();
      if (/^[0-9a-f-]{36}$/i.test(au)) body.user_id = au;

      const res = await fetch("/api/internal-admin/billing/entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setMsg(`Error: ${json?.error ?? "failed"}`);
      } else {
        setMsg("Entitlement granted");
        await loadEntitlements();
      }
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function revokeEntitlement(entitlementId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal-admin/billing/entitlements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entitlement_id: entitlementId, action: "revoke", reason: "manual revoke" }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setMsg(`Error: ${json?.error ?? "failed"}`);
      } else {
        setMsg("Entitlement revoked");
        await loadEntitlements();
      }
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white/95">Billing entitlements</h1>
      <p className="text-sm text-white/65">
        Override по организации (organization_id). Поверх Paddle; подписка в Paddle не меняется.
      </p>
      <form onSubmit={grantEntitlement} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <input
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          onBlur={() => {
            void loadEntitlements();
          }}
          placeholder="Organization ID (uuid)"
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
          required
        />
        <input
          value={auditUserId}
          onChange={(e) => setAuditUserId(e.target.value)}
          placeholder="Optional: user_id for audit column (legacy)"
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
          >
            <option value="starter">starter</option>
            <option value="growth">growth</option>
            <option value="scale">Scale</option>
          </select>
          <input
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="Days until expiration"
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
          />
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          className="min-h-[100px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-emerald-400/35 bg-emerald-500/[0.18] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? "Saving..." : "Grant entitlement"}
        </button>
      </form>
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold text-white/90">Entitlement history</div>
        {history.length === 0 ? <div className="text-sm text-white/65">No rows</div> : null}
        {history.map((h) => (
          <div key={h.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/15 px-2 py-0.5">{h.plan_override ?? "none"}</span>
              <span className="rounded-full border border-white/15 px-2 py-0.5">{h.status}</span>
              <span className="text-white/65">{h.ends_at ? new Date(h.ends_at).toLocaleString("ru-RU") : "no end"}</span>
            </div>
            {h.reason ? <div className="mt-2 text-sm text-white/80">{h.reason}</div> : null}
            {h.status === "active" ? (
              <button
                type="button"
                onClick={() => void revokeEntitlement(h.id)}
                className="mt-2 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-xs"
              >
                Revoke
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {msg ? <div className="text-sm text-white/80">{msg}</div> : null}
    </div>
  );
}
