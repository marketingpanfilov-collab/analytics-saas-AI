# BoardIQ — техническая сводка: Auth / Redirect Flow (для внешнего архитектора)

**Важно:** В коде не найдены сущности `getCurrentUserContext`, `requireProjectAccess`, `getPostLoginRedirect`. Роутов/папок **onboarding** в проекте нет. Ниже описан только фактический код.

---

## SECTION 1 — CURRENT AUTH FLOW

Пошаговый flow по текущему коду:

1. **Заход на защищённый путь (например `/app` или `/app/projects`)**
   - Запрос попадает в **middleware.ts** (matcher: `["/app/:path*", "/login"]`).
   - `createServerClient` (Supabase SSR) читает cookies, вызывается `supabase.auth.getUser()`.
   - Если `user` отсутствует: редирект на `/login?next=<pathname>` (pathname — полный путь, например `/app` или `/app/projects`).
   - Если `user` есть и pathname начинается с `/login`: редирект на `/app/projects` (url.search сбрасывается).
   - Иначе — `NextResponse.next()`, запрос идёт дальше.

2. **Страница логина**
   - **app/login/page.tsx** — серверная обёртка: рендерит `<Suspense><LoginPageClient /></Suspense>`.
   - **app/login/LoginPageClient.tsx** (client):
     - Читает `next` из `useSearchParams()`.
     - `nextPath = useMemo`: если нет `next` или не начинается с `/` → `/app/projects`; если `next` равен `/app` или `/app/` → `/app/projects`; иначе `nextPath = next`.
     - При успешном `signInWithPassword` или `signUp` (с сессией) вызывается `router.replace(nextPath)` — переход на вычисленный nextPath без обновления middleware (уже авторизован).

3. **Session creation**
   - Сессия создаётся на стороне Supabase при `signInWithPassword` / `signUp`; cookies выставляет Supabase SSR (браузерный клиент `supabase` из `app/lib/supabaseClient.ts`).
   - Отдельного auth callback (Supabase Auth callback URL) в коде не видно; используется только cookie-based session.

4. **Post-login redirect**
   - Определяется только в **LoginPageClient**: сразу после успешного логина/регистрации `router.replace(nextPath)`.
   - Middleware при следующем запросе на `/login` уже редиректит на `/app/projects` (если пользователь снова откроет /login).

5. **App entry (заход на /app без project_id)**
   - **app/app/page.tsx** рендерит `<Suspense><AppDashboardPageClient /></Suspense>`.
   - **AppDashboardPageClient** читает `project_id` из `useSearchParams()`. Если пусто — в `useEffect` вызывается `router.replace("/app/projects")`, до установки accessChecked рендер возвращает `null`. То есть вход на `/app` без project_id ведёт на выбор проектов.

6. **Project access checks (внутри app)**
   - В **AppDashboardClient** (дашборд): после установки projectId вызывается `supabase.auth.getUser()`, затем запрос к `organization_members` по `user_id`, затем в зависимости от роли — список проектов организации или `project_members` по user_id; проверяется, что текущий `projectId` входит в список разрешённых; иначе `router.replace("/app/projects")`. При отсутствии пользователя — `router.replace("/login")`.
   - Аналогичные проверки (user → organization_members или project_members → разрешённый проект) делаются в: **ProjectsPageClient**, **ProjectMembersPageClient**, **OrgMembersPage**, **app/app/projects/new/page.tsx**, **AccountsPageClient** (плюс project_id в URL). Никакой единой функции `requireProjectAccess` нет — логика дублируется по страницам.

7. **OAuth (Meta / Google)**
   - Старт: **/api/oauth/meta/start** и **/api/oauth/google/start** принимают `project_id` и `return_to`; редирект на провайдера; state/cookies сохраняют return_to и project_id.
   - Callback: **/api/oauth/meta/callback** и **/api/oauth/google/callback** по завершении OAuth делают `NextResponse.redirect(returnTo)` (returnTo из state/cookie, fallback например `/app/accounts?project_id=...`). Это не post-login redirect в смысле «после логина в приложение», а возврат после привязки рекламного кабинета.

