import { Suspense } from "react";
import LoginPageClient from "./LoginPageClient";

export const dynamic = "force-dynamic";

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0b10] text-white">
      <div className="mx-auto w-full max-w-2xl px-6">
        <div className="h-[420px] w-full animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageClient />
    </Suspense>
  );
}
