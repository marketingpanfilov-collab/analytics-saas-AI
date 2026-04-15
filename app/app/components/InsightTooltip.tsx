"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useNarrowViewportForTooltip } from "@/app/lib/useNarrowViewportTooltip";

const HOVER_DELAY_MS = 0;

type Props = {
  children: React.ReactNode;
  /** Основной текст подсказки */
  text: string;
  /** Дополнительный абзац (меньшим тоном) */
  secondary?: string;
  /** Позиция: над или под триггером */
  position?: "top" | "bottom";
};

export function InsightTooltip({ children, text, secondary, position = "top" }: Props) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; bottom?: number }>({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipPanelRef = useRef<HTMLDivElement>(null);
  const narrowTapTooltip = useNarrowViewportForTooltip();

  const show = () => {
    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, HOVER_DELAY_MS);
  };

  const showTap = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(true);
  }, []);

  const hide = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  };

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: rect.top,
        bottom: rect.bottom,
      });
    }
  }, [visible, position]);

  useEffect(() => {
    if (!narrowTapTooltip || !visible) return;
    const onDoc = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (triggerRef.current?.contains(t) || tooltipPanelRef.current?.contains(t)) return;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setVisible(false);
    };
    document.addEventListener("pointerdown", onDoc, true);
    return () => document.removeEventListener("pointerdown", onDoc, true);
  }, [narrowTapTooltip, visible]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={narrowTapTooltip ? undefined : show}
        onMouseLeave={narrowTapTooltip ? undefined : hide}
        onPointerDown={narrowTapTooltip ? showTap : undefined}
        style={{ display: "inline-flex", alignItems: "center", cursor: "help", touchAction: "manipulation" }}
      >
        {children}
      </span>
      {visible && (
        <div
          ref={tooltipPanelRef}
          role="tooltip"
          onMouseEnter={narrowTapTooltip ? undefined : show}
          onMouseLeave={narrowTapTooltip ? undefined : hide}
          style={{
            position: "fixed",
            left: coords.x,
            ...(position === "top"
              ? { bottom: `calc(100vh - ${coords.y}px + 8px)` }
              : { top: (coords.bottom ?? coords.y) + 8 }),
            transform: "translateX(-50%)",
            zIndex: 9999,
            maxWidth: 280,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(20,20,28,0.98)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
            fontSize: 12,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.9)",
            pointerEvents: "auto",
          }}
        >
          <p style={{ margin: 0 }}>{text}</p>
          {secondary && (
            <p style={{ margin: "6px 0 0 0", fontSize: 11, color: "rgba(255,255,255,0.65)", whiteSpace: "pre-line" }}>
              {secondary}
            </p>
          )}
        </div>
      )}
    </>
  );
}
