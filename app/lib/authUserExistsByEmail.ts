import type { SupabaseClient } from "@supabase/supabase-js";

/** Проверка существования пользователя Auth по email (admin listUsers, полная пагинация). */
export async function authUserExistsByEmail(admin: SupabaseClient, email: string): Promise<boolean> {
  const em = email.trim().toLowerCase();
  if (!em) return false;

  let page = 1;
  const perPage = 100;
  const maxPages = 2000;

  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data.users;
    if (users.some((u) => (u.email ?? "").trim().toLowerCase() === em)) return true;
    const nextPage = data.nextPage;
    const lastPage = typeof data.lastPage === "number" ? data.lastPage : page;
    if (users.length < perPage || nextPage == null || nextPage <= page || page >= lastPage) break;
    page = nextPage;
  }
  return false;
}
