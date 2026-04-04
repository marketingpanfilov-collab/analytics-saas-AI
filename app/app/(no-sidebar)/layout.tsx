"use client";

import { Suspense, useEffect, useState } from "react";
import DevAbortRejectionSuppressor from "../components/DevAbortRejectionSuppressor";
import { BillingBootstrapProvider } from "../components/BillingBootstrapProvider";
import Topbar from "../components/Topbar";
import { supabase } from "../../lib/supabaseClient";

function TopbarFallback() {
  return (
    <div
      style={{
        height: 64,
        width: "100%",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(11,11,16,0.75)",
      }}
    />
  );
}

export default function NoSidebarLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setEmail(data.user?.email ?? "");
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <BillingBootstrapProvider>
      <div
        style={{
          minHeight: "100vh",
          background: "#0b0b10",
          display: "grid",
          gridTemplateRows: "64px 1fr",
        }}
      >
        <DevAbortRejectionSuppressor />
        <div style={{ height: 64 }}>
          <Suspense fallback={<TopbarFallback />}>
            <Topbar email={email} />
          </Suspense>
        </div>
        <main style={{ minHeight: 0 }}>{children}</main>
      </div>
    </BillingBootstrapProvider>
  );
}

