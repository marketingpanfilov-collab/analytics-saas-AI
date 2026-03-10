"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Notice = { id: string; title: string; text: string };

const bellBtn: React.CSSProperties = {
  height: 36,
  width: 36,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const pop: React.CSSProperties = {
  position: "absolute",
  top: 44,
  right: 0,
  width: 360,
  maxWidth: "calc(100vw - 24px)",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(10,10,14,0.92)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
  padding: 12,
  zIndex: 50,
  backdropFilter: "blur(10px)",
};

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // маленькие уведомления (позже заменишь на API)
  const items: Notice[] = useMemo(
    () => [
      { id: "n1", title: "Синхронизация", text: "Meta: последняя синхронизация 3 часа назад." },
      { id: "n2", title: "Данные", text: "Есть 2 кампании без UTM / source." },
      { id: "n3", title: "Бюджет", text: "Осталось ~18% бюджета на текущий период." },
    ],
    []
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button type="button" style={bellBtn} onClick={() => setOpen((v) => !v)} aria-label="notifications">
        {/* bell icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11a6 6 0 0 0-5-5.91V4a1 1 0 1 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>

        {/* dot */}
        <span
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "rgba(110,255,200,0.95)",
            boxShadow: "0 0 0 3px rgba(110,255,200,0.18)",
          }}
        />
      </button>

      {open && (
        <div style={pop}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 10, opacity: 0.9 }}>
            Уведомления
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {items.map((n) => (
              <div
                key={n.id}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 13 }}>{n.title}</div>
                <div style={{ opacity: 0.75, marginTop: 4, fontSize: 13, lineHeight: 1.25 }}>{n.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}