"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import DataHealthMini, {
  type DataHealthIssue,
  type DataHealthRecommendation,
} from "./DataHealthMini";

type ProjectItem = { id: string; name: string | null; organization_id: string | null };

function sectionLabel(pathname: string): string {
  if (pathname === "/app" || pathname === "/app/") return "Дашборд";
  if (pathname.startsWith("/app/reports")) return "Отчёты";
  if (pathname.startsWith("/app/ltv")) return "LTV";
  if (pathname.startsWith("/app/utm-builder")) return "UTM Builder";
  if (pathname.startsWith("/app/pixels")) return "BQ Pixel";
  if (pathname.startsWith("/app/accounts")) return "Аккаунты";
  if (pathname.startsWith("/app/project-members")) return "Участники";
  if (pathname.startsWith("/app/org-members")) return "Организация";
  if (pathname.startsWith("/app/conversion-data") || pathname.startsWith("/app/sales-data")) return "Conversion Data";
  if (pathname.startsWith("/app/api")) return "API";
  if (pathname.startsWith("/app/settings")) return "Настройки";
  if (pathname.startsWith("/app/support")) return "Поддержка";
  if (pathname === "/app/projects" || pathname === "/app/projects/") return "Проекты";
  if (pathname.startsWith("/app/projects/new")) return "Создание проекта";
  if (pathname.startsWith("/app/invite")) return "Приглашение";
  return "Рабочая область";
}

type NoticeType = "info" | "warn" | "success";

type Notice = {
  id: string;
  type: NoticeType;
  title: string;
  text: string;
  time?: string;
  unread?: boolean;
};

function typeColor(t: NoticeType) {
  if (t === "success") return "rgba(140,255,210,0.95)";
  if (t === "warn") return "rgba(255,200,120,0.95)";
  return "rgba(220,220,255,0.95)";
}

function typeDotColor(t: NoticeType) {
  if (t === "success") return "rgba(110,255,200,0.95)";
  if (t === "warn") return "rgba(255,190,120,0.95)";
  return "rgba(140,160,255,0.95)";
}

function BellIcon({ size = 18 }: { size?: number }) {
  // ✅ фикс пропорций: корректный viewBox + preserveAspectRatio
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M12 22a2.2 2.2 0 0 0 2.15-1.7H9.85A2.2 2.2 0 0 0 12 22Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 16.5H6c1.2-1.4 1.6-2.5 1.6-4.7V10a4.4 4.4 0 0 1 8.8 0v1.8c0 2.2.4 3.3 1.6 4.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: color,
        flex: "0 0 10px",
        marginTop: 4,
        boxShadow: "0 0 0 4px rgba(255,255,255,0.03)",
      }}
    />
  );
}

