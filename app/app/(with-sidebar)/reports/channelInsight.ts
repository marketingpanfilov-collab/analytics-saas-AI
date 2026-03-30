/**
 * Одна строка-инсайт под блоком «Каналы и сравнение платформ».
 * Сначала оцениваются сигналы риска (worst_severity), иначе — подсказки «в норме» и обучающие (по приоритету).
 */

export type ChannelInsightBudgetPlatform = { platform: string; spend: number };

export type ChannelInsightRevenueRow = { source: string; revenue: number };

export type ChannelInsightInput = {
  fmtMoney: (n: number | null) => string;
  by_platform: ChannelInsightBudgetPlatform[];
  revenue_by_acquisition_source: ChannelInsightRevenueRow[];
  /** ROAS по отчёту (KPI или факт), если есть */
  roas: number | null;
};

const MIN_SPEND_USD = 100;
const MIN_REV_PROJECT = 25;
const MAX_PAID_REV_PCT_ATTRIBUTION = 20;
const PLATFORM_MIN_PCT = 5;
const PLATFORM_GAP_PCT = 15;
const ORGANIC_PCT_NOTE = 15;

const PAID_KEYS = ["meta", "google", "tiktok", "yandex"] as const;

/** Высокий — красная стрелка; средний — жёлтая; обычный — синяя. */
export type ChannelInsightPriority = "high" | "medium" | "low";

export type ChannelInsightResult = {
  text: string;
  level: ChannelInsightPriority;
};

type RiskKind = "attribution" | "platform" | "organic";

function result(text: string, level: ChannelInsightPriority): ChannelInsightResult {
  return { text, level };
}

