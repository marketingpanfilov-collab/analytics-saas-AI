"use client";

import { useMemo, useState } from "react";
import LtvChart, { type Point } from "../components/LtvChart";
import CohortHeatmap, { type CohortRow } from "../components/CohortHeatmap";

const pillStyle = (active: boolean) => ({
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
  color: "white",
  fontWeight: 800 as const,
  cursor: "pointer" as const,
});

const selectStyle = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.03)",
  color: "white",
  outline: "none",
};

const cardStyle = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.18), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 18,
  minHeight: 120,
};

function fmtKzt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₸";
}

export default function LtvPage() {
  // Каналы (заглушки)
  const channels = ["Все каналы", "Meta", "Google", "TikTok", "Organic", "Referral"];
  const [channel, setChannel] = useState(channels[0]);

  // Переключатель метрики когорты
  const [metric, setMetric] = useState<"money" | "users" | "percent">("money");

  // Выбор базовой когорты (месяц первого привлечения)
  const cohortMonths = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const [cohortMonth, setCohortMonth] = useState("2026-08");

  /**
   * KPI заглушки (подставим реальные данные позже).
   * M0 = месяц привлечения, Mi = выбранный месяц когорты (сейчас cohortMonth).
   */
  const usersMi = 280; // Users(2026-08)
  const activeUsersMi = 280; // Активные юзеры(2026-08)
  const revenueMi = 1_720_000; // Выручка(2026-08)
  const arpuMi = 6143; // ARPU(2026-08)
  const ltvCum = 29_347; // LTV(накоп.)
  const payingShare = 18.0; // Доля платящих %

  // Retention (%): users(Mi) / users(M0)
  // Заглушка: пусть M0 = 1098 пользователей, чтобы получить 25.5%
  const usersM0 = 1098;
  const retentionPct = (usersMi / usersM0) * 100; // 25.5%

  // Доп. проценты MoM (заглушки)
  const retentionMoM = 84.8;
  const revenueMoM = 92.5;

  // Формула: LTV × users (заглушка)
  const ltvXUsers = ltvCum * usersMi;

  // Линия LTV/ARPU (заглушка)
  const lineData: Point[] = [
    { day: "D1", ltv: 1200, arpu: 1200 },
    { day: "D7", ltv: 2800, arpu: 900 },
    { day: "D14", ltv: 4200, arpu: 750 },
    { day: "D30", ltv: 6500, arpu: 580 },
    { day: "D60", ltv: 9100, arpu: 430 },
    { day: "D90", ltv: 11200, arpu: 350 },
  ];

  // Когорта (пример как на скрине: и "по деньгам", и "по пользователям", и "%")
  // Формат: строки = месяц привлечения, колонки = M0..M6, значения = в зависимости от режима
  const cohortRows: CohortRow[] = useMemo(() => {
    // Заглушки — одинаковые для всех каналов; позже заменим данными из БД
    const base: CohortRow[] = [
      { cohort: "2026-04", values: [100, 42, 28, 20, 16, 13, 11] },
      { cohort: "2026-05", values: [100, 45, 31, 23, 18, 14, 12] },
      { cohort: "2026-06", values: [100, 48, 34, 25, 19, 15, 12] },
      { cohort: "2026-07", values: [100, 50, 36, 26, 20, 15, 13] },
      { cohort: "2026-08", values: [100, 52, 38, 28, 21, 16, 14] },
    ];

    // Преобразуем по режиму:
    if (metric === "percent") {
      // Уже в % (100% на M0)
      return base;
    }

    if (metric === "users") {
      // users: умножим % на размер когорты (заглушки)
      const cohortSizes: Record<string, number> = {
        "2026-04": 310,
        "2026-05": 360,
        "2026-06": 420,
        "2026-07": 390,
        "2026-08": 280,
      };
      return base.map((r) => {
        const size = cohortSizes[r.cohort] ?? 300;
        const vals = r.values.map((p) => Math.round((p / 100) * size));
        return { cohort: r.cohort, values: vals };
      });
    }

    // money: деньги = users * условный ARPU по месяцу (заглушка)
    const arpuByMonthIndex = [8000, 6200, 5400, 4800, 4300, 3900, 3600];
    const cohortSizes: Record<string, number> = {
      "2026-04": 310,
      "2026-05": 360,
      "2026-06": 420,
      "2026-07": 390,
      "2026-08": 280,
    };

    return base.map((r) => {
      const size = cohortSizes[r.cohort] ?? 300;
      const users = r.values.map((p) => (p / 100) * size);
      const money = users.map((u, i) => Math.round(u * (arpuByMonthIndex[i] ?? 4000)));
      return { cohort: r.cohort, values: money };
    });
  }, [metric]);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>LTV / Retention</h1>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Когорты по месяцам: деньги / пользователи / % + график LTV.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ opacity: 0.75, fontWeight: 800 }}>Канал:</div>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={selectStyle}>
            {channels.map((c) => (
              <option key={c} value={c} style={{ background: "#0b0b10" }}>
                {c}
              </option>
            ))}
          </select>

          <div style={{ opacity: 0.75, fontWeight: 800 }}>Когорта:</div>
          <select
            value={cohortMonth}
            onChange={(e) => setCohortMonth(e.target.value)}
            style={selectStyle}
          >
            {cohortMonths.map((m) => (
              <option key={m} value={m} style={{ background: "#0b0b10" }}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI cards (объединённые 8 -> 4) */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
        {/* Users */}
        <div style={cardStyle}>
          <div style={{ opacity: 0.7, fontWeight: 900 }}>Users ({cohortMonth})</div>
          <div style={{ fontSize: 44, fontWeight: 900, marginTop: 6 }}>{usersMi}</div>
          <div style={{ opacity: 0.7, marginTop: 8 }}>
            Активные: <b>{activeUsersMi}</b>
          </div>
          <div style={{ opacity: 0.7, marginTop: 4 }}>
            Retention MoM: <b>{retentionMoM.toFixed(1)}%</b>
          </div>
        </div>

        {/* Retention */}
        <div style={cardStyle}>
          <div style={{ opacity: 0.7, fontWeight: 900 }}>Retention (%)</div>
          <div style={{ fontSize: 44, fontWeight: 900, marginTop: 6 }}>
            {retentionPct.toFixed(1).replace(".", ",")}%
          </div>
          <div style={{ opacity: 0.7, marginTop: 10 }}>
            users(Mi) / users(M0)
          </div>
          <div style={{ opacity: 0.7, marginTop: 6 }}>
            Revenue MoM: <b>{revenueMoM.toFixed(1).replace(".", ",")}%</b>
          </div>
        </div>

        {/* LTV × users */}
        <div style={cardStyle}>
          <div style={{ opacity: 0.7, fontWeight: 900 }}>LTV × users (заглушка)</div>
          <div style={{ fontSize: 40, fontWeight: 900, marginTop: 6 }}>{fmtKzt(ltvXUsers)}</div>
          <div style={{ opacity: 0.7, marginTop: 10 }}>
            LTV(накоп.) × users(Mi)
          </div>
          <div style={{ opacity: 0.7, marginTop: 6 }}>
            Выручка: <b>{fmtKzt(revenueMi)}</b> · ARPU: <b>{fmtKzt(arpuMi).replace(" ₸", "₸")}</b>
          </div>
        </div>

        {/* Paying share */}
        <div style={cardStyle}>
          <div style={{ opacity: 0.7, fontWeight: 900 }}>Доля платящих</div>
          <div style={{ fontSize: 44, fontWeight: 900, marginTop: 6 }}>
            {payingShare.toFixed(1).replace(".", ",")}%
          </div>
          <div style={{ opacity: 0.7, marginTop: 10 }}>* пока заглушка</div>
          <div style={{ opacity: 0.7, marginTop: 6 }}>
            LTV (накоп.): <b>{fmtKzt(ltvCum).replace(" ₸", "₸")}</b>
          </div>
        </div>
      </div>

      {/* Line chart (график выше) */}
      <div style={{ marginTop: 18 }}>
        <div style={{ opacity: 0.85, fontWeight: 900, marginBottom: 10 }}>Кривая LTV / ARPU</div>
        <LtvChart data={lineData} />
      </div>

      {/* Metric switcher (ПЕРЕНЕСЛИ НИЖЕ ГРАФИКА, рядом с когортой) */}
      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ opacity: 0.75, fontWeight: 900 }}>Когорта:</div>

        <button style={pillStyle(metric === "money")} onClick={() => setMetric("money")} type="button">
          Оборот (₸)
        </button>
        <button style={pillStyle(metric === "users")} onClick={() => setMetric("users")} type="button">
          Пользователи
        </button>
        <button style={pillStyle(metric === "percent")} onClick={() => setMetric("percent")} type="button">
          Retention (%)
        </button>

        <div style={{ opacity: 0.6, marginLeft: 8 }}>
          Канал: <b>{channel}</b> · Когорта: <b>{cohortMonth}</b>
        </div>
      </div>

      {/* Cohort heatmap (ниже фильтров) */}
      <div style={{ marginTop: 12 }}>
        <CohortHeatmap rows={cohortRows} mode={metric} />
      </div>
    </div>
  );
}