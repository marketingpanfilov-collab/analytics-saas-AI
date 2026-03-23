import { Suspense } from "react";
import UtmBuilderPageClient from "./UtmBuilderPageClient";

export const dynamic = "force-dynamic";

function UtmBuilderFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="h-10 w-64 rounded-xl bg-white/[0.06]" />
      </div>
  );
}

export default function UtmBuilderPage() {
  return (
    <Suspense fallback={<UtmBuilderFallback />}>
      <UtmBuilderPageClient />
    </Suspense>
  );
}
