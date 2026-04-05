import { Suspense } from "react";
import TransferAcceptClient from "./TransferAcceptClient";

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a]/95 p-8 text-center">
        <div className="mx-auto h-10 w-48 rounded-xl bg-white/[0.06]" />
        <p className="mt-4 text-sm text-zinc-400">Проверка ссылки…</p>
      </div>
    </div>
  );
}

export default function TransferAcceptPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <TransferAcceptClient />
    </Suspense>
  );
}