export default function Topbar({ email }: { email?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  type DataQualityPayload = {
    has_data: boolean;
    score: number | null;
    label: string;
    breakdown: {
      click_capture_quality: number;
      visit_attribution_quality: number;
      conversion_attribution_quality: number;
      purchase_completeness: number;
      registration_completeness: number;
    } | null;
    issues: DataHealthIssue[];
    recommendations: DataHealthRecommendation[];
  };
  const [dataQuality, setDataQuality] = useState<DataQualityPayload | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);

  const section = useMemo(() => sectionLabel(pathname ?? ""), [pathname]);
  const projectName = useMemo(
    () => (projectId && projects.length ? (projects.find((p) => p.id === projectId)?.name ?? null) || "Проект" : null),
    [projectId, projects]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; projects?: ProjectItem[] };
        if (mounted && json?.success && Array.isArray(json.projects)) setProjects(json.projects);
      } catch {
        if (mounted) setProjects([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const [notifOpen, setNotifOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const notices: Notice[] = useMemo(
    () => [
      {
        id: "1",
        type: "info",
        title: "Meta: готово к синку",
        text: "Выбери кабинеты и нажми «Синхронизировать Meta».",
        time: "только что",
        unread: true,
      },
      {
        id: "2",
        type: "warn",
        title: "Качество данных",
        text: "Есть пропуски в атрибуции. Проверь события и UTM.",
        time: "10 мин назад",
        unread: true,
      },
      {
        id: "3",
        type: "success",
        title: "Обновление",
        text: "Данные обновлены: сегодня, 00:48.",
        time: "сегодня",
        unread: false,
      },
    ],
    []
  );

  const unreadCount = useMemo(() => notices.filter((n) => n.unread).length, [notices]);

  useEffect(() => {
    async function loadDataQuality() {
      if (!projectId) {
        setDataQuality(null);
        return;
      }
      try {
        const r = await fetch(`/api/data-quality?project_id=${encodeURIComponent(projectId)}&days=30`, {
          cache: "no-store",
        });
        const j = (await r.json()) as {
          success?: boolean;
          has_data?: boolean;
          score?: number | null;
          label?: string;
          breakdown?: DataQualityPayload["breakdown"];
          issues?: DataQualityPayload["issues"];
          recommendations?: DataQualityPayload["recommendations"];
        };
        if (j?.success && j?.has_data !== undefined) {
          setDataQuality({
            has_data: j.has_data,
            score: j.score ?? null,
            label: j.label ?? "No data",
            breakdown: j.breakdown ?? null,
            issues: Array.isArray(j.issues) ? j.issues : [],
            recommendations: Array.isArray(j.recommendations) ? j.recommendations : [],
          });
        } else {
          setDataQuality({
            has_data: false,
            score: null,
            label: "No data",
            breakdown: null,
            issues: [],
            recommendations: [],
          });
        }
      } catch {
        setDataQuality({
          has_data: false,
          score: null,
          label: "No data",
          breakdown: null,
          issues: [],
          recommendations: [],
        });
      }
    }
    loadDataQuality();
  }, [projectId]);

  // ✅ Закрытие попапа по клику вне
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!notifOpen) return;
      const el = popoverRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [notifOpen]);

  // ✅ Esc закрывает
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNotifOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <header
      style={{
        height: 64,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(11,11,16,0.75)",
        backdropFilter: "blur(10px)",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 30, // ✅ поверх контента
      }}
    >
      {/* Project context: project name + section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 15,
            color: "white",
            opacity: 0.95,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {projectName ?? "BoardIQ"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {section}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <DataHealthMini projectId={projectId} initialData={dataQuality} />

        {/* Notifications */}
        <div ref={popoverRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            style={{
              height: 40,
              width: 40,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              position: "relative",
              padding: 0,
              lineHeight: 0, // ✅ убирает “расползание” svg
            }}
            aria-label="Уведомления"
          >
            <BellIcon size={18} />

            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -7,
                  right: -7,
                  height: 20,
                  minWidth: 20,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "rgba(255,120,120,0.95)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 900,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid rgba(11,11,16,0.95)",
                  boxSizing: "border-box",
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              style={{
                position: "absolute",
                top: 52,
                right: 0,
                width: 360,
                maxWidth: "calc(100vw - 48px)",
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(18,18,26,0.96)", // ✅ меньше “прозрачность”
                backdropFilter: "blur(10px)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.75)",
                padding: 14,
                zIndex: 999, // ✅ поверх всего
                boxSizing: "border-box",
              }}
            >
              {/* header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "4px 2px 10px 2px",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 16 }}>Уведомления</div>

                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  style={{
                    height: 34,
                    width: 34,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                    lineHeight: 0,
                    flex: "0 0 auto",
                  }}
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>

              {/* list */}
              <div style={{ display: "grid", gap: 10 }}>
                {notices.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      boxSizing: "border-box",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <Dot color={typeDotColor(n.type)} />
                      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                        <div
                          style={{
                            fontWeight: 900,
                            color: typeColor(n.type),
                            fontSize: 15,
                            lineHeight: 1.2,
                            margin: 0,
                          }}
                        >
                          {n.title}
                        </div>

                        <div
                          style={{
                            fontSize: 13,
                            opacity: 0.82,
                            marginTop: 6,
                            lineHeight: 1.35,
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                          }}
                        >
                          {n.text}
                        </div>

                        {n.time && (
                          <div
                            style={{
                              fontSize: 12,
                              opacity: 0.55,
                              marginTop: 8,
                              lineHeight: 1.2,
                            }}
                          >
                            {n.time}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* footer hint */}
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.55 }}>
                Esc — закрыть • клик вне окна — закрыть
              </div>
            </div>
          )}
        </div>

        <div style={{ opacity: 0.7, fontSize: 13 }}>{email || "—"}</div>

        <button
          onClick={logout}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "white",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          Выйти
        </button>
      </div>
    </header>
  );
}