# BoardIQ — Auth / Redirect Refactor Report

## SECTION 1 — WHAT WAS CHANGED

**Новые файлы**

- **app/lib/auth/getCurrentUserContext.ts** — единый server-side хелпер: получает user (Supabase auth), memberships (organization_members), список projects (по org-роли или project_members), activeProject (cookie `active_project_id` или первый проект), roleMap (project_id → role). Используется для решения post-login redirect и контекста.

- **app/lib/auth/getPostLoginRedirect.ts** — единый резолвер post-login redirect: по контексту возвращает путь: нет user → `/login`, нет проектов → `/app/projects`, есть active project → `/app?project_id=...`, иначе первый проект.

- **app/lib/auth/requireProjectAccess.ts** — server-only проверка доступа к проекту: userId + projectId → проверка organization_members и (org role или project_members), возвращает `{ membership, project, role }` или `null`. Редиректы не делает.

**Изменённые файлы**

- **app/app/page.tsx** — переписан как server component: читает `searchParams`, вызывает `getCurrentUserContext()`; при отсутствии user — `redirect("/login")`; при отсутствии `project_id` в URL — `redirect(getPostLoginRedirect(context))`; при наличии `project_id` — `requireProjectAccess(user.id, projectId)`, при отсутствии доступа — `redirect("/app/projects")`, иначе рендер `AppDashboardPageClient`. Вся логика входа в app и выбора проекта перенесена на сервер.

- **app/app/AppDashboardClient.tsx** — убрана auth/access логика: удалён `useEffect` с getUser, organization_members, allowedIds и `setAccessChecked`; удалены state `accessChecked` и проверка `if (!accessChecked) return null`; все зависимости от `accessChecked` в других `useEffect` заменены на проверку только `projectId`. Компонент только отображает дашборд и данные; доступ к проекту гарантируется серверной страницей.

**Без изменений (по заданию)**

- **app/app/AppDashboardPageClient.tsx** — оставлен минимальный guard: при отсутствии `project_id` в URL — `router.replace("/app/projects")` и `return null` (на случай клиентской навигации на `/app` без query).
- **middleware.ts** — не трогался (минимальная логика: защита private routes, редирект с /login при наличии user).
- Meta OAuth, login page, остальные страницы — не менялись.

---

## SECTION 2 — NEW AUTH FLOW

1. **Запрос на /app (без или с project_id)**  
   - Обрабатывается **middleware**: при отсутствии сессии → redirect на `/login?next=...`.  
   - Запрос доходит до **app/app/page.tsx** (Server Component).

2. **app/app/page.tsx (server)**  
   - Читает `searchParams` (await, Next 15).  
   - Вызывает `getCurrentUserContext()` (user, memberships, projects, activeProject, roleMap).  
   - Если `!context.user` → `redirect("/login")`.  
   - Если в URL нет `project_id` → `redirect(getPostLoginRedirect(context))`:  
     - нет проектов → `/app/projects`;  
     - есть active/first project → `/app?project_id=...`.  
   - Если в URL есть `project_id` → `requireProjectAccess(context.user.id, projectId)`; при `null` → `redirect("/app/projects")`, иначе рендер `<Suspense><AppDashboardPageClient /></Suspense>`.

3. **После логина (LoginPageClient)**  
   - По-прежнему `router.replace(nextPath)`; по умолчанию `nextPath = "/app/projects"`.  
   - Пользователь попадает на список проектов; при переходе по ссылке «Открыть проект» или при прямом заходе на `/app` сервер уже решает redirect через `getPostLoginRedirect` и при необходимости отдаёт дашборд с валидным `project_id`.

4. **Клиент (AppDashboardPageClient / AppDashboardClient)**  
   - AppDashboardPageClient: при отсутствии `project_id` в URL — один раз редирект на `/app/projects` (страховка).  
   - AppDashboardClient: только UI и запросы по `project_id` из URL; проверок доступа и редиректов по auth/access нет.

5. **Остальные страницы (/app/projects, /app/accounts, …)**  
   - Не менялись: по-прежнему сами проверяют user и доступ при необходимости. В рамках рефактора централизованы только вход в app и доступ к дашборду по `project_id`.

---

## SECTION 3 — FILES CHANGED

