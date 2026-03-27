"use client";

import { useState } from "react";

type UserRoleRow = { id: string; user_id: string; role: string; created_at: string };

export default function InternalUsersPageClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("support");
  const [targetUserId, setTargetUserId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roles, setRoles] = useState<UserRoleRow[]>([]);

  async function loadRoles() {
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId.trim())) {
      setRoles([]);
      return;
    }
    try {
      const res = await fetch(`/api/internal-admin/users/roles?user_id=${encodeURIComponent(targetUserId.trim())}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setRoles([]);
        return;
      }
      setRoles(Array.isArray(json.roles) ? json.roles : []);
    } catch {
      setRoles([]);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal-admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setMsg(`Error: ${json?.error ?? "failed"}`);
      } else {
        setMsg(`User created: ${json.user_id}`);
      }
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function grantRole(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal-admin/users/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetUserId.trim(), role }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setMsg(`Error: ${json?.error ?? "failed"}`);
      } else {
        setMsg("Role granted");
        await loadRoles();
      }
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function revokeRole(roleName: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal-admin/users/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetUserId.trim(), role: roleName }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setMsg(`Error: ${json?.error ?? "failed"}`);
      } else {
        setMsg("Role revoked");
        await loadRoles();
      }
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white/95">Internal users & roles</h1>

      <form onSubmit={createUser} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold text-white/90">Create user with role</div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
          required
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Temporary password"
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
          required
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
        >
          <option value="support">support</option>
          <option value="ops_manager">ops_manager</option>
          <option value="service_admin">service_admin</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-emerald-400/35 bg-emerald-500/[0.18] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          Create user
        </button>
      </form>

      <form onSubmit={grantRole} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold text-white/90">Grant role to existing user</div>
        <input
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          onBlur={() => {
            void loadRoles();
          }}
          placeholder="User ID (uuid)"
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
          required
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
        >
          <option value="support">support</option>
          <option value="ops_manager">ops_manager</option>
          <option value="service_admin">service_admin</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          Grant role
        </button>
      </form>

      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold text-white/90">Current roles</div>
        {roles.length === 0 ? <div className="text-sm text-white/65">No roles</div> : null}
        {roles.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-sm text-white/90">{r.role}</div>
            <button
              type="button"
              onClick={() => void revokeRole(r.role)}
              disabled={busy}
              className="rounded-md border border-white/15 bg-white/[0.05] px-2 py-1 text-xs disabled:opacity-60"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>

      {msg ? <div className="text-sm text-white/80">{msg}</div> : null}
    </div>
  );
}

