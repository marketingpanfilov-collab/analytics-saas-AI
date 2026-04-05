"use client";

import {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
  useId,
  type ReactNode,
  type KeyboardEvent,
  type FocusEvent,
} from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
const OFFSET = 10;
const CLOSE_DELAY_MS = 200;

const PANEL_STYLE: React.CSSProperties = {
  position: "fixed",
  zIndex: 2147483646,
  minWidth: 260,
  maxWidth: 320,
  background: "rgba(17,18,22,0.98)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  padding: "12px 14px",
  boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
  color: "rgba(255,255,255,0.92)",
  fontSize: 13,
  lineHeight: 1.5,
  pointerEvents: "auto",
  boxSizing: "border-box",
};

function computeTooltipPosition(triggerRect: DOMRect, ttRect: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const th = ttRect.height > 0 ? ttRect.height : 80;
  const tw = ttRect.width > 0 ? ttRect.width : 280;
  let top = triggerRect.top - th - OFFSET;
  let left = triggerRect.left + triggerRect.width / 2 - tw / 2;
  if (top < MARGIN) top = triggerRect.bottom + OFFSET;
  if (left < MARGIN) left = MARGIN;
  if (left + tw > vw - MARGIN) left = vw - MARGIN - tw;
  if (top + th > vh - MARGIN) top = vh - MARGIN - th;
  if (top < MARGIN) top = MARGIN;
  return { left, top };
}

type PortalTooltipProps = {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  ariaDisabled?: boolean;
};

/**
 * Tooltip в document.body. Hover + focus на триггере.
 * Позиция: useLayoutEffect + rAF, пока ref портала не готов (иначе вечный opacity:0).
 */
export default function PortalTooltip({
  content,
  children,
  className = "",
  ariaDisabled = false,
}: PortalTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [placed, setPlaced] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafAttemptsRef = useRef(0);
  const tooltipId = useId().replace(/:/g, "_");

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    cancelClose();
    rafAttemptsRef.current = 0;
    setPlaced(false);
    setVisible(true);
  }, [cancelClose]);

  const close = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      setPlaced(false);
      closeTimeoutRef.current = null;
    }, CLOSE_DELAY_MS);
  }, []);

  const applyPosition = useCallback(() => {
    const tr = triggerRef.current;
    const tt = tooltipRef.current;
    if (!tr) return false;
    const triggerRect = tr.getBoundingClientRect();
    if (!tt) return false;
    const ttRect = tt.getBoundingClientRect();
    setPosition(computeTooltipPosition(triggerRect, ttRect));
    return true;
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (applyPosition()) {
        rafAttemptsRef.current = 0;
        if (!cancelled) setPlaced(true);
        return;
      }
      rafAttemptsRef.current += 1;
      if (rafAttemptsRef.current > 12) {
        const tr = triggerRef.current;
        if (tr && !cancelled) {
          const r = tr.getBoundingClientRect();
          setPosition({
            left: Math.max(MARGIN, r.left),
            top: Math.min(window.innerHeight - MARGIN - 80, r.bottom + OFFSET),
          });
          setPlaced(true);
        }
        return;
      }
      requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [visible, applyPosition]);

  useEffect(() => {
    if (!visible) return;
    const onReposition = () => {
      requestAnimationFrame(() => {
        if (applyPosition()) setPlaced(true);
      });
    };
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [visible, applyPosition]);

  const onTriggerFocus = (e: FocusEvent<HTMLSpanElement>) => {
    if (e.target !== triggerRef.current) return;
    open();
  };

  const onTriggerBlur = (e: FocusEvent<HTMLSpanElement>) => {
    const next = e.relatedTarget as Node | null;
    if (tooltipRef.current && next && tooltipRef.current.contains(next)) return;
    close();
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Escape") {
      cancelClose();
      setVisible(false);
      setPlaced(false);
      triggerRef.current?.blur();
      return;
    }
    if (ariaDisabled && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
    }
  };

  const tooltipNode = visible ? (
    <div
      ref={tooltipRef}
      id={`portal-tooltip-${tooltipId}`}
      role="tooltip"
      data-state="open"
      onMouseEnter={cancelClose}
      onMouseLeave={close}
      style={{
        ...PANEL_STYLE,
        left: position.left,
        top: position.top,
        opacity: placed ? 1 : 0,
        visibility: placed ? "visible" : "hidden",
        pointerEvents: placed ? "auto" : "none",
      }}
    >
      {content}
    </div>
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        data-tooltip-trigger={ariaDisabled ? "plan-limit" : "true"}
        data-state={visible ? "open" : "closed"}
        tabIndex={0}
        role={ariaDisabled ? "button" : undefined}
        aria-disabled={ariaDisabled ? true : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={onTriggerFocus}
        onBlur={onTriggerBlur}
        onKeyDown={onTriggerKeyDown}
        aria-describedby={visible ? `portal-tooltip-${tooltipId}` : undefined}
      >
        {children}
      </span>
      {typeof document !== "undefined" && document.body && tooltipNode
        ? createPortal(tooltipNode, document.body)
        : null}
    </>
  );
}