8. **Invite accept**
   - **app/app/invite/accept**: InviteAcceptClient читает `token` из searchParams, валидирует через API, при успешном accept вызывает `router.replace(\`/app?project_id=${json.project_id}\`)` — ведёт на дашборд с выбранным проектом.

9. **Reset password**
   - **app/reset/page.tsx**: после успешного `updateUser({ password })` и `signOut()` вызывается `router.replace("/login")`.

---

## SECTION 2 — REDIRECT POINTS

| # | File path | Function / component | Куда редиректит | Условие |
|---|-----------|----------------------|------------------|--------|
| 1 | middleware.ts | middleware() | /login | pathname.startsWith("/app") && !user |
| 2 | middleware.ts | middleware() | /app/projects | pathname.startsWith("/login") && user |
| 3 | app/login/LoginPageClient.tsx | onSubmit (login) | nextPath | успешный signInWithPassword |
| 4 | app/login/LoginPageClient.tsx | onSubmit (signup) | nextPath | успешный signUp и есть data.session |
| 5 | app/app/AppDashboardPageClient.tsx | useEffect | /app/projects | !projectId из searchParams |
| 6 | app/app/AppDashboardClient.tsx | useEffect | /app/projects | !projectId |
| 7 | app/app/AppDashboardClient.tsx | useEffect | /login | !user |
| 8 | app/app/AppDashboardClient.tsx | useEffect | /app/projects | !mem (organization_members) |
| 9 | app/app/AppDashboardClient.tsx | useEffect | /app/projects | !allowedIds.includes(projectId) |
| 10 | app/app/AppDashboardClient.tsx | (другой useEffect, строка 725) | тот же pathname + обновлённые search params | обновление query (scroll: false) — не смена маршрута, а обновление URL |
| 11 | app/app/components/projects/ProjectsPageClient.tsx | useEffect | /login | !u (getUser) |
| 12 | app/app/components/projects/ProjectsPageClient.tsx | useEffect | /app/projects | !memRow после bootstrap |
| 13 | app/app/components/projects/ProjectsPageClient.tsx | onOpen (кнопка) | /app?project_id=<id> | router.push при клике «Открыть проект» |
| 14 | app/app/project-members/ProjectMembersPageClient.tsx | useEffect | /app/projects | !projectId |
| 15 | app/app/project-members/ProjectMembersPageClient.tsx | useEffect | /login | !u |
| 16 | app/app/project-members/ProjectMembersPageClient.tsx | useEffect | /app?project_id=... | нет доступа к проекту (редирект на дашборд с этим project_id в нескольких ветках) |
| 17 | app/app/org-members/page.tsx | useEffect | /login | !u |
| 18 | app/app/org-members/page.tsx | useEffect | /app/projects | !mem или роль не в ORG_ROLES_ALLOWED |
| 19 | app/app/projects/new/page.tsx | useEffect | /login | !u |
| 20 | app/app/projects/new/page.tsx | useEffect | /app/projects | !mem или роль не может создавать проект |
| 21 | app/app/projects/new/page.tsx | handleSubmit | /app?project_id=<proj.id> | успешное создание проекта |
| 22 | app/app/invite/accept/InviteAcceptClient.tsx | handleAccept | /app?project_id=<json.project_id> | успешный accept invite |
| 23 | app/app/components/Topbar.tsx | logout | /login | после signOut() |
| 24 | app/reset/page.tsx | onSubmit | /login | после updateUser + signOut |
| 25 | app/api/oauth/meta/start/route.ts | GET | /app/accounts?connected=meta_error&reason=project_id_missing | !projectId в query |
| 26 | app/api/oauth/meta/callback/route.ts | GET | returnTo (state/cookie или fallback) | после обработки OAuth |
| 27 | app/api/oauth/google/callback/route.ts | GET | back (returnTo + query) или successUrl | при ошибке или успехе OAuth |

