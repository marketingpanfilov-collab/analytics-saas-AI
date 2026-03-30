"use client";

import React, { useState, useRef, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
const OFFSET = 10;
const CLOSE_DELAY_MS = 100;

const TOOLTIP_STYLE: React.CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  minWidth: 240,
  width: 260,
  maxWidth: 300,
  background: "rgba(17,18,22,0.98)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
  color: "rgba(255,255,255,0.88)",
  fontSize: 13,
  lineHeight: 1.5,
  pointerEvents: "auto",
  boxSizing: "border-box",
};

export default function HelpTooltip({
  content,
  /** Отступ слева от текста до кружка «?», px (по умолчанию 6). */
  triggerMarginLeft = 6,
}: {
  content: React.ReactNode;
  triggerMarginLeft?: number;
}) {
  const [visible, setVisible] = useState(false);
  const [positionReady, setPositionReady] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setVisible(true);
    setPositionReady(false);
  }, []);

  const close = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      setPositionReady(false);
      closeTimeoutRef.current = null;
    }, CLOSE_DELAY_MS);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tt = tooltipRef.current;
    const ttRect = tt.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = triggerRect.top - ttRect.height - OFFSET;
    let left = triggerRect.left + triggerRect.width / 2 - ttRect.width / 2;

    if (top < MARGIN) top = triggerRect.bottom + OFFSET;

    if (left < MARGIN) left = MARGIN;
    if (left + ttRect.width > vw - MARGIN) left = vw - MARGIN - ttRect.width;
    if (top < MARGIN) top = MARGIN;
    if (top + ttRect.height > vh - MARGIN) top = vh - MARGIN - ttRect.height;

    setPosition({ left, top });
    setPositionReady(true);
  }, [visible]);

  const tooltipEl = visible ? (
    <div
      ref={tooltipRef}
      onMouseEnter={cancelClose}
      onMouseLeave={close}
      style={{
        ...TOOLTIP_STYLE,
        left: positionReady ? position.left : -9999,
        top: positionReady ? position.top : -9999,
        visibility: positionReady ? "visible" : "hidden",
        opacity: positionReady ? 1 : 0,
        transition: "opacity 0.12s ease",
      }}
      className="help-tooltip-content"
    >
      {content}
    </div>
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          marginLeft: triggerMarginLeft,
        }}
        onMouseEnter={open}
        onMouseLeave={close}
      >
        <span
          role="button"
          aria-label="Help"
          aria-haspopup="dialog"
          tabIndex={0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.42)",
            cursor: "help",
            transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.04)",
            outline: "none",
          }}
          className="help-tooltip-trigger"
        >
          ?
        </span>
      </span>

      {typeof document !== "undefined" && document.body && tooltipEl
        ? createPortal(tooltipEl, document.body)
        : null}
    </>
  );
}
