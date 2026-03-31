/**
 * Генерация инсайтов, рисков и приоритетных действий для Shared Board Report
 * по метрикам KPI (план, дельты, пороги). Варианты формулировок детерминированы от periodEnd.
 */

export type WeeklyReportKpi = {
  label: string;
  group: "finance" | "product" | "marketing";
  value: number | null;
  format: "money" | "number" | "percent" | "ratio";
  note?: string;
  delta_percent?: number;
  plan_value?: number | null;
  fact_value?: number | null;
  plan_progress?: number | null;
};

const MAX_INSIGHTS = 5;
const MAX_RISKS = 5;
const MAX_ACTIONS = 3;

function num(k: WeeklyReportKpi | undefined, fallback = 0): number {
  const v = k?.value;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function planProgress(k: WeeklyReportKpi | undefined): number | null {
  const p = k?.plan_progress;
  if (p == null || !Number.isFinite(Number(p))) return null;
  return Number(p);
}

function delta(k: WeeklyReportKpi | undefined): number | undefined {
  const d = k?.delta_percent;
  if (d == null || !Number.isFinite(d)) return undefined;
  return d;
}

function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickVariant<T>(periodEnd: string, key: string, variants: readonly T[]): T {
  if (variants.length === 0) throw new Error("pickVariant: empty variants");
  const idx = hash32(`${periodEnd}:${key}`) % variants.length;
  return variants[idx]!;
}

function fmtPct(x: number, digits = 1): string {
  return x.toFixed(digits).replace(".", ",");
}

type RiskTheme =
  | "spend_over_plan"
  | "spend_over_bad_roas"
  | "revenue_below_plan"
  | "purchases_below_plan"
  | "roas_below_1"
  | "roas_critical"
  | "cpo_above_check"
  | "low_cr"
  | "low_funnel_volume"
  | "ctr_drop"
  | "romi_negative";

const CTR_RISK_DELTA = 12;

type ScoredRisk = { text: string; score: number; theme: RiskTheme };

type ActionDef = { text: string; themes: RiskTheme[]; priority: number };

const ACTION_POOL: ActionDef[] = [
  {
    text: "Срочно пересмотреть лимиты и ставки на каналах с перерасходом бюджета при слабом ROAS или падении дохода.",
    themes: ["spend_over_bad_roas", "spend_over_plan"],
    priority: 100,
  },
  {
    text: "Сократить или перераспределить бюджет с каналов с ROAS ниже 1; усилить мониторинг окупаемости по источникам.",
    themes: ["roas_critical", "roas_below_1"],
    priority: 95,
  },
  {
    text: "Снизить CPO относительно среднего чека: офферы, рассрочка, бандлы, апсейл на чекауте и после покупки.",
    themes: ["cpo_above_check"],
    priority: 88,
  },
  {
    text: "Закрыть разрыв по покупкам к плану: ретаргет, триггерные коммуникации, упрощение пути до оплаты.",
    themes: ["purchases_below_plan"],
    priority: 82,
  },
  {
    text: "Подтянуть конверсию регистрация → покупка: онбординг, посадочные и креативы под сегменты с низким CR.",
    themes: ["low_cr"],
    priority: 78,
  },
  {
    text: "Проверить объём верха воронки (показы/клики/лиды): при необходимости расширить охват или сменить креативы при просадке CTR.",
    themes: ["low_funnel_volume", "ctr_drop"],
    priority: 72,
  },
  {
    text: "Сверить план по доходу и покупкам с фактом, обновить прогноз и сценарии на следующий период.",
    themes: ["revenue_below_plan", "purchases_below_plan"],
    priority: 70,
  },
  {
    text: "При отрицательном ROMI зафиксировать точку безубыточности и не масштабировать убыточные связки до пересмотра экономики.",
    themes: ["romi_negative"],
    priority: 90,
  },
];

function buildSignals(kpis: Record<string, WeeklyReportKpi>) {
  const revenue = num(kpis.revenue);
  const spend = num(kpis.spend);
  const purchases = num(kpis.purchases);
  const registrations = num(kpis.registrations);
  const impressions = num(kpis.impressions);
  const clicks = num(kpis.clicks);
  const roas = num(kpis.roas);
  const romi = num(kpis.romi);
  const cr = num(kpis.purchase_conversion);
  const cpo = num(kpis.cpo);
  const avgCheck = num(kpis.avg_check);
  const ctr = num(kpis.ctr);
  const newShare = num(kpis.new_percent);

  const revProg = planProgress(kpis.revenue);
  const spendProg = planProgress(kpis.spend);
  const purProg = planProgress(kpis.purchases);

  const hasRevPlan = revProg != null;
  const hasSpendPlan = spendProg != null;
  const hasPurPlan = purProg != null;

  const revDelta = delta(kpis.revenue);
  const spendDelta = delta(kpis.spend);
  const purDelta = delta(kpis.purchases);
  const roasDelta = delta(kpis.roas);
  const romiDelta = delta(kpis.romi);
  const ctrDelta = delta(kpis.ctr);
  const crDelta = delta(kpis.purchase_conversion);

  const spendPositive = spend > 0;
  const meaningfulImpressions = impressions >= 500;
  const meaningfulRegs = registrations >= 3;

  return {
    revenue,
    spend,
    purchases,
    registrations,
    impressions,
    clicks,
    roas,
    romi,
    cr,
    cpo,
    avgCheck,
    ctr,
    newShare,
    revProg,
    spendProg,
    purProg,
    hasRevPlan,
    hasSpendPlan,
    hasPurPlan,
    revDelta,
    spendDelta,
    purDelta,
    roasDelta,
    romiDelta,
    ctrDelta,
    crDelta,
    spendPositive,
    meaningfulImpressions,
    meaningfulRegs,
  };
}

function collectInsights(periodEnd: string, s: ReturnType<typeof buildSignals>): string[] {
  const out: string[] = [];

  // Динамика дохода к прошлому периоду
  if (s.revDelta != null) {
    if (s.revDelta >= 15) {
      out.push(
        pickVariant(periodEnd, "rev_up_strong", [
          `Сильный рост выручки к прошлому периоду: +${fmtPct(s.revDelta)}% — положительный импульс для планирования.`,
          `Выручка заметно выросла (+${fmtPct(s.revDelta)}%) относительно предыдущего диапазона.`,
          `Доход опережает прошлый период на ${fmtPct(s.revDelta)}%; стоит закрепить сработавшие гипотезы.`,
        ])
      );
    } else if (s.revDelta >= 5) {
      out.push(
        pickVariant(periodEnd, "rev_up_mild", [
          `Выручка выше прошлого периода на ${fmtPct(s.revDelta)}%.`,
          `Рост дохода к предыдущему диапазону: около ${fmtPct(s.revDelta)}%.`,
        ])
      );
    } else if (s.revDelta <= -15) {
      out.push(
        pickVariant(periodEnd, "rev_down_strong", [
          `Выручка существенно ниже прошлого периода (−${fmtPct(Math.abs(s.revDelta))}%); важно понять вклад сезонности и каналов.`,
          `Падение дохода к прошлому диапазону на ${fmtPct(Math.abs(s.revDelta))}% — требуется разбор по источникам и продукту.`,
        ])
      );
    } else if (s.revDelta <= -5) {
      out.push(
        pickVariant(periodEnd, "rev_down_mild", [
          `Доход ниже прошлого периода примерно на ${fmtPct(Math.abs(s.revDelta))}%.`,
          `Небольшое снижение выручки к предыдущему диапазону (−${fmtPct(Math.abs(s.revDelta))}%).`,
        ])
      );
    } else {
      out.push(
        pickVariant(periodEnd, "rev_flat", [
          "Динамика выручки к прошлому периоду близка к нулю — стабильная база для точечных экспериментов.",
          "Выручка в сравнении с прошлым диапазоном без сильных колебаний.",
        ])
      );
    }
  }

  // План по доходу
  if (s.hasRevPlan && s.revProg != null) {
    if (s.revProg >= 1.1) {
      out.push(
        pickVariant(periodEnd, "rev_plan_beat", [
          "План по доходу перевыполнен за выбранный период — запас по выручке есть.",
          "Доход выше планового ориентира: выполнение плана по выручке превысило 100%.",
        ])
      );
    } else if (s.revProg >= 1) {
      out.push(
        pickVariant(periodEnd, "rev_plan_ok", [
          "План по доходу за период выполнен.",
          "Выручка в рамках или чуть выше планового значения за диапазон.",
        ])
      );
    } else if (s.revProg >= 0.95) {
      out.push(
        pickVariant(periodEnd, "rev_plan_soft", [
          `Доход около ${fmtPct(s.revProg * 100)}% от плана — остаётся небольшой разрыв до полного закрытия.`,
          "Выручка близка к плану; небольшой резерв для дожима по конверсии или чеку.",
        ])
      );
    } else if (s.revProg >= 0.85) {
      out.push(
        pickVariant(periodEnd, "rev_plan_miss", [
          `Доход примерно на ${fmtPct(s.revProg * 100)}% от плана — есть заметный разрыв к цели.`,
          "Выручка отстаёт от плана; есть пространство для усиления монетизации и объёма покупок.",
        ])
      );
    } else {
      out.push(
        pickVariant(periodEnd, "rev_plan_hard", [
          `Доход существенно ниже плана (около ${fmtPct(s.revProg * 100)}% от цели).`,
          "Сильное отставание выручки от планового значения за период.",
        ])
      );
    }
  }

  // ROAS / ROMI при наличии расхода
  if (s.spendPositive) {
    if (s.roas >= 1.5) {
      out.push(
        pickVariant(periodEnd, "roas_strong", [
          `ROAS ${s.roas.toFixed(2)} — текущая структура платного трафика в зоне сильной окупаемости.`,
          `Высокий ROAS (${s.roas.toFixed(2)}): маркетинговые вложения эффективно конвертируются в выручку.`,
        ])
      );
    } else if (s.roas >= 1) {
      out.push(
        pickVariant(periodEnd, "roas_ok", [
          `ROAS ${s.roas.toFixed(2)} — платный трафик окупается; при желании можно искать точки масштабирования.`,
          `Окупаемость рекламы в норме (ROAS ${s.roas.toFixed(2)}).`,
        ])
      );
    }
    if (s.romi > 0 && s.roasDelta != null && s.roasDelta > 3) {
      out.push(
        pickVariant(periodEnd, "roas_momentum", [
          `ROAS вырос к прошлому периоду примерно на ${fmtPct(s.roasDelta)}% — окупаемость платного трафика усилилась.`,
          "Динамика ROAS к предыдущему диапазону положительная; стоит закрепить изменения по каналам.",
        ])
      );
    }
    if (s.romi > 0 && s.romiDelta != null && s.romiDelta > 5) {
      out.push(
        pickVariant(periodEnd, "romi_momentum", [
          `ROMI улучшился к прошлому периоду (порядка +${fmtPct(s.romiDelta)} п.п. к марже на расход).`,
          "Маржинальность маркетинга по ROMI растёт относительно прошлого диапазона.",
        ])
      );
    }
  } else {
    out.push(
      pickVariant(periodEnd, "no_spend", [
        "Расход на рекламу в периоде нулевой или несущественный — оценка ROAS/масштабирования по платным каналам ограничена.",
        "Без платного трафика фокус смещается на органику/прямые и продуктовые метрики.",
      ])
    );
  }

  // Структура выручки: новые vs повторные
  if (s.revenue > 0 && s.newShare >= 0) {
    if (s.newShare >= 0.55) {
      out.push(
        pickVariant(periodEnd, "new_high", [
          `Существенная доля выручки от новых пользователей (${fmtPct(s.newShare * 100)}%) — упор на привлечение и первую покупку.`,
          `Высокая доля новых в выручке (~${fmtPct(s.newShare * 100)}%); важно сопоставлять с CAC и LTV.`,
        ])
      );
    } else if (s.newShare <= 0.35) {
      out.push(
        pickVariant(periodEnd, "repeat_high", [
          `Повторные покупки доминируют в выручке (новые ~${fmtPct(s.newShare * 100)}%) — сильный ретеншн или узкий приток.`,
          "Низкая доля новых в выручке: проверьте верх воронки и привлечение.",
        ])
      );
    }
  }

  // CTR при достаточном объёме
  if (s.meaningfulImpressions && s.ctrDelta != null && Math.abs(s.ctrDelta) >= CTR_RISK_DELTA) {
    if (s.ctrDelta > 0) {
      out.push(
        pickVariant(periodEnd, "ctr_up", [
          `CTR вырос к прошлому периоду примерно на ${fmtPct(s.ctrDelta)}% — креативы или выдача стали релевантнее.`,
          "Рост CTR: стоит зафиксировать сработавшие изменения в объявлениях.",
        ])
      );
    } else {
      out.push(
        pickVariant(periodEnd, "ctr_down", [
          `CTR просел к прошлому периоду (~${fmtPct(Math.abs(s.ctrDelta))}%); возможны усталость креативов или конкуренция в аукционе.`,
          "Снижение CTR при заметном объёме показов — сигнал обновить креативы и посадочные.",
        ])
      );
    }
  }

  // План по покупкам (кратко, без дублирования риска)
  if (s.hasPurPlan && s.purProg != null && s.purProg >= 1) {
    out.push(
      pickVariant(periodEnd, "pur_ok", [
        "План по количеству покупок за период достигнут или перевыполнен.",
        "Объём покупок соответствует или превышает плановый ориентир.",
      ])
    );
  }

  return dedupeStrings(out).slice(0, MAX_INSIGHTS);
}

function collectRisks(periodEnd: string, s: ReturnType<typeof buildSignals>): { list: ScoredRisk[]; themes: Set<RiskTheme> } {
  const scored: ScoredRisk[] = [];

  const push = (text: string, score: number, theme: RiskTheme) => {
    scored.push({ text, score, theme });
  };

  // Перерасход бюджета
  if (s.hasSpendPlan && s.spendProg != null && s.spendProg > 1.1) {
    const over = Math.round((s.spendProg - 1) * 100);
    if (s.spendPositive && s.roas < 1) {
      push(
        pickVariant(periodEnd, "risk_spend_roas", [
          `Расход превысил план более чем на 10% при ROAS ${s.roas.toFixed(2)} — перерасход не подкреплён окупаемостью.`,
          `Перерасход бюджета (~${over}% к плану) на фоне слабой окупаемости (ROAS ниже 1).`,
        ]),
        55,
        "spend_over_bad_roas"
      );
    } else if (s.revDelta != null && s.revDelta < 0) {
      push(
        pickVariant(periodEnd, "risk_spend_rev", [
          `Расход выше плана при падении выручки к прошлому периоду — риск сжатия маржи.`,
          `Бюджет уходит в плане выше цели (~+${over}% к плану расхода), доход не растёт.`,
        ]),
        48,
        "spend_over_plan"
      );
    } else {
      push(
        pickVariant(periodEnd, "risk_spend_only", [
          `Расход превысил план более чем на 10% (~+${over}% к плану) — проверьте лимиты и ставки по каналам.`,
          "Фактический расход заметно выше планового ориентира.",
        ]),
        40,
        "spend_over_plan"
      );
    }
  }

  // Доход ниже плана (риск, не только инсайт)
  if (s.hasRevPlan && s.revProg != null && s.revProg < 0.9) {
    push(
      pickVariant(periodEnd, "risk_rev_plan", [
        `Выручка заметно ниже плана (около ${fmtPct(s.revProg * 100)}% от цели) — риск увеличения разрыва к концу периода.`,
        "Доход отстаёт от плана; без корректировок каналов или оффера разрыв может сохраниться.",
      ]),
      s.revProg < 0.75 ? 50 : 38,
      "revenue_below_plan"
    );
  }

  // Покупки ниже плана
  if (s.hasPurPlan && s.purProg != null && s.purProg < 0.9) {
    push(
      pickVariant(periodEnd, "risk_pur_plan", [
        "Факт по покупкам заметно отстаёт от планового значения — объём сделок не закрывает цель.",
        "Количество покупок существенно ниже плана; проверьте конверсию и средний чек.",
      ]),
      s.purProg < 0.75 ? 42 : 34,
      "purchases_below_plan"
    );
  }

  // ROAS
  if (s.spendPositive) {
    if (s.roas < 0.8) {
      push(
        pickVariant(periodEnd, "risk_roas_crit", [
          `ROAS ${s.roas.toFixed(2)} — критически низкая окупаемость; масштабирование текущих связок опасно для маржи.`,
          "Окупаемость рекламы в красной зоне (ROAS ниже 0.8).",
        ]),
        58,
        "roas_critical"
      );
    } else if (s.roas < 1) {
      push(
        pickVariant(periodEnd, "risk_roas_1", [
          "ROAS ниже 1.0 — инвестиции в трафик окупаются слабо; каждый доллар расхода не возвращается выручкой.",
          `Текущий ROAS ${s.roas.toFixed(2)}: ниже точки безубыточности по рекламе.`,
        ]),
        46,
        "roas_below_1"
      );
    }
  }

  if (s.spendPositive && s.romi < 0) {
    push(
      pickVariant(periodEnd, "risk_romi", [
        "ROMI отрицательный: расходы по маркетингу превышают принесённую маржу от выручки в логике периода.",
        "За период маркетинг в отрицательной зоне по ROMI — стоит пересмотреть связки и каналы.",
      ]),
      44,
      "romi_negative"
    );
  }

  // CPO vs чек
  if (s.avgCheck > 0 && s.cpo > s.avgCheck && s.purchases > 0) {
    push(
      pickVariant(periodEnd, "risk_cpo", [
        "Стоимость покупки (CPO) выше среднего чека — экономика воронки под угрозой без роста чека или снижения CPO.",
        "CPO превышает средний чек: привлечение дороже, чем типичная сделка.",
      ]),
      41,
      "cpo_above_check"
    );
  }

  // Низкий CR
  if (s.meaningfulRegs && s.cr > 0 && s.cr < 0.1) {
    push(
      pickVariant(periodEnd, "risk_cr", [
        `Низкая конверсия регистрация → покупка (${fmtPct(s.cr * 100)}%) — усильте онбординг и ценность первой покупки.`,
        "Конверсия в покупку слабая относительно регистраций; воронка «продавливает» слабо.",
      ]),
      33,
      "low_cr"
    );
  }

  // Просадка CTR (риск для действий по креативам)
  if (s.meaningfulImpressions && s.ctrDelta != null && s.ctrDelta <= -CTR_RISK_DELTA) {
    push(
      pickVariant(periodEnd, "risk_ctr", [
        `CTR заметно просел к прошлому периоду (~${fmtPct(Math.abs(s.ctrDelta))}%) — риск дорогого трафика и слабого охвата при тех же ставках.`,
        "Снижение CTR при достаточном объёме показов ухудшает эффективность закупки; обновите креативы и тесты гипотез.",
      ]),
      32,
      "ctr_drop"
    );
  }

  // Мало событий в верху воронки
  if (s.spendPositive && s.registrations < 5 && s.clicks > 50) {
    push(
      pickVariant(periodEnd, "risk_vol", [
        "Мало регистраций при заметном трафике — верх воронки или посадочные теряют пользователей.",
        "Низкий поток регистраций при кликах: проверьте формы, оффер и скорость загрузки.",
      ]),
      28,
      "low_funnel_volume"
    );
  }

  // Сортировка по score, дедуп по theme (keep highest score per theme)
  const byTheme = new Map<RiskTheme, ScoredRisk>();
  for (const r of scored) {
    const prev = byTheme.get(r.theme);
    if (!prev || r.score > prev.score) byTheme.set(r.theme, r);
  }
  const merged = [...byTheme.values()].sort((a, b) => b.score - a.score);
  const list = merged.slice(0, MAX_RISKS);
  const themes = new Set(list.map((r) => r.theme));

  return list.length > 0
    ? { list, themes }
    : {
        list: [
          {
            text: "Явных критических сигналов по выбранным порогам нет — продолжайте мониторинг и сценарное планирование.",
            score: 1,
            theme: "revenue_below_plan",
          },
        ],
        themes: new Set<RiskTheme>(),
      };
}

function pickActions(themeSet: Set<RiskTheme>): string[] {
  const scored = ACTION_POOL.map((a) => {
    const hit = a.themes.some((t) => themeSet.has(t));
    return { ...a, priority: hit ? a.priority : 0 };
  })
    .filter((a) => a.priority > 0)
    .sort((a, b) => b.priority - a.priority);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of scored) {
    if (out.length >= MAX_ACTIONS) break;
    const key = a.text.slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a.text);
  }

  const defaults = [
    "Сверить план по доходу и покупкам с фактом и скорректировать прогноз на следующий период.",
    "Разобрать вклад каналов по ROAS и CPO; перераспределить бюджет в пользу окупаемых связок.",
    "Проверить конверсию по шагам воронки и гипотезы по креативам/посадочным.",
  ];
  for (const d of defaults) {
    if (out.length >= MAX_ACTIONS) break;
    if (!out.includes(d)) out.push(d);
  }

  return out.slice(0, MAX_ACTIONS);
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim().slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

export function pickInsightTexts(
  kpis: Record<string, WeeklyReportKpi>,
  periodEnd: string
): {
  insights: string[];
  risks: string[];
  actions: string[];
} {
  const s = buildSignals(kpis);
  const insights = collectInsights(periodEnd, s);
  const { list: riskObjs, themes } = collectRisks(periodEnd, s);
  const risks = riskObjs.map((r) => r.text);
  const actionThemes = new Set<RiskTheme>(themes);
  for (const r of riskObjs) actionThemes.add(r.theme);
  const actions = pickActions(actionThemes);

  return { insights, risks, actions };
}