---

## SECTION 3 — PROJECT CONTEXT / MEMBERSHIP LOGIC

- **Current user**  
  Везде получается на клиенте через `supabase.auth.getUser()` (из `app/lib/supabaseClient.ts`). Серверный вариант — `createServerSupabase()` из `app/lib/supabaseServer.ts` (используется в API routes), в layout/page app-зоны пользователь на сервере не запрашивается; в **app/app/layout.tsx** только `getUser()` в useEffect для отображения email в Topbar.

- **Memberships**  
  - **organization_members**: запросы из AppDashboardClient, ProjectsPageClient, OrgMembersPage, ProjectMembersPageClient, projects/new — по `user_id = u.id`, выборка `organization_id`, `role`.  
  - **project_members**: запросы из тех же мест и API (project-members/list, project-invites и т.д.) — для проверки доступа к конкретному проекту и списка участников.

- **Projects**  
  Список проектов для пользователя: в **ProjectsPageClient** — если роль org owner/admin, то проекты по `organization_id` из `organization_members`; иначе — `project_members` по user_id, затем проекты по этим project_id. Данные для карточек — из `projects` + маппинг ролей из `project_members`.  
  **Примечание:** В `bootstrapFirstUser` (ProjectsPageClient) при создании организации в `organizations` передаётся `owner_user_id`; в миграции `20250307000001_multi_tenant_organizations.sql` таблица `organizations` не содержит колонки `owner_user_id` — возможное расхождение схемы или колонка добавлена другой миграцией.

- **Active project**  
  Единого контекста (React context/store) нет. Активный проект определяется:  
  - из URL: `useSearchParams().get("project_id")` в AppDashboardPageClient, AppDashboardClient, Sidebar, AccountsPageClient, PixelsPageClient, ProjectMembersPageClient;  
  - в Sidebar дополнительно `localStorage.getItem("active_project_id")`; при наличии `project_id` в URL Sidebar пишет его в localStorage. На странице выбора проектов (`/app/projects`) Sidebar выставляет projectId в null и не восстанавливает из storage для этой страницы.

- **Project access**  
  Проверка «пользователь имеет доступ к проекту» реализована локально в каждой странице/клиенте: getUser → organization_members → по роли список allowed project ids (из projects по organization_id или из project_members по user_id) → проверка, что текущий project_id в списке. Отдельной функции `requireProjectAccess` или единого guard нет.

- **Post-login redirect (вычисление)**  
  Вычисляется только в **LoginPageClient**: `nextPath` из query `next` с правилами: по умолчанию `/app/projects`, явный `/app` или `/app/` заменяется на `/app/projects`. Функции с именем `getPostLoginRedirect` в коде нет.

---

## SECTION 4 — GUARDS

- **Middleware (middleware.ts)**  
  - Guard 1: путь начинается с `/app` и нет user → redirect на `/login?next=<pathname>`.  
  - Guard 2: путь начинается с `/login` и есть user → redirect на `/app/projects`.  
  Матчер: `["/app/:path*", "/login"]`. Роуты `/reset`, `/`, OAuth callback и т.д. middleware не обрабатывает.

- **Layout**  
  **app/app/layout.tsx** не проверяет авторизацию и не редиректит; только рендер Sidebar + Topbar + children. Проверки доступа — в дочерних страницах (client components).

- **Page-level checks**  
  В каждой из перечисленных страниц после монтирования выполняется свой useEffect: getUser, при отсутствии пользователя — redirect на /login; затем загрузка organization_members / project_members и проверка доступа к проекту/организации, при неудаче — redirect на /app/projects или на /app?project_id=.... Список: AppDashboardClient, ProjectsPageClient, ProjectMembersPageClient, OrgMembersPage, projects/new, AccountsPageClient (плюс обработка OAuth query params и project_id).

