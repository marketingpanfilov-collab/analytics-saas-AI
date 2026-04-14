"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Единый z-index для mobile sheets в app shell (над контентом страницы). */
export const MOBILE_APP_SHEET_Z = 200;

const PANEL_MS = 300;
const BACKDROP_MS = 220;

/**
 * Строка действия в bottom sheet: фиксированная высота ряда + `items-center`, чтобы текст
 * и иконка были по центру по вертикали (без «тяжести» вниз от `leading-snug` + `py-*`).
 */
export const mobileSheetActionRowClassName =
  "flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-0 text-left text-[15px] font-medium leading-normal text-white transition-colors hover:bg-white/[0.06] active:bg-white/[0.08]";

/** Тонкая линия между секциями (как под мета-блоком в «Профиль») */
export const mobileSheetDividerClassName = "h-px bg-white/[0.07]";

/** Разделитель на всю ширину контента sheet с отступами как у шапки */
export const mobileSheetHeaderDividerClassName = "mx-4 h-px shrink-0 bg-white/[0.07]";

/** Вторичная подпись под заголовком sheet */
export const mobileSheetSubtitleClassName = "mt-1 text-[12px] leading-snug text-zinc-500";

type MobileBottomSheetVariant = "default" | "notifications";

export type MobileBottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  titleId: string;
  subtitle?: ReactNode;
  /** notifications: без красной «Отмена», обычно с headerRight (крестик) */
  variant?: MobileBottomSheetVariant;
  headerRight?: ReactNode;
  children: ReactNode;
  /** Блок над скроллом (редко) */
  topContent?: ReactNode;
  /** Ниже скролла, выше «Отмена» (например разделитель не нужен — только inner) */
  bottomContent?: ReactNode;
  /**
   * Линия под заголовком/подзаголовком, до контента (списка).
   * Выключите, если разметка контента рисует свой разделитель (например «Профиль» с email сверху).
   */
  showHeaderDivider?: boolean;
  className?: string;
  contentClassName?: string;
  /** Ограничение высоты панели (вся карточка) */
  panelMaxClassName?: string;
  /**
   * `lg` (default): как topbar mobile — скрыто с breakpoint lg.
   * `sm`: только узкая ширина (&lt; sm), для overflow на /app/projects.
   */
  visibleBelow?: "sm" | "lg";
  /**
   * Доп. нижний отступ блока заголовка (px), только при `showHeaderDivider`.
   * Суммируется с базовым `py-3` снизу: `calc(0.75rem + Npx)`.
   */
  titleBottomPaddingExtraPx?: number;
  /**
   * Убрать `border-t` у блока с «Отмена» (например, если линия уже в `bottomContent` над ссылкой).
   */
  cancelFooterHideTopBorder?: boolean;
};

/**
 * Единый mobile bottom sheet: handle, header, content, опционально footer с «Отмена».
 * Анимация: backdrop fade + panel translateY + opacity (ease-out въезд, ease-in выезд).
 */
export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  titleId,
  subtitle,
  variant = "default",
  headerRight,
  children,
  topContent,
  bottomContent,
  className = "",
  contentClassName = "",
  panelMaxClassName = "max-h-[min(72dvh,560px)]",
  visibleBelow = "lg",
  showHeaderDivider = true,
  titleBottomPaddingExtraPx,
  cancelFooterHideTopBorder = false,
}: MobileBottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), PANEL_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted || typeof document === "undefined") return null;

  /** С линией под шапкой — одинаковый отступ сверху и снизу вокруг заголовка (и подзаголовка, если есть). */
  const titleSectionClassName = showHeaderDivider ? "shrink-0 px-4 py-3" : "shrink-0 px-4 pb-2";

  const showFooterCancel = variant !== "notifications";

  const close = () => onOpenChange(false);

  const panelEase = visible
    ? "cubic-bezier(0.22, 1, 0.36, 1)"
    : "cubic-bezier(0.4, 0, 1, 1)";

  const viewportClass =
    visibleBelow === "sm"
      ? "flex flex-col justify-end sm:hidden"
      : "flex flex-col justify-end lg:hidden";

  return createPortal(
    <div
      className={`pointer-events-none fixed inset-0 flex-col justify-end ${viewportClass}`}
      style={{ zIndex: MOBILE_APP_SHEET_Z }}
    >
      <button
        type="button"
        aria-label="Закрыть"
        className={`pointer-events-auto absolute inset-0 bg-black/55 backdrop-blur-[3px] transition-opacity ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          transitionDuration: `${BACKDROP_MS}ms`,
          transitionTimingFunction: visible ? "ease-out" : "ease-in",
        }}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`pointer-events-auto relative z-10 flex w-full flex-col rounded-t-[20px] border border-white/[0.08] border-b-0 bg-[#16161e] shadow-[0_-24px_64px_rgba(0,0,0,0.48)] ${panelMaxClassName} ${className}`}
        style={{
          transform: visible ? "translate3d(0,0,0)" : "translate3d(0,16px,0)",
          opacity: visible ? 1 : 0,
          transition: `transform ${PANEL_MS}ms ${panelEase}, opacity ${PANEL_MS}ms ${visible ? "ease-out" : "ease-in"}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pt-2">
          <div
            className={`mx-auto h-1 w-10 rounded-full bg-white/20 ${showHeaderDivider ? "mb-0" : "mb-2"}`}
            aria-hidden
          />
        </div>

        <div
          className={titleSectionClassName}
          style={
            showHeaderDivider && titleBottomPaddingExtraPx != null && titleBottomPaddingExtraPx > 0
              ? { paddingBottom: `calc(0.75rem + ${titleBottomPaddingExtraPx}px)` }
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-[17px] font-semibold leading-[1.2] tracking-tight text-white"
              >
                {title}
              </h2>
              {subtitle != null && subtitle !== false ? (
                <div className={mobileSheetSubtitleClassName}>{subtitle}</div>
              ) : null}
            </div>
            {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
          </div>
        </div>

        {showHeaderDivider ? (
          <div className={mobileSheetHeaderDividerClassName} role="separator" aria-hidden />
        ) : null}

        {topContent ? <div className="shrink-0 px-4 pb-2">{topContent}</div> : null}

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-2 ${showHeaderDivider ? "pt-2" : ""} ${contentClassName}`}
        >
          {children}
        </div>

        {bottomContent ? <div className="shrink-0 px-4 pt-0">{bottomContent}</div> : null}

        {showFooterCancel ? (
          <div
            className={`shrink-0 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] ${
              cancelFooterHideTopBorder ? "" : "border-t border-white/[0.06]"
            }`}
          >
            <button
              type="button"
              className="w-full rounded-xl border border-red-500/45 bg-red-500/[0.12] py-3 text-center text-[15px] font-semibold leading-snug text-red-200/95 transition-colors hover:border-red-500/55 hover:bg-red-500/[0.18] active:bg-red-500/[0.14]"
              onClick={close}
            >
              Отмена
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/** Кнопка закрытия в шапке (уведомления и др.) — SVG вместо глифа ✕ (ровнее в квадрате). */
export function MobileSheetHeaderCloseButton({ onClick, label = "Закрыть" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.05] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white active:bg-white/[0.07]"
      aria-label={label}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 14 14"
        className="block shrink-0"
        aria-hidden
        fill="none"
      >
        <path
          d="M3.5 3.5l7 7M10.5 3.5l-7 7"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
