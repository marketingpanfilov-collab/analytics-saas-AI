import { Suspense } from "react";
import ReportsPageClient from "./ReportsPageClient";

export const dynamic = "force-dynamic";

function ReportsFallback() {
  return (
    <div style={{ padding: 24, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
      Загрузка отчёта…
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsFallback />}>
      <ReportsPageClient />
    </Suspense>
  );
}