- **requireProjectAccess**  
  В коде не найден.

---

## SECTION 5 — ROUTE TREE

```
/ ................................. landing (app/page.tsx), ссылки на /app, /login
/login ............................ app/login/page.tsx → Suspense → LoginPageClient
/reset ............................ app/reset/page.tsx (сброс пароля, после успеха → /login)

/app .............................. app/app/page.tsx → Suspense → AppDashboardPageClient
                                    (нет project_id → redirect /app/projects)
/app/reports ...................... (страница отчётов)
/app/ltv
/app/utm-builder
/app/pixels ....................... app/app/pixels/page.tsx → Suspense → PixelsPageClient
/app/accounts ..................... app/app/accounts/page.tsx → Suspense → AccountsPageClient
/app/project-members .............. app/app/project-members/page.tsx → Suspense → ProjectMembersPageClient
/app/org-members .................. app/app/org-members/page.tsx (client)
/app/projects ..................... app/app/projects/page.tsx → ProjectsPageClient
/app/projects/new ................. app/app/projects/new/page.tsx
/app/invite/accept ................ app/app/invite/accept/page.tsx → Suspense → InviteAcceptClient
/app/settings
/app/...

Auth callback routes (API, не страницы):
  GET /api/oauth/meta/start ....... редирект на Meta OAuth
  GET /api/oauth/meta/callback ..... обмен code, запись интеграции, redirect returnTo
  GET /api/oauth/google/start ..... редирект на Google OAuth
  GET /api/oauth/google/callback ... обмен code, запись интеграции, redirect returnTo

Middleware: matcher ["/app/:path*", "/login"]
  /onboarding ...................... в проекте отсутствует
```

---

## SECTION 6 — useSearchParams USAGE

| File path | Назначение |
|-----------|------------|
| app/login/LoginPageClient.tsx | Чтение `next` для post-login redirect (nextPath). |
| app/app/AppDashboardPageClient.tsx | Чтение `project_id` для решения редиректа на /app/projects и передачи в AppDashboardClient. |
| app/app/AppDashboardClient.tsx | Чтение `project_id`, дат (start/end) для запросов и обновления URL. |
| app/app/components/Sidebar.tsx | Чтение `project_id` и pathname для синхронизации активного проекта с URL и localStorage. |
| app/app/accounts/AccountsPageClient.tsx | Чтение `project_id`, `reason`, `connected` для OAuth return и отображения ошибок. |
| app/app/pixels/PixelsPageClient.tsx | Чтение `project_id` из URL. |
| app/app/project-members/ProjectMembersPageClient.tsx | Чтение `project_id` для загрузки участников и проверки доступа. |
| app/app/invite/accept/InviteAcceptClient.tsx | Чтение `token` из query для приглашения. |

Все эти компоненты обёрнуты в Suspense на уровне страницы или родителя (app layout для Sidebar), чтобы избежать prerender-ошибок из-за useSearchParams.

---

## SECTION 7 — TOP FAILURE POINTS (почему может ломаться redirect после login)

1. **Редирект на /app без project_id**  
   С лендинга или из закладок пользователь может попадать на `/app`. Middleware не редиректит (user есть), открывается app layout и AppDashboardPageClient; тот сразу делает `router.replace("/app/projects")`. Возможен короткий «мигающий» переход или двойной переход, если на клиенте есть задержка гидрации или race между несколькими редиректами.

2. **Параметр `next` после логина**  
   Если неавторизованный пользователь зашёл на `/app` (или другую защищённую страницу), middleware перенаправил на `/login?next=/app`. В LoginPageClient значение `/app` явно заменяется на `/app/projects`, поэтому после логина пользователь должен попадать на /app/projects. Если где-то ещё подставляется «сырой» next без этой замены или приходит next без project_id для страниц, требующих project_id (например `/app/accounts`), пользователь может оказаться на странице без project_id и получить повторный редирект или пустой экран.

