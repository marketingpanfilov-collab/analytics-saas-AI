import { Suspense } from "react";
import AttributionDebuggerClient from "./AttributionDebuggerClient";

export const dynamic = "force-dynamic";

function AttributionDebuggerFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]" style={{ gridColumn: "2 / -1" }}>
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

export default function AttributionDebuggerPage() {
  return (
    <Suspense fallback={<AttributionDebuggerFallback />}>
      <AttributionDebuggerClient />
    </Suspense>
  );
}
