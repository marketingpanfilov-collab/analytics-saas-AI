"use client";

type Kpi = { title: string; value: string; hint?: string };

const card: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.12), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 16,
};

export default function RightKpis() {
  // заглушки — позже подцепишь из расчетов
  const kpis: Kpi[] = [
    { title: "Итоговый бюджет (факт)", value: "980 000 ₸" },
    { title: "Total бюджет (план)", value: "1 000 000 ₸" },
    { title: "Customer Acquisition Cost", value: "35 000 ₸", hint: "CAC = расход / продажи" },
    { title: "Количество продаж", value: "28" },
  ];

  return (
    <div style={card}>
      <div style={{ fontWeight: 950, fontSize: 22 }}>Сводка</div>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {kpis.map((k) => (
          <div
            key={k.title}
            style={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              padding: 12,
            }}
          >
            <div style={{ opacity: 0.7, fontSize: 13 }}>{k.title}</div>
            <div style={{ fontWeight: 950, fontSize: 22, marginTop: 6 }}>{k.value}</div>
            {k.hint && <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>{k.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}