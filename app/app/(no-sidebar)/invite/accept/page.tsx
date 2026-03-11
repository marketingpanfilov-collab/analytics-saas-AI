import { Suspense } from "react";
import InviteAcceptClient from "./InviteAcceptClient";

function InviteAcceptFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="mx-auto h-10 w-48 rounded-xl bg-white/[0.06]" />
        <p className="mt-4 text-sm text-zinc-400">Проверка приглашения…</p>
      </div>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<InviteAcceptFallback />}>
      <InviteAcceptClient />
    </Suspense>
  );
}
