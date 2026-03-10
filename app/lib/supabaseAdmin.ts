import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  // 1. берем URL из переменных окружения
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  // 2. берем service role key
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 3. проверяем что всё есть
  if (!url) {
    throw new Error("SUPABASE_URL или NEXT_PUBLIC_SUPABASE_URL не найден");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY не найден");
  }

  // 4. создаем admin client
  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
  });
}