3. **Порядок выполнения: middleware vs client redirect**  
   После логина вызывается только `router.replace(nextPath)` на клиенте. Cookie сессии могут быть установлены не сразу или не успеть попасть в следующий запрос. Если пользователь после логина сразу переходит на /app/projects, этот запрос снова проходит через middleware; если по какой-то причине middleware ещё не видит user (например, из-за порядка установки cookies), возможен редирект обратно на /login с новым `next`, что создаёт путаницу или цикл.

4. **Разрозненные проверки доступа и редиректы**  
   В AppDashboardClient после установки projectId выполняется асинхронная проверка (getUser → organization_members → projects/project_members). До завершения accessChecked рендер дашборда уже может показывать fallback или пустое состояние. Если в этот момент срабатывает редирект (например, «нет доступа» → /app/projects), пользователь видит кратковременный «пустой» дашборд или двойное переключение.

5. **Sidebar и localStorage**  
   На /app/projects Sidebar обнуляет projectId и не подставляет его из localStorage. При переходе «Дашборд» по ссылке без project_id (withProjectId("/app") при отсутствии projectId возвращает просто "/app") пользователь уходит на `/app`, и уже AppDashboardPageClient редиректит на /app/projects. Для сценария «выбрал проект → перешёл в аккаунты → вернулся» возврат может зависеть от того, сохранился ли project_id в URL или в localStorage и как именно страница его читает.

6. **OAuth return_to и project_id**  
   После Meta/Google OAuth редирект идёт в returnTo (например /app/accounts?project_id=...). Если в момент старта OAuth return_to или project_id не были сохранены в state/cookie (или потерялись), callback может редиректить на страницу без project_id; тогда логика в AccountsPageClient пытается восстановить project из localStorage или редиректит — возможны лишние редиректы или «пустая» страница.

7. **Отсутствие единого места для post-login redirect**  
   Нет централизованной функции типа getPostLoginRedirect; логика размазана между middleware (только «уже залогинен — уходи с /login») и LoginPageClient (nextPath). Любое изменение требований (например, всегда после логина идти в onboarding или в конкретный раздел) потребует правок в нескольких местах и легко создаёт несогласованность.

---

## SECTION 8 — FILES TO SEND

**Critical (обязательно для аудита auth/redirect):**

- middleware.ts
- app/login/page.tsx
- app/login/LoginPageClient.tsx
- app/app/layout.tsx
- app/app/page.tsx
- app/app/AppDashboardPageClient.tsx
- app/app/AppDashboardClient.tsx (целиком или минимум до конца всех redirect/access useEffect)
- app/app/components/projects/ProjectsPageClient.tsx
- app/app/projects/page.tsx
- app/lib/supabaseClient.ts
- app/lib/supabaseServer.ts

**Important (контекст проекта, доступ, страницы с редиректами):**

- app/app/project-members/page.tsx
- app/app/project-members/ProjectMembersPageClient.tsx
- app/app/org-members/page.tsx
- app/app/projects/new/page.tsx
- app/app/accounts/page.tsx
- app/app/accounts/AccountsPageClient.tsx
- app/app/invite/accept/page.tsx
- app/app/invite/accept/InviteAcceptClient.tsx
- app/app/components/Sidebar.tsx
- app/app/components/Topbar.tsx
- app/reset/page.tsx

**Optional (OAuth и API redirect):**

- app/api/oauth/meta/start/route.ts
- app/api/oauth/meta/callback/route.ts
- app/api/oauth/google/start/route.ts
- app/api/oauth/google/callback/route.ts
- middleware.off.ts (если используется отключённый вариант)

---

## SECTION 9 — FULL CODE (critical files)

### middleware.ts

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = pathname.startsWith("/app");

  // 1) Protect private routes
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 2) If already logged in — redirect to project selection (never default to /app)
  if (pathname.startsWith("/login") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app/projects";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login"],
};
```

### app/login/page.tsx

```tsx
import { Suspense } from "react";
import LoginPageClient from "./LoginPageClient";

