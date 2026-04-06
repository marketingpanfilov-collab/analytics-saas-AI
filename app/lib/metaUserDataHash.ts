import crypto from "node:crypto";

function sha256HexLower(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Country в user_data CAPI должен быть SHA256 от lowercase ISO 3166-1 alpha-2 (см. Customer Information Parameters).
 */
export function hashMetaCountryIso2(iso2: string | null | undefined): string | null {
  if (iso2 == null) return null;
  const n = String(iso2).trim().toLowerCase().replace(/[^a-z]/g, "");
  if (n.length !== 2) return null;
  return sha256HexLower(n);
}

export type MetaUserDataInput = {
  email: string | null | undefined;
  /** UUID или другой стабильный id пользователя */
  externalId: string | null | undefined;
};

/**
 * Нормализация + хэширование под Conversions API (Customer Information Parameters).
 * em / external_id — SHA256 от нормализованной строки; country — отдельно через hashMetaCountryIso2;
 * fbp / fbc / IP / UA — без хэша.
 */
export function normalizeAndHashMetaUserData(input: MetaUserDataInput): {
  em?: string[];
  external_id?: string[];
} {
  const out: { em?: string[]; external_id?: string[] } = {};

  if (input.email != null) {
    const norm = String(input.email).trim().toLowerCase();
    if (norm) {
      out.em = [sha256HexLower(norm)];
    }
  }

  if (input.externalId != null) {
    const raw = String(input.externalId).trim();
    if (raw) {
      out.external_id = [sha256HexLower(raw)];
    }
  }

  return out;
}
