import { redirect } from "next/navigation";

/**
 * Legacy path used in older share links (`/share/weekly-report/...`).
 * The real page lives at `/app/share/weekly-report/[token]`.
 */
export default async function LegacyWeeklyReportShareRedirect({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) {
    redirect("/");
  }
  redirect(`/app/share/weekly-report/${encodeURIComponent(t)}`);
}
