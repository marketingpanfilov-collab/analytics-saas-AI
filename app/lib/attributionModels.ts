/**
 * Attribution Debugger v10: Attribution Model Comparison
 * Deterministic attribution of journey revenue across click touchpoints.
 * No DB — uses touchpoints and total revenue from journey.
 */

export type TouchpointInput = {
  type: "click" | "visit" | "registration" | "purchase";
  source: string | null;
  platform: string | null;
  timestamp: string;
  value?: number | null;
};

export type AttributionBySource = Record<string, number>;

export type AttributionModelsResult = {
  first_touch: AttributionBySource;
  last_touch: AttributionBySource;
  linear: AttributionBySource;
  position_based: AttributionBySource;
  data_driven: AttributionBySource;
};

const UNKNOWN = "unknown";

function normalizeSource(source: string | null | undefined): string {
  const s = (source ?? "").trim().toLowerCase();
  if (!s) return UNKNOWN;
  if (s.includes("facebook") || s === "fb") return "meta";
  if (s.includes("google") || s === "gclid") return "google";
  if (s.includes("tiktok") || s === "tt") return "tiktok";
  if (s.includes("yandex") || s === "yclid") return "yandex";
  return s;
}

function getOrderedClicks(touchpoints: TouchpointInput[]): Array<{ source: string; tpIndex: number }> {
  return touchpoints
    .map((t, i) => (t.type === "click" ? { source: normalizeSource(t.source), tpIndex: i } : null))
    .filter((x): x is { source: string; tpIndex: number } => x != null);
}

function addToSource(acc: AttributionBySource, source: string, value: number): void {
  acc[source] = (acc[source] ?? 0) + value;
}

/** 100% to first click source */
export function calculateFirstTouch(
  touchpoints: TouchpointInput[],
  totalRevenue: number
): AttributionBySource {
  const clicks = getOrderedClicks(touchpoints);
  const out: AttributionBySource = {};
  if (clicks.length === 0 || totalRevenue <= 0) return out;
  addToSource(out, clicks[0]!.source, totalRevenue);
  return out;
}

/** 100% to last click source */
export function calculateLastTouch(
  touchpoints: TouchpointInput[],
  totalRevenue: number
): AttributionBySource {
  const clicks = getOrderedClicks(touchpoints);
  const out: AttributionBySource = {};
  if (clicks.length === 0 || totalRevenue <= 0) return out;
  addToSource(out, clicks[clicks.length - 1]!.source, totalRevenue);
  return out;
}

/** Revenue divided equally among all clicks */
export function calculateLinear(
  touchpoints: TouchpointInput[],
  totalRevenue: number
): AttributionBySource {
  const clicks = getOrderedClicks(touchpoints);
  const out: AttributionBySource = {};
  if (clicks.length === 0 || totalRevenue <= 0) return out;
  const perClick = totalRevenue / clicks.length;
  clicks.forEach((c) => addToSource(out, c.source, perClick));
  return out;
}

/** 40% first, 40% last, 20% split among middle */
export function calculatePositionBased(
  touchpoints: TouchpointInput[],
  totalRevenue: number
): AttributionBySource {
  const clicks = getOrderedClicks(touchpoints);
  const out: AttributionBySource = {};
  if (clicks.length === 0 || totalRevenue <= 0) return out;
  if (clicks.length === 1) {
    addToSource(out, clicks[0]!.source, totalRevenue);
    return out;
  }
  if (clicks.length === 2) {
    addToSource(out, clicks[0]!.source, totalRevenue * 0.5);
    addToSource(out, clicks[1]!.source, totalRevenue * 0.5);
    return out;
  }
  const first = totalRevenue * 0.4;
  const last = totalRevenue * 0.4;
  const middleTotal = totalRevenue * 0.2;
  const middleCount = clicks.length - 2;
  const middleEach = middleTotal / middleCount;
  addToSource(out, clicks[0]!.source, first);
  addToSource(out, clicks[clicks.length - 1]!.source, last);
  for (let i = 1; i < clicks.length - 1; i++) addToSource(out, clicks[i]!.source, middleEach);
  return out;
}

/** Simplified data-driven: base weights first=0.3, last=0.5, middle=0.2; bonus for visit/reg after click */
export function calculateDataDriven(
  touchpoints: TouchpointInput[],
  totalRevenue: number
): AttributionBySource {
  const clicks = getOrderedClicks(touchpoints);
  const out: AttributionBySource = {};
  if (clicks.length === 0 || totalRevenue <= 0) return out;

  const n = clicks.length;
  const clickTpIndices = clicks.map((c) => c.tpIndex);

  const hasVisitAfter = (clickIdx: number): boolean => {
    const tpIndex = clickTpIndices[clickIdx]!;
    const nextClickTp = clickTpIndices[clickIdx + 1];
    const beforeNext = nextClickTp ?? touchpoints.length;
    return touchpoints.some(
      (t, i) => i > tpIndex && i < beforeNext && t.type === "visit"
    );
  };
  const hasRegAfter = (clickIdx: number): boolean => {
    const tpIndex = clickTpIndices[clickIdx]!;
    const nextClickTp = clickTpIndices[clickIdx + 1];
    const beforeNext = nextClickTp ?? touchpoints.length;
    return touchpoints.some(
      (t, i) => i > tpIndex && i < beforeNext && t.type === "registration"
    );
  };

  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    let w = 0;
    if (n === 1) w = 1;
    else if (n === 2) w = i === 0 ? 0.3 : 0.7;
    else {
      if (i === 0) w = 0.3;
      else if (i === n - 1) w = 0.5;
      else w = 0.2 / (n - 2);
    }
    if (hasVisitAfter(i)) w += 0.05;
    if (hasRegAfter(i)) w += 0.05;
    weights.push(w);
  }

  const sumW = weights.reduce((a, b) => a + b, 0);
  const norm = sumW > 0 ? 1 / sumW : 1;
  clicks.forEach((c, i) => {
    addToSource(out, c.source, totalRevenue * weights[i]! * norm);
  });
  return out;
}

function roundBySource(rec: AttributionBySource): AttributionBySource {
  const out: AttributionBySource = {};
  Object.entries(rec).forEach(([k, v]) => {
    out[k] = Math.round(v * 100) / 100;
  });
  return out;
}

export function calculateAttributionModels(
  touchpoints: TouchpointInput[],
  totalRevenue: number
): AttributionModelsResult {
  return {
    first_touch: roundBySource(calculateFirstTouch(touchpoints, totalRevenue)),
    last_touch: roundBySource(calculateLastTouch(touchpoints, totalRevenue)),
    linear: roundBySource(calculateLinear(touchpoints, totalRevenue)),
    position_based: roundBySource(calculatePositionBased(touchpoints, totalRevenue)),
    data_driven: roundBySource(calculateDataDriven(touchpoints, totalRevenue)),
  };
}
