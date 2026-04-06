import { Suspense } from "react";
import LoginPageClient from "./LoginPageClient";

export const dynamic = "force-dynamic";

function LoginFallback() {
  return (
    <main className="min-h-screen bg-[#0b0b10] text-white" data-login-page>
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 pb-12 pt-[clamp(2rem,10vh,5.5rem)] sm:pt-[clamp(2.5rem,12vh,6rem)]">
        <div className="h-11 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="mt-4 h-[420px] w-full animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
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
