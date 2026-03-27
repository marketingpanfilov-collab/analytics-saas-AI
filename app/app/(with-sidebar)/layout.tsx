"use client";

import { Suspense, useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import PaddleAppInit from "../components/PaddleAppInit";
import { supabase } from "../../lib/supabaseClient";

function SidebarFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: 300,
        background: "rgba(255,255,255,0.02)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    />
  );
}

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

export default function WithSidebarLayout({ children }: { children: React.ReactNode }) {
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
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0b10",
        display: "grid",
        gridTemplateColumns: "260px 1fr",
      }}
    >
      <PaddleAppInit />
      {/* LEFT: SIDEBAR — 260px to match Sidebar component width; wrapped in Suspense because Sidebar uses useSearchParams() */}
      <div style={{ minHeight: "100vh", minWidth: 0 }}>
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar />
        </Suspense>
      </div>

      {/* RIGHT: TOPBAR + CONTENT */}
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateRows: "64px 1fr",
        }}
      >
        {/* Topbar НЕ fixed/sticky — он в сетке, поэтому больше не “заезжает” */}
        <div style={{ height: 64 }}>
          <Suspense fallback={<TopbarFallback />}>
            <Topbar email={email} />
          </Suspense>
        </div>

        {/* Контент всегда ниже топбара */}
        <main style={{ minHeight: 0 }}>{children}</main>
      </div>
    </div>
  );
}

