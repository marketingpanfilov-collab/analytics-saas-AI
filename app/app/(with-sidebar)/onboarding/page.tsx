import { redirect } from "next/navigation";

/** Старый путь; канон — /app/projects/onboarding */
export default function LegacyOnboardingRedirect() {
  redirect("/app/projects/onboarding");
}
