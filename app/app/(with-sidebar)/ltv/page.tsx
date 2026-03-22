import { Suspense } from "react";
import LtvPageClient from "./LtvPageClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LtvPageClient />
    </Suspense>
  );
}
