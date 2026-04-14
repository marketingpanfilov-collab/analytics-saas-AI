/**
 * Keeps `position: fixed` chart tooltips (using client/viewport coordinates) inside the visible area.
 */

export type ClampTooltipViewportOptions = {
  /** CSS max-width of the tooltip (px). */
  maxWidth?: number;
  /** Estimated tooltip height for vertical clamping (px). */
  estHeight?: number;
  edgeMargin?: number;
};

export function clampTooltipToViewport(
  x: number,
  y: number,
  opts?: ClampTooltipViewportOptions
): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  const margin = opts?.edgeMargin ?? 10;
  const maxW = opts?.maxWidth ?? 280;
  const ih = window.innerHeight;
  const estH = Math.min(opts?.estHeight ?? 240, Math.max(120, ih * 0.48));
  const iw = window.innerWidth;
  const w = Math.min(maxW, iw - margin * 2);
  let nx = x;
  let ny = y;
  if (nx + w > iw - margin) nx = iw - w - margin;
  if (nx < margin) nx = margin;
  if (ny + estH > ih - margin) ny = ih - estH - margin;
  if (ny < margin) ny = margin;
  return { x: nx, y: ny };
}

/**
 * For `position: absolute` tooltips inside `containerRect`, returns `left`/`top` relative to the
 * container so the tooltip stays inside the visual viewport.
 */
export function clampTooltipPositionForContainer(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  opts: { offsetX: number; offsetY: number; maxWidth: number; estHeight: number; edgeMargin?: number }
): { x: number; y: number } {
  const tx = clientX - containerRect.left + opts.offsetX;
  const ty = clientY - containerRect.top + opts.offsetY;
  const leftVp = containerRect.left + tx;
  const topVp = containerRect.top + ty;
  const { x: vx, y: vy } = clampTooltipToViewport(leftVp, topVp, {
    maxWidth: opts.maxWidth,
    estHeight: opts.estHeight,
    edgeMargin: opts.edgeMargin,
  });
  return { x: vx - containerRect.left, y: vy - containerRect.top };
}

/**
 * `position: fixed` tooltip placed above a point: horizontal center on `anchorX`, bottom edge at `anchorBottomY`.
 */
export function clampFixedTooltipAbovePoint(
  anchorX: number,
  anchorBottomY: number,
  opts?: { estWidth?: number; estHeight?: number; margin?: number }
): { left: number; top: number } {
  if (typeof window === "undefined") {
    return { left: anchorX, top: anchorBottomY };
  }
  const m = opts?.margin ?? 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const estW = opts?.estWidth ?? 260;
  const estH = opts?.estHeight ?? 200;
  const W = Math.min(estW, vw - m * 2);
  const H = Math.min(estH, vh - m * 2);
  let left = anchorX - W / 2;
  let top = anchorBottomY - H;
  left = Math.min(Math.max(m, left), vw - W - m);
  top = Math.min(Math.max(m, top), vh - H - m);
  return { left, top };
}