| Файл | Действие |
|------|----------|
| app/lib/auth/getCurrentUserContext.ts | Создан |
| app/lib/auth/getPostLoginRedirect.ts | Создан |
| app/lib/auth/requireProjectAccess.ts | Создан |
| app/app/page.tsx | Переписан (server redirect + доступ) |
| app/app/AppDashboardClient.tsx | Удалена auth/access логика и accessChecked |

---

## SECTION 4 — FULL CODE

### app/lib/auth/getCurrentUserContext.ts

```ts
import { cookies } from "next/headers";
import { createServerSupabase } from "@/app/lib/supabaseServer";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];
const COOKIE_ACTIVE_PROJECT = "active_project_id";

export type Membership = {
  organization_id: string;
  role: string;
};

export type Project = {
  id: string;
  name: string | null;
  organization_id: string | null;
};

export type CurrentUserContext = {
  user: { id: string; email?: string } | null;
  memberships: Membership[];
  projects: Project[];
  activeProject: Project | null;
  roleMap: Record<string, string>;
};

/**
 * Server-only. Returns current user, org memberships, accessible projects,
 * active project (from cookie or first), and project_id -> role map.
 */
export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const empty: CurrentUserContext = {
    user: null,
    memberships: [],
    projects: [],
    activeProject: null,
    roleMap: {},
  };

  if (!user) return empty;

  const { data: memRows } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id);

  const memberships: Membership[] = (memRows ?? []).map((r) => ({
    organization_id: r.organization_id,
    role: r.role ?? "member",
  }));

  if (memberships.length === 0) {
    return {
      user: { id: user.id, email: user.email ?? undefined },
      memberships: [],
      projects: [],
      activeProject: null,
      roleMap: {},
    };
  }

  const orgRole = memberships[0]!.role;
  let projects: Project[] = [];
  const roleMap: Record<string, string> = {};

  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id, name, organization_id")
      .eq("organization_id", memberships[0]!.organization_id);
    projects = (projs ?? []) as Project[];
    projects.forEach((p) => {
      roleMap[p.id] = orgRole;
    });
  } else {
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", user.id);
    const rows = (pms ?? []) as { project_id: string; role: string }[];
    const projectIds = rows.map((r) => r.project_id);
    rows.forEach((r) => {
      roleMap[r.project_id] = r.role ?? "member";
    });
    const { data: projs } = await supabase
      .from("projects")
      .select("id, name, organization_id")
      .in("id", projectIds);
    const projMap = new Map(((projs ?? []) as Project[]).map((p) => [p.id, p]));
    projects = projectIds.map((id) => projMap.get(id)).filter(Boolean) as Project[];
  }

  const cookieStore = await cookies();
  const activeId = cookieStore.get(COOKIE_ACTIVE_PROJECT)?.value?.trim();
  const activeProject: Project | null =
    (activeId ? projects.find((p) => p.id === activeId) ?? null : null) ?? projects[0] ?? null;

  return {
    user: { id: user.id, email: user.email ?? undefined },
    memberships,
    projects,
    activeProject,
    roleMap,
  };
}
```

### app/lib/auth/getPostLoginRedirect.ts

```ts
import type { CurrentUserContext } from "./getCurrentUserContext";

/**
 * Server-only. Resolves where to send the user after login.
 * - No user → /login
 * - No projects → /app/projects (project selection / empty state)
 * - Has active project → /app?project_id=...
 * - Has projects but no active → first project
 */
export function getPostLoginRedirect(context: CurrentUserContext): string {
  if (!context.user) return "/login";
  if (!context.projects.length) return "/app/projects";
  const projectId = context.activeProject?.id ?? context.projects[0]?.id;
  if (!projectId) return "/app/projects";
  return `/app?project_id=${encodeURIComponent(projectId)}`;
}
```

### app/lib/auth/requireProjectAccess.ts