export const dynamic = "force-dynamic";

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b10]">
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageClient />
    </Suspense>
  );
}
```

### app/login/LoginPageClient.tsx (full)

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

type Mode = "login" | "signup";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Post-login: project selection first; never default to /app (dashboard without project_id)
  const nextPath = useMemo(() => {
    const n = searchParams.get("next");
    if (!n || !n.startsWith("/")) return "/app/projects";
    if (n === "/app" || n === "/app/") return "/app/projects";
    return n;
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const onSubmit = async () => {
    setMsg("");

    if (!email.trim()) return setMsg("Введите email");
    if (!password.trim()) return setMsg("Введите пароль");

    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) return setMsg(error.message);

        router.replace(nextPath);
        return;
      }

      // signup
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) return setMsg(error.message);

      // Если в Supabase включено подтверждение почты — сессии сразу не будет.
      // Тогда покажем подсказку.
      if (!data.session) {
        setMsg("✅ Аккаунт создан. Проверь почту и подтвердите email, затем войдите.");
        setMode("login");
        return;
      }

      router.replace(nextPath);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setMsg("");

    if (!email.trim()) return setMsg("Введите email для восстановления пароля");

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "http://localhost:3000/reset",
      });

      if (error) return setMsg(error.message);

      setMsg("✅ Письмо для сброса пароля отправлено. Проверь почту.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow} />
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.h1}>{mode === "login" ? "Вход в аккаунт" : "Регистрация"}</div>
            <div style={styles.sub}>
              {mode === "login"
                ? "Зайдите, чтобы открыть панель отчётности и подключить рекламные аккаунты."
                : "Создайте аккаунт, чтобы начать собирать отчётность по рекламе в одном месте."}
            </div>
          </div>
          <div style={styles.segment}>
            <button type="button" onClick={() => setMode("login")} style={{ ...styles.segmentBtn, ...(mode === "login" ? styles.segmentBtnActive : {}) }} disabled={loading}>Вход</button>
            <button type="button" onClick={() => setMode("signup")} style={{ ...styles.segmentBtn, ...(mode === "signup" ? styles.segmentBtnActive : {}) }} disabled={loading}>Регистрация</button>
          </div>
        </div>
        <div style={styles.form}>
          <label style={styles.label}>Email</label>
          <input style={styles.input} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <label style={styles.label}>Пароль</label>
          <input style={styles.input} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          <button type="button" onClick={onSubmit} style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }} disabled={loading}>
            {loading ? "Подождите..." : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
          <button type="button" onClick={resetPassword} style={styles.linkBtn} disabled={loading}>Забыли пароль?</button>
          {msg ? <div style={styles.message}>{msg}</div> : null}
          <div style={styles.footerNote}>© 2026 Analytics SaaS — Internal MVP</div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", padding: 24, background: "radial-gradient(1200px 700px at 70% 30%, rgba(88, 255, 202, 0.10), transparent 60%), #0b0b10", color: "rgba(255,255,255,0.92)", fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"', position: "relative", overflow: "hidden" },
  bgGlow: { position: "absolute", inset: -200, background: "radial-gradient(700px 700px at 20% 30%, rgba(106, 117, 255, 0.16), transparent 60%), radial-gradient(800px 800px at 80% 60%, rgba(88, 255, 202, 0.14), transparent 60%)", filter: "blur(20px)", pointerEvents: "none" },
  card: { width: "min(920px, 100%)", borderRadius: 28, background: "rgba(20, 20, 30, 0.72)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 80px rgba(0,0,0,0.55)", backdropFilter: "blur(14px)", padding: 28, position: "relative" },
  headerRow: { display: "flex", gap: 20, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", marginBottom: 18 },
  h1: { fontSize: 34, fontWeight: 750, letterSpacing: -0.6, marginBottom: 6 },
  sub: { maxWidth: 560, fontSize: 16, lineHeight: 1.5, opacity: 0.75 },
  segment: { display: "inline-flex", gap: 6, padding: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" },
  segmentBtn: { border: "none", padding: "10px 14px", borderRadius: 999, background: "transparent", color: "rgba(255,255,255,0.72)", cursor: "pointer", fontWeight: 650 },
  segmentBtnActive: { background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.95)" },
  form: { display: "grid", gap: 12, paddingTop: 6, maxWidth: 520 },
  label: { fontSize: 14, opacity: 0.75, marginTop: 6 },
  input: { width: "100%", borderRadius: 14, padding: "14px 14px", background: "rgba(10,10,14,0.45)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.92)", outline: "none", fontSize: 16 },
  primaryBtn: { marginTop: 10, width: "100%", border: "none", borderRadius: 16, padding: "14px 16px", fontSize: 16, fontWeight: 800, color: "rgba(10,10,14,0.95)", background: "linear-gradient(90deg, rgba(106,117,255,0.95), rgba(88,255,202,0.95))" },
  linkBtn: { marginTop: 4, border: "none", background: "transparent", color: "rgba(168, 190, 255, 0.95)", cursor: "pointer", textAlign: "left", padding: 0, fontSize: 14, opacity: 0.95 },
  message: { marginTop: 10, padding: 14, borderRadius: 14, border: "1px solid rgba(255, 90, 90, 0.20)", background: "rgba(255, 90, 90, 0.08)", fontSize: 14, opacity: 0.95 },
  footerNote: { marginTop: 12, fontSize: 12, opacity: 0.45 },
};
```

