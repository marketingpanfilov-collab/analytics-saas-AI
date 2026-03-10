"use client";

type Campaign = {
  id: string;
  name: string;
  channel: "Meta" | "Google" | "TikTok";
  spend: number;
  clicks: number;
  leads: number;
  sales: number;
  roas: number;
  note?: string;
};

const box: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.12), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 16,
};

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

function row(label: string, val: string) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, opacity: 0.8, fontSize: 13 }}>
      <span>{label}</span>
      <b style={{ opacity: 1 }}>{val}</b>
    </div>
  );
}

export default function CampaignBlocks() {
  // заглушки — позже подцепишь из meta_insights (и дальше google/tiktok)
  const campaigns: Campaign[] = [
    { id: "c1", name: "Astrix | Retarget | Purchases", channel: "Meta", spend: 65830, clicks: 1240, leads: 88, sales: 19, roas: 5.2, note: "Лучший ROAS" },
    { id: "c2", name: "Search Brand", channel: "Google", spend: 34000, clicks: 900, leads: 60, sales: 8, roas: 3.8 },
    { id: "c3", name: "TikTok Broad", channel: "TikTok", spend: 21000, clicks: 640, leads: 45, sales: 2, roas: 1.4, note: "Слабая окупаемость" },
    { id: "c4", name: "Meta Prospecting", channel: "Meta", spend: 52000, clicks: 780, leads: 55, sales: 6, roas: 2.1, note: "Рост лидов" },
  ];

  const best = campaigns.reduce((a, b) => (b.roas > a.roas ? b : a), campaigns[0]);
  const attention = campaigns.filter((c) => c.roas < 2 || c.sales === 0 || c.leads === 0).slice(0, 5);
  const rising = campaigns.filter((c) => c.note?.toLowerCase().includes("рост")).slice(0, 5);

  return (
    <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
      {/* Best */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontWeight: 950, fontSize: 22 }}>Самая результативная кампания</div>
          <span
            style={{
              height: 28,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 10px",
              borderRadius: 999,
              border: "1px solid rgba(110,255,200,0.25)",
              background: "rgba(110,255,200,0.12)",
              color: "rgba(140,255,210,0.95)",
              fontWeight: 850,
              fontSize: 12,
            }}
          >
            {best.channel}
          </span>
        </div>

        <div style={{ marginTop: 10, fontWeight: 900, fontSize: 16 }}>{best.name}</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
          <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 12 }}>
            {row("Spend", fmt(best.spend))}
            {row("Clicks", fmt(best.clicks))}
          </div>
          <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 12 }}>
            {row("Leads", fmt(best.leads))}
            {row("Sales", fmt(best.sales))}
          </div>
          <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 12 }}>
            {row("ROAS", best.roas.toFixed(2).replace(".", ","))}
            {row("Note", best.note ?? "—")}
          </div>

          <div style={{ gridColumn: "span 2", borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 12 }}>
            <div style={{ fontWeight: 900 }}>Что делать дальше</div>
            <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13, lineHeight: 1.3 }}>
              Увеличь бюджет +10–20% и проверь, чтобы атрибуция/UTM не ломались. Дублировать в новый adset не надо — лучше масштабировать текущую связку.
            </div>
          </div>
        </div>
      </div>

      {/* Attention + Rising */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
        <div style={box}>
          <div style={{ fontWeight: 950, fontSize: 20 }}>Кампании, которые требуют внимания</div>
          <div style={{ opacity: 0.7, marginTop: 6, fontSize: 13 }}>Низкий ROAS / нет продаж / нет лидов</div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {attention.map((c) => (
              <div key={c.id} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <b>{c.name}</b>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>{c.channel}</span>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 8, opacity: 0.8, fontSize: 13, flexWrap: "wrap" }}>
                  <span>Spend: <b>{fmt(c.spend)}</b></span>
                  <span>Sales: <b>{fmt(c.sales)}</b></span>
                  <span>ROAS: <b>{c.roas.toFixed(2).replace(".", ",")}</b></span>
                </div>
                {c.note && <div style={{ marginTop: 6, opacity: 0.65, fontSize: 12 }}>{c.note}</div>}
              </div>
            ))}
          </div>
        </div>

        <div style={box}>
          <div style={{ fontWeight: 950, fontSize: 20 }}>Растущие / перспективные кампании</div>
          <div style={{ opacity: 0.7, marginTop: 6, fontSize: 13 }}>Кандидаты на масштабирование</div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {(rising.length ? rising : campaigns.slice(0, 3)).map((c) => (
              <div key={c.id} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <b>{c.name}</b>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>{c.channel}</span>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 8, opacity: 0.8, fontSize: 13, flexWrap: "wrap" }}>
                  <span>Leads: <b>{fmt(c.leads)}</b></span>
                  <span>Sales: <b>{fmt(c.sales)}</b></span>
                  <span>ROAS: <b>{c.roas.toFixed(2).replace(".", ",")}</b></span>
                </div>
                {c.note && <div style={{ marginTop: 6, opacity: 0.65, fontSize: 12 }}>{c.note}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}