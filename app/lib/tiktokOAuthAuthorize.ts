/**
 * TikTok Marketing API — страница выдачи auth_code для рекламного кабинета.
 *
 * По умолчанию: https://ads.tiktok.com/marketing_api/auth
 * Альтернатива (иногда другой UX / кэш): TIKTOK_AUTHORIZE_URL=https://business-api.tiktok.com/portal/auth
 *
 * Доп. параметры для экспериментов (TikTok может игнорировать неизвестные ключи):
 * - TIKTOK_AUTH_EXTRA_PARAMS — JSON {"reauth":"1"} или query-строка reauth=1
 * - Запрос /api/oauth/tiktok/start?reauth=1 добавляет reauth=1 к URL TikTok (просим «новое» согласие).
 */

export type BuildTikTokAdvertiserAuthUrlInput = {
  appId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  /** См. query reauth=1 на /api/oauth/tiktok/start */
  forceReauth?: boolean;
};

export function parseTikTokAuthExtraParamsFromEnv(): Record<string, string> {
  const raw = process.env.TIKTOK_AUTH_EXTRA_PARAMS?.trim();
  if (!raw) return {};
  try {
    if (raw.startsWith("{")) {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        if (v != null && String(v).trim() !== "") out[k] = String(v);
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  const q = raw.startsWith("?") ? raw.slice(1) : raw;
  const sp = new URLSearchParams(q);
  return Object.fromEntries(sp.entries());
}

export function buildTikTokAdvertiserAuthUrl(input: BuildTikTokAdvertiserAuthUrlInput): string {
  const baseRaw =
    process.env.TIKTOK_AUTHORIZE_URL?.trim() || "https://ads.tiktok.com/marketing_api/auth";

  let url: URL;
  try {
    url = new URL(baseRaw);
  } catch {
    url = new URL("https://ads.tiktok.com/marketing_api/auth");
  }

  url.searchParams.set("app_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  if (input.scopes.length > 0) {
    url.searchParams.set("scope", input.scopes.join(","));
  }

  const extra = { ...parseTikTokAuthExtraParamsFromEnv() };
  if (input.forceReauth && !extra.reauth) {
    extra.reauth = "1";
  }

  for (const [k, v] of Object.entries(extra)) {
    if (k && v != null && String(v).trim() !== "") {
      url.searchParams.set(k, String(v));
    }
  }

  return url.toString();
}
