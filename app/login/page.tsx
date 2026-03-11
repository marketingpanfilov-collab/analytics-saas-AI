import { Suspense } from "react";
import LoginPageClient from "./LoginPageClient";

export const dynamic = "force-dynamic";

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10]">
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageClient />
    </Suspense>
  );
}