### app/app/layout.tsx

```tsx
// app/app/layout.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { supabase } from "../lib/supabaseClient";

function SidebarFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: 300,
        background: "rgba(255,255,255,0.02)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    />
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setEmail(data.user?.email ?? "");
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0b10",
        display: "grid",
        gridTemplateColumns: "260px 1fr",
      }}
    >
      <div style={{ minHeight: "100vh", minWidth: 0 }}>
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar />
        </Suspense>
      </div>
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateRows: "64px 1fr",
        }}
      >
        <div style={{ height: 64 }}>
          <Topbar email={email} />
        </div>
        <main style={{ minHeight: 0 }}>{children}</main>
      </div>
    </div>
  );
}
```

### app/app/page.tsx

```tsx
import { Suspense } from "react";
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

export default function AppDashboardPage() {
  return (
    <Suspense fallback={<AppDashboardFallback />}>
      <AppDashboardPageClient />
    </Suspense>
  );
}
```

### app/app/AppDashboardPageClient.tsx

```tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppDashboardClient from "./AppDashboardClient";

export default function AppDashboardPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";

  useEffect(() => {
    if (!projectId) {
      router.replace("/app/projects");
    }
  }, [projectId, router]);

  if (!projectId) {
    return null;
  }

  return <AppDashboardClient />;
}
```

### app/app/AppDashboardClient.tsx (fragment: redirect and access logic, lines 186–238)

```tsx
export default function AppDashboardClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const projectId = sp.get("project_id") || "";

  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    if (!projectId) {
      router.replace("/app/projects");
      return;
    }
    let mounted = true;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!u) {
        router.replace("/login");
        return;
      }
      const { data: mem } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", u.id)
        .maybeSingle();
      if (!mounted) return;
      if (!mem) {
        router.replace("/app/projects");
        return;
      }
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
          .eq("user_id", u.id);
        allowedIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
      }
      if (!mounted) return;
      if (!allowedIds.includes(projectId)) {
        router.replace("/app/projects");
        return;
      }
      setAccessChecked(true);
    })();
  }, [projectId, router]);
  // ... rest of component
}
```

### app/lib/supabaseClient.ts

```ts
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
```

### app/lib/supabaseServer.ts

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options ?? {})
            );
          } catch {
            // Ignored when called from Server Component / read-only context
          }
        },
      },
    }
  );
}
```

---

**Конец отчёта.**
