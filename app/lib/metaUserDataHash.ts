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

export type HashMetaPhoneForCapiOpts = {
  /**
   * При `META_DEFAULT_PHONE_CC_DIGITS=7` автоматически добавляем «7» к 10 цифрам, начинающимся с 9
   * (типовой мобильный РФ без кода). Иные коды стран здесь не дописываем — не угадываем формат.
   */
  defaultCallingCodeDigits?: string | null;
};

/**
 * Телефон для CAPI `ph`: только цифры, затем SHA-256 (UTF-8).
 * Короткие строки отбрасываем (меньше 8 цифр — не отправляем).
 */
export function hashMetaPhoneForCapi(
  raw: string | null | undefined,
  opts?: HashMetaPhoneForCapiOpts
): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, "");
  const cc = opts?.defaultCallingCodeDigits?.trim();
  if (cc === "7" && digits.length === 10 && digits.startsWith("9")) {
    digits = `7${digits}`;
  }
  if (digits.length < 8) return null;
  return sha256HexLower(digits);
}

/**
 * Полное ФИО из одного поля → fn / ln (lowercase, SHA-256), формат Meta (массивы).
 */
export function hashMetaFirstLastNameForCapi(fullName: string): { fn?: string[]; ln?: string[] } {
  const t = fullName.trim().replace(/\s+/g, " ");
  if (!t) return {};
  const i = t.indexOf(" ");
  if (i === -1) {
    return { fn: [sha256HexLower(t.toLowerCase())] };
  }
  const first = t.slice(0, i).toLowerCase();
  const last = t.slice(i + 1).toLowerCase();
  const out: { fn?: string[]; ln?: string[] } = { fn: [sha256HexLower(first)] };
  if (last.length) out.ln = [sha256HexLower(last)];
  return out;
}