```ts
import { createServerSupabase } from "@/app/lib/supabaseServer";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];

export type ProjectAccessResult = {
  membership: { organization_id: string; role: string };
  project: { id: string; name: string | null; organization_id: string | null };
  role: string;
};

/**
 * Server-only. Checks if user has access to the project.
 * Returns membership + project + role, or null if no access.
 * Does not perform redirects.
 */
export async function requireProjectAccess(
  userId: string,
  projectId: string
): Promise<ProjectAccessResult | null> {
  const supabase = await createServerSupabase();

  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!mem) return null;

  const orgRole = (mem.role ?? "member") as string;
  let allowedIds: string[] = [];

  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", mem.organization_id);
    allowedIds = (projs ?? []).map((p: { id: string }) => p.id);
  } else {
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId);
    allowedIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
  }

  if (!allowedIds.includes(projectId)) return null;

  const { data: proj } = await supabase
    .from("projects")
    .select("id, name, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) return null;

  let role = orgRole;
  if (!ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: pm } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    role = (pm?.role as string) ?? "member";
  }

  return {
    membership: { organization_id: mem.organization_id, role: mem.role ?? "member" },
    project: {
      id: proj.id,
      name: proj.name ?? null,
      organization_id: proj.organization_id ?? null,
    },
    role,
  };
}
```

### app/app/page.tsx

```tsx
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";
import { getPostLoginRedirect } from "@/app/lib/auth/getPostLoginRedirect";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import AppDashboardPageClient from "./AppDashboardPageClient";

export const dynamic = "force-dynamic";

function AppDashboardFallback() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]"
      style={{ gridColumn: "2 / -1" }}
    >
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * /app entry: server-side auth and project resolution.
 * - No user → redirect /login
 * - No project_id in URL → getPostLoginRedirect → redirect
 * - project_id in URL → requireProjectAccess; no access → /app/projects; else render dashboard
 */
export default async function AppDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const projectId = (typeof params.project_id === "string" ? params.project_id : params.project_id?.[0])?.trim();

  const context = await getCurrentUserContext();

  if (!context.user) {
    redirect("/login");
  }

  if (!projectId) {
    redirect(getPostLoginRedirect(context));
  }

  const access = await requireProjectAccess(context.user.id, projectId);
  if (!access) {
    redirect("/app/projects");
  }

  return (
    <Suspense fallback={<AppDashboardFallback />}>
      <AppDashboardPageClient />
    </Suspense>
  );
}
```

### app/app/AppDashboardClient.tsx (фрагмент: что убрано и как выглядит начало)

Удалено: константа `ORG_ROLES_ALL_PROJECTS`, state `accessChecked`, весь `useEffect` с getUser/organization_members/allowedIds/setAccessChecked, блок `if (!accessChecked) return null`, все упоминания `accessChecked` в зависимостях и условиях других эффектов.

Начало компонента после правок:

```tsx
export default function AppDashboardClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const projectId = sp.get("project_id") || "";

  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  // ... остальной state и логика без accessChecked
```

Остальная часть файла (запросы данных, UI, обновление URL для дат) без изменений.

---

## SECTION 5 — NOTES (технический долг)

1. **Cookie vs localStorage для active project**  
   Серверный `getCurrentUserContext` читает активный проект из cookie `active_project_id`. В Sidebar и других клиентских местах по-прежнему используется `localStorage` (`active_project_id`). Чтобы серверный redirect после логина учитывал «последний выбранный» проект, нужно при смене проекта на клиенте также выставлять cookie (например через API route или middleware). Сейчас при первом заходе после логина используется первый проект или cookie, если она уже установлена.

2. **Остальные страницы app**  
   `/app/projects`, `/app/accounts`, `/app/project-members`, `/app/org-members`, `/app/projects/new` и т.д. по-прежнему делают собственные проверки user и доступа в useEffect. Их можно постепенно переводить на `getCurrentUserContext` / `requireProjectAccess` в server layout или в каждой page, без срочного рефактора.

3. **Login → куда редиректить**  
   Сейчас после логина клиент редиректит на `nextPath` (по умолчанию `/app/projects`). Можно единообразно редиректить на `/app` и положиться на серверный `getPostLoginRedirect` (тогда один раз загрузка /app и сразу redirect на `/app?project_id=...` или `/app/projects`). Не менялось, чтобы не трогать текущий сценарий «сразу список проектов».

4. **Onboarding**  
   Маршрутов onboarding по-прежнему нет; в `getPostLoginRedirect` они не учитываются.

5. **Типы и RLS**  
   `getCurrentUserContext` и `requireProjectAccess` используют anon-клиент через `createServerSupabase()` (cookies пользователя). Для таблиц с RLS (например `organization_members`) запросы выполняются в контексте текущего пользователя; для таблиц без RLS или с более широкими политиками поведение как раньше.
