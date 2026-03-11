import { Suspense } from "react";
import PixelsPageClient from "./PixelsPageClient";

export const dynamic = "force-dynamic";

function PixelsFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]" style={{ gridColumn: "2 / -1" }}>
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

export default function PixelsPage() {
  return (
    <Suspense fallback={<PixelsFallback />}>
      <PixelsPageClient />
    </Suspense>
  );
}
