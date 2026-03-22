import { Suspense } from "react";
import SharedWeeklyReportClient from "./SharedWeeklyReportClient";

export const dynamic = "force-dynamic";

export default async function SharedWeeklyReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <Suspense fallback={<SharedReportFallback />}>
      <SharedWeeklyReportClient token={token} />
    </Suspense>
  );
}

function SharedReportFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10]">
      <p className="text-white/50">Загрузка…</p>
    </div>
  );
}
