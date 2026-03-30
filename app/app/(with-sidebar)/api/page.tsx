"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function withProjectId(projectId: string, path: string) {
  return `${path}?project_id=${encodeURIComponent(projectId)}`;
}

function ApiPageInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";

  if (!projectId) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>🔑 API</h1>
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(15,15,25,0.95)",
            fontSize: 14,
            color: "rgba(255,255,255,0.8)",
          }}
        >
          Укажите проект в адресе:{" "}
          <code style={{ color: "rgba(200,220,255,0.95)" }}>/app/api?project_id=…</code>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>🔑 API</h1>
      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.72)", marginBottom: 20 }}>
        Публичный ключ приёма событий, примеры curl и тестовые запросы — в разделе Pixel & CRM. Там же настройки
        пикселя и CRM.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Link
          href={withProjectId(projectId, "/app/pixels")}
          style={{
            display: "inline-block",
            padding: "10px 16px",
            borderRadius: 10,
            background: "rgba(120,120,255,0.45)",
            color: "white",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Открыть Pixel & CRM
        </Link>
        <Link
          href={withProjectId(projectId, "/app/settings")}
          style={{
            display: "inline-block",
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            color: "rgba(255,255,255,0.9)",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Настройки проекта
        </Link>
      </div>
    </div>
  );
}

export default function ApiPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Загрузка…</div>}>
      <ApiPageInner />
    </Suspense>
  );
}
