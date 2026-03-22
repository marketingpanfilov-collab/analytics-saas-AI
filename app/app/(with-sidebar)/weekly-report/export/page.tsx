import { Suspense } from "react";
import WeeklyReportExportClient from "./WeeklyReportExportClient";

export const dynamic = "force-dynamic";

export default function WeeklyReportExportPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]"><p className="text-white/50">Загрузка…</p></div>}>
      <WeeklyReportExportClient />
    </Suspense>
  );
}