export function getChannelInsight(input: ChannelInsightInput): ChannelInsightResult | null {
  const { fmtMoney, by_platform, revenue_by_acquisition_source, roas } = input;
  if (!by_platform?.length) return null;

  const totalSpend = by_platform.reduce((s, p) => s + p.spend, 0);
  const revBySrc: Record<string, number> = {};
  for (const r of revenue_by_acquisition_source ?? []) {
    revBySrc[r.source] = r.revenue;
  }
  const totalRev = Object.values(revBySrc).reduce((a, b) => a + b, 0);
  if (totalRev <= 0) return null;

  const paidRev = PAID_KEYS.reduce((s, k) => s + (revBySrc[k] ?? 0), 0);
  const paidRevPct = (paidRev / totalRev) * 100;

  const organicRev =
    (revBySrc.organic_search ?? 0) +
    (revBySrc.organic_social ?? 0) +
    (revBySrc.referral ?? 0) +
    (revBySrc.direct ?? 0);
  const organicPct = (organicRev / totalRev) * 100;

  const topSpend = Math.max(...by_platform.map((p) => p.spend), 0);
  const topSpendShare = totalSpend > 0 ? topSpend / totalSpend : 0;
  const paidPlatformsWithSpend = by_platform.filter((p) => p.spend > 0).length;

  let maxPlatformGap = 0;
  if (totalSpend > 0) {
    for (const p of by_platform) {
      const spendPct = (p.spend / totalSpend) * 100;
      const srcKey = platformLabelToKey(p.platform);
      const rev = revBySrc[srcKey] ?? 0;
      const revPct = (rev / totalRev) * 100;
      if (revPct >= PLATFORM_MIN_PCT && spendPct >= PLATFORM_MIN_PCT) {
        maxPlatformGap = Math.max(maxPlatformGap, Math.abs(revPct - spendPct));
      }
    }
  }

  // --- Риск: один победитель по severity
  if (totalSpend > 0) {
    const risk: { kind: RiskKind; severity: number; text: string }[] = [];

    if (totalSpend >= MIN_SPEND_USD && totalRev >= MIN_REV_PROJECT && paidRevPct <= MAX_PAID_REV_PCT_ATTRIBUTION) {
      risk.push({
        kind: "attribution",
        severity: 1000 - paidRevPct * 10,
        text: `Рекламный расход ${fmtMoney(totalSpend)} за период, а к платным каналам отнесено только ${paidRevPct.toFixed(0)}% выручки — риск сбоя атрибуции. Проверьте пиксель / события на сайте и передачу покупок из CRM (если CRM подключена), а также что в объявлениях стоят ссылки с UTM и что клики доходят до сайта.`,
      });
    }

    let bestPlat: { name: string; revPct: number; spendPct: number; gap: number } | null = null;
    for (const p of by_platform) {
      const spendPct = (p.spend / totalSpend) * 100;
      const srcKey = platformLabelToKey(p.platform);
      const rev = revBySrc[srcKey] ?? 0;
      const revPct = (rev / totalRev) * 100;
      const name = displayPlatformName(p.platform);
      if (revPct < PLATFORM_MIN_PCT || spendPct < PLATFORM_MIN_PCT) continue;
      const gap = Math.abs(revPct - spendPct);
      if (gap < PLATFORM_GAP_PCT) continue;
      if (!bestPlat || gap > bestPlat.gap) {
        bestPlat = { name, revPct, spendPct, gap };
      }
    }
    if (bestPlat != null) {
      const tail =
        bestPlat.revPct > bestPlat.spendPct + 10
          ? "канал даёт большую долю выручки относительно доли расхода."
          : "доля расхода заметно выше доли выручки — проверьте эффективность.";
      risk.push({
        kind: "platform",
        severity: 500 + Math.min(80, bestPlat.gap * 2),
        text: `${bestPlat.name}: ${bestPlat.revPct.toFixed(0)}% выручки при ${bestPlat.spendPct.toFixed(0)}% расхода — ${tail}`,
      });
    }

    if (organicPct >= ORGANIC_PCT_NOTE) {
      risk.push({
        kind: "organic",
        severity: 300,
        text: `Около ${organicPct.toFixed(0)}% выручки приходится на каналы без платной рекламы — сверьте с платными в таблице.`,
      });
    }

    if (risk.length > 0) {
      const rank: Record<RiskKind, number> = { attribution: 3, platform: 2, organic: 1 };
      risk.sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return rank[b.kind] - rank[a.kind];
      });
      const w = risk[0];
      const level: ChannelInsightPriority = w.kind === "attribution" ? "high" : "medium";
      return result(w.text, level);
    }
  }

  // --- Нет сигналов риска: подсказки «в норме» и полезные (порядок = приоритет)
  if (totalSpend <= 0) {
    return result(
      "Расхода по платным кабинетам за период нет — вся выручка в донате справа отражает каналы без платной рекламы (прямой заход, органика и т.д.).",
      "low"
    );
  }

  const lines: Array<ChannelInsightResult | null> = [
    totalRev < 80
      ? result(
          "Выручка за период небольшая — выводы по каналам лучше подтвердить на более длинном окне или большем объёме продаж.",
          "low"
        )
      : null,

    roas != null && roas >= 2.5 && paidRevPct >= 15
      ? result(
          `ROAS около ${roas.toFixed(1)} при заметной доле выручки на платных (~${paidRevPct.toFixed(0)}%) — структура выглядит здоровой; детали по платформам — в таблице ниже.`,
          "low"
        )
      : null,

    roas != null && roas < 1 && paidRevPct >= 25 && totalSpend >= MIN_SPEND_USD
      ? result(
          `ROAS ниже 1 при расходе ${fmtMoney(totalSpend)} — имеет смысл разобрать вклад каждой платформы в таблице и креативы по главному каналу.`,
          "medium"
        )
      : null,

    paidRevPct >= 55 && paidRevPct <= 95 && maxPlatformGap < PLATFORM_GAP_PCT
      ? result(
          `Большая часть выручки (~${paidRevPct.toFixed(0)}%) отнесена к платным каналам, без резкого перекоса долей по платформам — для рекламной отчётности это выглядит согласованно.`,
          "low"
        )
      : null,

    paidRevPct >= 25 && paidRevPct <= 70 && maxPlatformGap < PLATFORM_GAP_PCT
      ? result(
          `Доля выручки на платных (~${paidRevPct.toFixed(0)}%) сопоставима с активностью по рекламе — явных противоречий между донатами нет.`,
          "low"
        )
      : null,

    organicPct > 5 && organicPct < ORGANIC_PCT_NOTE
      ? result(
          `Около ${organicPct.toFixed(0)}% выручки без платной рекламы — типично при прямом заходе и органике; сравните с долями расхода слева.`,
          "low"
        )
      : null,

    organicPct < 8 && paidRevPct > 40
      ? result(
          "Почти вся выручка привязана к платным или смешанным источникам — удобно оценивать эффективность по строкам таблицы.",
          "low"
        )
      : null,

    topSpendShare >= 0.85 && paidPlatformsWithSpend === 1
      ? result(
          "Весь расход сосредоточен на одном платном канале — интерпретация упрощается; при росте бюджета можно добавить второй источник для сравнения.",
          "low"
        )
      : null,

    topSpendShare >= 0.75 && paidPlatformsWithSpend >= 2
      ? result(
          "Львиная доля бюджета в одном канале — это нормально на старте; следите за ROAS по строке и при необходимости диверсифицируйте.",
          "low"
        )
      : null,

    paidPlatformsWithSpend >= 3
      ? result(
          "Несколько платных платформ в периоде — сверяйте доли расхода и выручки в таблице и ищите канал с лучшим ROAS.",
          "low"
        )
      : null,

    maxPlatformGap > 0 && maxPlatformGap < 10 && paidRevPct >= 20
      ? result(
          "Перекосы между долями выручки и расхода по платформам небольшие — картина по каналам выглядит ровной.",
          "low"
        )
      : null,

    paidRevPct > MAX_PAID_REV_PCT_ATTRIBUTION && paidRevPct < 50
      ? result(
          `Часть выручки на платных (~${paidRevPct.toFixed(0)}%), часть на каналах без кабинетов — типичная смесь; при сомнениях проверьте атрибуцию и UTM.`,
          "medium"
        )
      : null,

    result(
      "Соотношение расхода и выручки по каналам за период не даёт сильных тревожных сигналов — детали и ROAS по строкам смотрите в таблице ниже.",
      "low"
    ),
  ];

  for (const line of lines) {
    if (line != null) return line;
  }
  return null;
}

const LABEL_TO_KEY: Record<string, string> = {
  "Meta Ads": "meta",
  "Google Ads": "google",
  "TikTok Ads": "tiktok",
  "Yandex Ads": "yandex",
};

function platformLabelToKey(platform: string): string {
  return LABEL_TO_KEY[platform] ?? platform.toLowerCase();
}

const DISPLAY_NAME: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

function displayPlatformName(platform: string): string {
  const k = platformLabelToKey(platform);
  return DISPLAY_NAME[k] ?? platform;
}
