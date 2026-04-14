/** Понятный текст вместо англоязычных строк Supabase Auth. */
export function formatAuthErrorMessage(raw: string): string {
  const t = raw.trim();
  if (/invalid\s+login\s+credentials/i.test(t)) {
    return "Неправильный логин или пароль";
  }
  return t;
}
