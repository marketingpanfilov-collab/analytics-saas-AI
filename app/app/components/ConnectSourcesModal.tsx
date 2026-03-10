"use client";

import { useEffect, useMemo, useState } from "react";

type MetaAccount = {
  ad_account_id: string; // act_...
  name: string;
  currency?: string;
  is_enabled?: boolean;
};

type MetaConnection = {
  ad_account_id: string;
  status: string;
};

export default function ConnectSourcesModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const [tab, setTab] = useState<"meta" | "google" | "tiktok">("meta");

  // META
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [connections, setConnections] = useState<MetaConnection[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const connectedSet = useMemo(
    () => new Set((connections ?? []).map((c) => c.ad_account_id)),
    [connections]
  );

  useEffect(() => {
    if (!open) return;
    if (tab !== "meta") return;
    if (!projectId) return;

    (async () => {
      setLoading(true);
      try {
        const [aRes, cRes] = await Promise.all([
          fetch(`/api/oauth/meta/accounts?project_id=${projectId}`),
          fetch(`/api/oauth/meta/connections/list?project_id=${projectId}`),
        ]);

        const aJson = await aRes.json();
        const cJson = await cRes.json();

        setAccounts(aJson?.accounts ?? []);
        setConnections(cJson?.connections ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, tab, projectId]);

  async function getIntegrationId(): Promise<string> {
    const r = await fetch(`/api/oauth/meta/integration/current?project_id=${projectId}`);
    const j = await r.json();
    if (!r.ok || !j?.integration_id) throw new Error(j?.error ?? "No integration_id");
    return j.integration_id;
  }

  async function connectMeta(adAccountId: string) {
    try {
      setBusyId(adAccountId);
      const integrationId = await getIntegrationId();

      const r = await fetch(`/api/oauth/meta/connections/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          integration_id: integrationId,
          ad_account_id: adAccountId,
        }),
      });

      const j = await r.json();
      if (!r.ok || j?.success === false) {
        alert(j?.error ?? "Не удалось подключить кабинет");
        return;
      }

      // обновить подключения
      const cRes = await fetch(`/api/oauth/meta/connections/list?project_id=${projectId}`);
      const cJson = await cRes.json();
      setConnections(cJson?.connections ?? []);
    } finally {
      setBusyId(null);
    }
  }

  async function syncMeta(adAccountId: string) {
    const r = await fetch("/api/sync/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        platform: "meta",
        ad_account_id: adAccountId,
        sync_type: "insights",
      }),
    });
    const j = await r.json();
    if (!r.ok || j?.success === false) {
      alert(j?.error ?? j?.details?.meta_error?.message ?? "Sync error");
      return;
    }
    const period = j?.period ? `${j.period.since}..${j.period.until}` : "";
    alert(`Готово ✅ rows=${j?.rows_written ?? 0}${period ? ` period=${period}` : ""}`);
  }

  if (!open) return null;

  return (
    <div style={styles.backdrop} onMouseDown={onClose}>
      <div style={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ fontWeight: 700 }}>Подключение источников</div>
          <button onClick={onClose} style={styles.iconBtn}>✕</button>
        </div>

        <div style={styles.tabs}>
          <button onClick={() => setTab("meta")} style={tab === "meta" ? styles.tabActive : styles.tab}>
            Meta Ads
          </button>
          <button onClick={() => setTab("google")} style={tab === "google" ? styles.tabActive : styles.tab}>
            Google Ads
          </button>
          <button onClick={() => setTab("tiktok")} style={tab === "tiktok" ? styles.tabActive : styles.tab}>
            TikTok Ads
          </button>
        </div>

        {tab === "meta" && (
          <>
            <div style={styles.block}>
              <div style={{ fontWeight: 600 }}>Как подключить</div>
              <ol style={{ margin: "8px 0 0 18px", opacity: 0.9 }}>
                <li>Нажми “Авторизоваться в Meta” (если ещё не делал).</li>
                <li>Выбери рекламный кабинет → “Подключить”.</li>
                <li>Нажми “Синхронизировать” — данные появятся в отчётах.</li>
              </ol>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={`/api/oauth/meta/start?project_id=${projectId}`}
                  style={styles.primaryLink}
                >
                  Авторизоваться в Meta
                </a>
                <button onClick={() => setTab("meta")} style={styles.secondaryBtn}>
                  Обновить список
                </button>
              </div>
            </div>

            <div style={styles.block}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>Доступные кабинеты</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>{loading ? "Загрузка..." : `${accounts.length} шт.`}</div>
              </div>

              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {accounts.map((a) => {
                  const connected = connectedSet.has(a.ad_account_id);
                  const busy = busyId === a.ad_account_id;

                  return (
                    <div key={a.ad_account_id} style={styles.row}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {a.name}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>{a.ad_account_id}</div>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          disabled={connected || busy}
                          onClick={() => connectMeta(a.ad_account_id)}
                          style={connected ? styles.okBtn : styles.primaryBtn}
                        >
                          {connected ? "Подключено" : busy ? "..." : "Подключить"}
                        </button>

                        <button
                          disabled={!connected}
                          onClick={() => syncMeta(a.ad_account_id)}
                          style={styles.secondaryBtn}
                        >
                          Синхронизировать
                        </button>
                      </div>
                    </div>
                  );
                })}

                {!loading && accounts.length === 0 && (
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    Нет кабинетов. Сначала нажми “Авторизоваться в Meta”.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "google" && (
          <div style={styles.block}>
            <div style={{ fontWeight: 600 }}>Google Ads (скоро)</div>
            <div style={{ marginTop: 8, opacity: 0.85 }}>
              Подготовим такую же механику:
              <ul style={{ margin: "8px 0 0 18px" }}>
                <li>OAuth → выбор аккаунта/manager → “Подключить”</li>
                <li>Синхронизация кампаний/расходов</li>
                <li>Сопоставление по TZ аккаунта</li>
              </ul>
            </div>
            <button disabled style={{ ...styles.primaryBtn, opacity: 0.6, marginTop: 12 }}>
              Подключить Google Ads
            </button>
          </div>
        )}

        {tab === "tiktok" && (
          <div style={styles.block}>
            <div style={{ fontWeight: 600 }}>TikTok Ads (скоро)</div>
            <div style={{ marginTop: 8, opacity: 0.85 }}>
              Точно так же:
              <ul style={{ margin: "8px 0 0 18px" }}>
                <li>OAuth TikTok for Business</li>
                <li>Выбор Ad Account → “Подключить”</li>
                <li>Синхронизируем spend/impressions/clicks</li>
              </ul>
            </div>
            <button disabled style={{ ...styles.primaryBtn, opacity: 0.6, marginTop: 12 }}>
              Подключить TikTok Ads
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 9999,
  },
  modal: {
    width: "min(920px, 100%)",
    maxHeight: "85vh",
    overflow: "auto",
    background: "#0b0f17",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 16,
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  iconBtn: {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "transparent",
    color: "white",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
  },
  tabs: { display: "flex", gap: 8, marginBottom: 12 },
  tab: {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "transparent",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    opacity: 0.8,
  },
  tabActive: {
    border: "1px solid rgba(255,255,255,0.24)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
  },
  block: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  row: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
  },
  primaryBtn: {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(78, 92, 255, 0.25)",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  okBtn: {
    border: "1px solid rgba(0,255,160,0.35)",
    background: "rgba(0,255,160,0.12)",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },
  secondaryBtn: {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "transparent",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  primaryLink: {
    display: "inline-block",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(78, 92, 255, 0.25)",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
};