/**
 * Safari (особенно iOS) часто не рисует или обрезает нативный ::-webkit-calendar-picker-indicator
 * внутри flex-контейнера с min-width: 0 — дублируем подсказку видимой SVG.
 */
export function DashboardDateRangeCalendarGlyph() {
  return (
    <span
      className="pointer-events-none inline-flex shrink-0 select-none items-center justify-center text-white/45"
      aria-hidden
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path
          d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
