"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

const ORG_ROLES_CAN_CREATE = ["owner", "admin"];

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!u) {
        router.replace("/login");
        return;
      }
      const { data: mem } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", u.id)
        .maybeSingle();
      if (!mounted) return;
      if (!mem || !ORG_ROLES_CAN_CREATE.includes((mem.role ?? "") as string)) {
        router.replace("/app/projects");
        return;
      }
      setUserId(u.id);
      setOrganizationId(mem.organization_id);
      setAllowed(true);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !userId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Введите название проекта");
      return;
    }
    setError(null);
    setSubmitLoading(true);

    const { data: proj, error: insertErr } = await supabase
      .from("projects")
      .insert({
        organization_id: organizationId,
        owner_id: userId,
        name: trimmed,
      })
      .select("id")
      .single();

    if (insertErr) {
      setError(insertErr.message ?? "Ошибка создания проекта");
      setSubmitLoading(false);
      return;
    }

    if (!proj?.id) {
      setError("Не удалось создать проект");
      setSubmitLoading(false);
      return;
    }

    const { error: memErr } = await supabase.from("project_members").insert({
      project_id: proj.id,
      user_id: userId,
      role: "project_admin",
    });

    setSubmitLoading(false);
    if (memErr) {
      setError(memErr.message ?? "Ошибка добавления в проект");
      return;
    }

    router.replace(`/app?project_id=${proj.id}`);
  }

  if (loading || !allowed) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Создать проект</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Новый проект будет привязан к вашей организации.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div>
          <label className="block text-sm font-medium text-zinc-300">Название</label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Например: Маркетинг 2025"
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
          />
        </div>
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitLoading}
            className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
          >
            {submitLoading ? "Создание…" : "Создать проект"}
          </button>
          <Link
            href="/app/projects"
            className="inline-flex h-11 items-center rounded-xl border border-white/10 px-6 text-sm text-zinc-300 hover:bg-white/[0.04]"
          >
            Отмена
          </Link>
        </div>
      </form>
    </div>
  );
}
