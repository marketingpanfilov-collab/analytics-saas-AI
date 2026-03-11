# BoardIQ — Технический аудит: Pixel / Tracking System

Дата: 2025-03-06

---

## SECTION 1 — FILES FOUND

### Frontend / Scripts
| Файл | Найдено |
|------|---------|
| `public/tracker.js` | Клиентский пиксель: генерация `visitor_id` (cookie `as_visitor`), сбор landing_url, referrer, utm_*, gclid, fbclid, yclid, ttclid, touch_type (first/last). Отправка только через **GET pixel** (`/api/tracking/source/pixel`). POST не используется. |

### API routes
| Файл | Найдено |
|------|---------|
| `app/api/tracking/source/route.ts` | **POST** ingest: приём visitor_id, site_id, landing_url, referrer, utm_*, gclid, fbclid, yclid, ttclid, touch_type. Вставка в `visit_source_events`. CORS включён. |
| `app/api/tracking/source/pixel/route.ts` | **GET** pixel beacon: те же поля через query params, вставка в `visit_source_events`, ответ 1x1 GIF. |
| `app/api/tracking/source/status/route.ts` | **GET** status: `?site_id=xxx` — последнее событие по site_id (created_at, landing_url, referrer, source_classification). Проверки доступа к проекту нет. |

### Database
| Файл | Найдено |
|------|---------|
| `supabase/migrations/20250309000000_visit_source_events.sql` | Таблица `visit_source_events`: id, visitor_id, site_id, landing_url, referrer, utm_source/medium/campaign/content/term, gclid, fbclid, yclid, ttclid, source_classification, touch_type, created_at. Индексы по visitor_id, site_id, created_at, (visitor_id, site_id). RLS не настроен. |
| `supabase/migrations/20250307000005_multi_tenant_daily_ad_metrics.sql` | Таблица `daily_ad_metrics`: рекламные метрики (spend, impressions, clicks, **leads**, **purchases**, **revenue**, **roas**) — данные из **платформ** (Meta/Google sync), не из первого пикселя. |
| `supabase/migrations/20250307000006_daily_ad_metrics_add_missing_columns.sql` | Добавление колонок leads, purchases, revenue, roas в daily_ad_metrics. |

### Utils / Libs
| Файл | Найдено |
|------|---------|
| `app/lib/sourceClassification.ts` | Классификация источника: paid, organic_search, organic_social, referral, direct, unknown. Вход: referrer, utm_*, gclid, fbclid, yclid, ttclid. Используется в POST/pixel при вставке в visit_source_events. |

### Pages / UI
| Файл | Найдено |
|------|---------|
| `app/app/(with-sidebar)/pixels/page.tsx` | Обёртка с Suspense, рендер PixelsPageClient. |
| `app/app/(with-sidebar)/pixels/PixelsPageClient.tsx` | Страница BQ Pixel: выбор project_id из URL, генерация сниппета `<script src="{origin}/tracker.js?site_id={projectId}"></script>`, копирование, статус трекера (GET /api/tracking/source/status), блоки "Visit tracking = active", "Registration linkage / Purchase attribution / Revenue attribution = coming soon", Site ID = projectId, Primary domain = "Not configured". |
| `app/app/(with-sidebar)/utm-builder/page.tsx` | UTM Builder: пресеты (meta, google, tiktok, influencer, custom), построение long/short URL с utm_*, cid, aid, fbclid/gclid/ttclid placeholders. **Мок API** (apiCreateLink) — ссылки генерируются на клиенте, **нет бэкенда** для сохранения ссылок и **нет click tracking** (редирект не логируется). |

### Упоминания в коде (не реализация пикселя)
| Файл | Контекст |
|------|----------|
| `app/app/components/Sidebar.tsx` | Ссылки на UTM Builder и BQ Pixel. |
| `app/app/components/Topbar.tsx` | Заголовок "BQ Pixel", уведомление про UTM/атрибуцию. |
| `app/page.tsx` | Лендинг: тексты про utm/click id, Data Health, риски потерь UTM. |
| `app/app/components/NotificationsBell.tsx` | Уведомление "Есть 2 кампании без UTM / source". |
| `app/app/components/CampaignBlocks.tsx` | Текст про атрибуцию/UTM. |
| `app/api/oauth/google/insights/sync/route.ts` | `cid` = внутренний campaign_id (не click id). |
| `app/api/oauth/meta/insights/sync/route.ts` | use_account_attribution_setting, offsite_conversion.fb_pixel_lead/purchase — данные из Meta API. |
| `docs/AUTH_REDIRECT_AUDIT_REPORT.md` | Упоминание страницы pixels и project_id. |

---

## SECTION 2 — CURRENT PIXEL STATUS

**Реализовано:**

1. **Клиентский скрипт**  
   `public/tracker.js`: при загрузке страницы с `?site_id=...` создаёт/читает cookie `as_visitor` (visitor_id), считывает из URL utm_*, gclid, fbclid, yclid, ttclid, referrer, landing_url, определяет first/last touch и отправляет **только GET-пиксель** на `/api/tracking/source/pixel`.

2. **Ingest API**  
   - **GET** `/api/tracking/source/pixel` — используется трекером; пишет в `visit_source_events`.  
   - **POST** `/api/tracking/source` — реализован, но трекер его **не вызывает** (можно использовать для fetch при необходимости).

3. **БД для событий визитов**  
   Таблица `visit_source_events`: один ряд = один визит с атрибуцией (UTM, click id, referrer, source_classification, touch_type).

4. **Сохранение visitor_id / session**  
   - `visitor_id` хранится в cookie на клиенте и передаётся в каждом запросе пикселя.  
   - В БД хранится в каждой строке `visit_source_events`.  
   - Отдельных таблиц/полей **session_id** нет; «сессия» не выделена (только визиты с first/last touch).

5. **Capture utm / fbclid / gclid / ttclid**  
   Да: в tracker.js читаются из query, в API и БД сохраняются. Добавлен yclid в скрипт и в pixel; в миграции и в POST route есть yclid (миграция — без yclid, нужно проверить). *Проверка: в миграции 20250309000000 колонки yclid нет.* → В БД **yclid отсутствует**; в коде API (POST и pixel) yclid есть — при вставке будет ошибка или колонка добавлена позже. Нужно уточнить миграции.  
   *Повторная проверка миграции: в 20250309000000_visit_source_events.sql действительно нет yclid. Значит вставки с yclid могут падать, если в БД нет колонки.*

6. **Страница пикселя и генератор кода**  
   Страница BQ Pixel: сниппет с `site_id={projectId}`, статус «есть события / нет событий», последний визит. Site ID в UI = project_id (используется как site_id в API/БД).

**Не реализовано:**

- Регистрации (таблицы/события и привязка к visitor_id).  
- Покупки / конверсии (таблицы и ingest API).  
- Атрибуция «клик → регистрация» / «регистрация → покупка».  
- CAC/CPL/CPR/ROAS на основе **собственного** пикселя (сейчас ROAS/leads/purchases только из daily_ad_metrics = рекламные платформы).  
- Tracking links (редирект, сохранение cid/click, логирование кликов).  
- RLS на `visit_source_events` и проверка доступа к project в status API.

---

## SECTION 3 — DATA MODEL STATUS

### Таблицы и поля

**visit_source_events** (первый пиксель, визиты)

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid | PK |
| visitor_id | text | ID посетителя (из cookie) |
| site_id | text | Фактически project_id |
| landing_url | text | URL страницы |
| referrer | text | Referrer |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | text | UTM |
| gclid, fbclid, ttclid | text | Click IDs (в миграции **yclid нет**) |
| source_classification | text | paid | organic_search | organic_social | referral | direct | unknown |
| touch_type | text | first | last |
| created_at | timestamptz | Время события |

**Связи:**  
- С `projects`: только по смыслу (site_id = project_id), FK нет.  
- Таблиц для регистраций, лидов, покупок, конверсий с привязкой к visitor_id/site_id **нет**.

**daily_ad_metrics** (реклама, не пиксель)

- Содержит spend, impressions, clicks, leads, purchases, revenue, roas — данные из Meta/Google sync, не из visit_source_events.

### Разрыв по yclid

- В `app/api/tracking/source/route.ts` и `app/api/tracking/source/pixel/route.ts` в insert передаётся **yclid**.  
- В миграции `20250309000000_visit_source_events.sql` колонки **yclid нет**.  
- Итог: при применённой миграции без добавления yclid вставки с yclid могут давать ошибку. Нужна миграция с `ALTER TABLE ... ADD COLUMN yclid text` или удаление yclid из кода до появления колонки.

---

## SECTION 4 — GAPS / BREAKPOINTS

1. **Клик → визит**  
   Работает: трекер на лендинге шлёт визит в `visit_source_events`.  
   Ограничение: нет отдельного «click» (клик по рекламе) — только визит с UTM/click id. Нет своей системы tracking links с редиректом и логированием клика.

2. **Визит → регистрация**  
   Рвётся: нет таблицы регистраций и нет привязки user_id/email к visitor_id. Нет API для отправки события «registration» с visitor_id.

3. **Регистрация → покупка**  
   Рвётся: нет таблицы покупок/конверсий и нет связи с visitor_id или зарегистрированным пользователем.

4. **CAC / CPL / CPR / ROAS по своему пикселю**  
   Невозможны: нет конверсий (лиды/покупки) из первого пикселя и нет связи визит → конверсия. ROAS в дашборде — только из daily_ad_metrics (платформы).

5. **yclid в БД**  
   Код пишет yclid, в схеме visit_source_events колонки нет → риск ошибки при вставке.

6. **Доступ к данным**  
   GET `/api/tracking/source/status?site_id=xxx` не проверяет, что пользователь имеет доступ к проекту xxx — возможна утечка факта «есть события» по любому site_id.

7. **POST /api/tracking/source**  
   Не используется трекером (только GET pixel). Для Safari/incognito в комментарии указан pixel-only — поведение осознанное.

8. **UTM Builder**  
   Только генерация URL на клиенте, нет бэкенда, нет редиректа, нет сохранения кликов.

---

## SECTION 5 — MVP PLAN

Минимальный путь до рабочего pixel MVP (клик → визит → регистрация → покупка и базовый CAC/ROAS):

1. **Схема и ingest**  
   - Добавить в БД колонку `yclid` в `visit_source_events` (миграция), чтобы вставки из текущего кода не падали.  
   - Ввести таблицу **конверсий** (например `first_party_conversions`): id, project_id (site_id), visitor_id, event_type (registration | lead | purchase), value (revenue, nullable), external_id (опционально), created_at.  
   - Добавить API приёма конверсий: например `POST /api/tracking/events` с полями project_id, visitor_id, event_type, value?, idempotency_key? и запись в эту таблицу.

2. **Клиент**  
   - В tracker.js (или отдельном вызове) после регистрации/покупки вызывать отправку события (registration/purchase) с текущим visitor_id и при необходимости value (например выручка).  
   - Либо один endpoint для событий с event_type, либо отдельные (например /api/tracking/registration, /api/tracking/purchase) — на выбор, главное единый visitor_id и привязка к project_id.

3. **Атрибуция и отчётность**  
   - Связь «клик → конверсия»: по visitor_id — взять последний (или первый) визит из visit_source_events для данного site_id и считать атрибуцию (UTM, source_classification).  
   - Агрегаты для MVP: по проекту и периоду — число регистраций/лидов/покупок и сумма revenue по first_party_conversions, разбивка по source_classification или utm_source из привязанного визита.  
   - CAC: spend из daily_ad_metrics за период / количество конверсий (регистраций или лидов), при необходимости по источнику. ROAS: revenue из first_party_conversions / spend.

4. **Безопасность и продукт**  
   - Status API: проверять, что текущий пользователь имеет доступ к проекту с id = site_id, и только тогда возвращать статус.  
   - RLS на `visit_source_events` (и на новой таблице конверсий): доступ только к строкам своего проекта (по project_id/site_id через членство в организации/проекте).

5. **Опционально для MVP**  
   - Не обязательно в первом шаге: отдельная таблица «кликов» по tracking links, редирект и сохранение cid; можно сначала считать визит с gclid/fbclid/ttclid первым касанием и по нему считать атрибуцию.

Итого минимальный MVP:  
фикс yclid → таблица конверсий + API приёма событий → вызов с сайта при регистрации/покупке с visitor_id → расчёт атрибуции по visitor_id и базовый CAC/ROAS в отчёте.

---

## SECTION 6 — FULL CODE (критичные файлы)

Ниже приведён полный код только тех файлов, которые относятся к текущему pixel/tracking pipeline.

### 1. public/tracker.js

```javascript
/**
 * First-party source tracker MVP
 * Embed: <script src="https://YOUR_DOMAIN/tracker.js?site_id=YOUR_SITE_ID"></script>
 *
 * Captures: landing_url, referrer, utm_*, gclid, fbclid, yclid, ttclid, visitor_id
 * Persists: visitor_id in first-party cookie (1 year), sends to backend
 * First-touch: first visit (no cookie); Last-touch: every visit
 *
 * Transport: pixel-only (temporary for Safari/incognito stability).
 */
(function () {
  "use strict";

  if (typeof window !== "undefined" && window.__AS_TRACKER_LOADED__) return;
  if (typeof window !== "undefined") window.__AS_TRACKER_LOADED__ = true;

  var script = document.currentScript;
  if (!script || !script.src) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      if (s.src && s.src.indexOf("tracker.js") !== -1) {
        script = s;
        break;
      }
    }
  }
  if (!script || !script.src) return;

  var scriptUrl;
  try {
    scriptUrl = new URL(script.src);
  } catch (e) {
    return;
  }

  var siteId = scriptUrl.searchParams.get("site_id");
  if (!siteId) return;

  console.log("[as-tracker] tracker initialized", { site_id: siteId });

  var apiBase = scriptUrl.origin;
  var pixelEndpoint = apiBase + "/api/tracking/source/pixel";
  var cookieName = "as_visitor";
  var cookieMaxAge = 365 * 24 * 60 * 60;

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  }

  function getOrCreateVisitorId() {
    try {
      var match = document.cookie.match(new RegExp("(?:^|; )" + cookieName + "=([^;]*)"));
      var id = match ? decodeURIComponent(match[1]) : null;
      if (!id || id.length < 10) {
        id = "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
        document.cookie =
          cookieName + "=" + encodeURIComponent(id) + "; path=/; max-age=" + cookieMaxAge + "; SameSite=Lax";
      }
      return id;
    } catch (e) {
      return "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
    }
  }

  function isFirstVisit() {
    try {
      return !document.cookie.match(new RegExp("(?:^|; )" + cookieName + "="));
    } catch (e) {
      return true;
    }
  }

  var firstVisit = isFirstVisit();
  var visitorId = getOrCreateVisitorId();
  if (!visitorId || visitorId.length < 10) {
    visitorId = "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
  }

  var payload = {
    visitor_id: visitorId,
    site_id: siteId,
    landing_url: window.location.href,
    referrer: document.referrer || "",
    utm_source: getQueryParam("utm_source"),
    utm_medium: getQueryParam("utm_medium"),
    utm_campaign: getQueryParam("utm_campaign"),
    utm_content: getQueryParam("utm_content"),
    utm_term: getQueryParam("utm_term"),
    gclid: getQueryParam("gclid"),
    fbclid: getQueryParam("fbclid"),
    yclid: getQueryParam("yclid"),
    ttclid: getQueryParam("ttclid"),
    touch_type: firstVisit ? "first" : "last",
  };

  console.log("[as-tracker] payload snapshot", payload);

  var params = new URLSearchParams();
  params.set("visitor_id", visitorId);
  params.set("site_id", siteId);
  params.set("landing_url", (payload.landing_url || "").slice(0, 500));
  params.set("referrer", (payload.referrer || "").slice(0, 500));
  params.set("touch_type", payload.touch_type);
  params.set("_ts", String(Date.now()));
  if (payload.utm_source) params.set("utm_source", payload.utm_source);
  if (payload.utm_medium) params.set("utm_medium", payload.utm_medium);
  if (payload.utm_campaign) params.set("utm_campaign", payload.utm_campaign);
  if (payload.utm_content) params.set("utm_content", payload.utm_content);
  if (payload.utm_term) params.set("utm_term", payload.utm_term);
  if (payload.gclid) params.set("gclid", payload.gclid);
  if (payload.fbclid) params.set("fbclid", payload.fbclid);
  if (payload.yclid) params.set("yclid", payload.yclid);
  if (payload.ttclid) params.set("ttclid", payload.ttclid);

  var pixelUrl = pixelEndpoint + "?" + params.toString();
  console.log("[as-tracker] pixel URL built", { url: pixelUrl.slice(0, 150) + (pixelUrl.length > 150 ? "..." : "") });

  var img = new Image(1, 1);
  img.src = pixelUrl;

  console.log("[as-tracker] pixel beacon sent");
})();
```

### 2. app/api/tracking/source/pixel/route.ts

```typescript
/**
 * GET /api/tracking/source/pixel
 *
 * Image beacon fallback for tracking events when fetch POST fails (Safari, incognito).
 * Accepts same fields as POST /api/tracking/source via query params.
 * Returns 1x1 transparent GIF.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { classifySource } from "@/app/lib/sourceClassification";

const GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function safeStr(v: unknown, maxLen = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;

    const visitorId = safeStr(params.get("visitor_id"), 64);
    const siteId = safeStr(params.get("site_id"), 64);

    if (!visitorId || !siteId) {
      return new NextResponse(GIF_1X1, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store",
        },
      });
    }

    const landingUrl = safeStr(params.get("landing_url"), 2048);
    const referrer = safeStr(params.get("referrer"), 2048);
    const utmSource = safeStr(params.get("utm_source"), 256);
    const utmMedium = safeStr(params.get("utm_medium"), 256);
    const utmCampaign = safeStr(params.get("utm_campaign"), 256);
    const utmContent = safeStr(params.get("utm_content"), 256);
    const utmTerm = safeStr(params.get("utm_term"), 256);
    const gclid = safeStr(params.get("gclid"), 256);
    const fbclid = safeStr(params.get("fbclid"), 256);
    const yclid = safeStr(params.get("yclid"), 256);
    const ttclid = safeStr(params.get("ttclid"), 256);
    const touchType = (safeStr(params.get("touch_type"), 16) ?? "last") === "first" ? "first" : "last";

    const sourceClassification = classifySource({
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      gclid,
      fbclid,
      yclid,
      ttclid,
    });

    const admin = supabaseAdmin();
    await admin.from("visit_source_events").insert({
      visitor_id: visitorId,
      site_id: siteId,
      landing_url: landingUrl,
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      gclid,
      fbclid,
      yclid,
      ttclid,
      source_classification: sourceClassification,
      touch_type: touchType,
    });
  } catch (e) {
    console.error("[TRACKING_PIXEL_ERROR]", e);
  }

  return new NextResponse(GIF_1X1, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });
}
```

### 3. app/api/tracking/source/route.ts

```typescript
/**
 * POST /api/tracking/source
 *
 * First-party source tracking: receives visit/source attribution data from partner sites.
 * CORS enabled for cross-origin tracker requests.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { classifySource } from "@/app/lib/sourceClassification";

function safeStr(v: unknown, maxLen = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const visitorId = safeStr(body.visitor_id, 64);
    const siteId = safeStr(body.site_id, 64);

    if (!visitorId || !siteId) {
      return NextResponse.json(
        { success: false, error: "visitor_id and site_id required" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const landingUrl = safeStr(body.landing_url, 2048);
    const referrer = safeStr(body.referrer, 2048);
    const utmSource = safeStr(body.utm_source, 256);
    const utmMedium = safeStr(body.utm_medium, 256);
    const utmCampaign = safeStr(body.utm_campaign, 256);
    const utmContent = safeStr(body.utm_content, 256);
    const utmTerm = safeStr(body.utm_term, 256);
    const gclid = safeStr(body.gclid, 256);
    const fbclid = safeStr(body.fbclid, 256);
    const yclid = safeStr(body.yclid, 256);
    const ttclid = safeStr(body.ttclid, 256);
    const touchType = (safeStr(body.touch_type, 16) ?? "last") === "first" ? "first" : "last";

    const sourceClassification = classifySource({
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      gclid,
      fbclid,
      yclid,
      ttclid,
    });

    const admin = supabaseAdmin();
    const { error } = await admin.from("visit_source_events").insert({
      visitor_id: visitorId,
      site_id: siteId,
      landing_url: landingUrl,
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      gclid,
      fbclid,
      yclid,
      ttclid,
      source_classification: sourceClassification,
      touch_type: touchType,
    });

    if (error) {
      console.error("[TRACKING_SOURCE_INSERT_ERROR]", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 201, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e) {
    console.error("[TRACKING_SOURCE_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
```

### 4. supabase/migrations/20250309000000_visit_source_events.sql

```sql
-- First-party source tracking: visit/source attribution events
-- MVP: capture landing, referrer, UTM, click IDs; classify source

CREATE TABLE IF NOT EXISTS public.visit_source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  site_id text NOT NULL,
  landing_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  fbclid text,
  ttclid text,
  source_classification text NOT NULL CHECK (source_classification IN ('paid', 'organic_search', 'organic_social', 'referral', 'direct', 'unknown')),
  touch_type text NOT NULL DEFAULT 'last' CHECK (touch_type IN ('first', 'last')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visit_source_events_visitor_id ON public.visit_source_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_site_id ON public.visit_source_events(site_id);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_created_at ON public.visit_source_events(created_at);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_visitor_site ON public.visit_source_events(visitor_id, site_id);

COMMENT ON TABLE public.visit_source_events IS 'First-party source tracking: each row = one visit with attribution data. First-touch = earliest event per visitor+site; last-touch = latest.';
```

*Примечание: в оригинальной миграции в репозитории колонки `yclid` нет. Если в вашей БД таблица уже создана без yclid, нужна отдельная миграция `ALTER TABLE public.visit_source_events ADD COLUMN IF NOT EXISTS yclid text;`.*

### 5. app/lib/sourceClassification.ts

```typescript
/**
 * Source classification for first-party tracking.
 * Classifies visit source into: paid, organic_search, organic_social, referral, direct, unknown.
 */

export type SourceClassification =
  | "paid"
  | "organic_search"
  | "organic_social"
  | "referral"
  | "direct"
  | "unknown";

export type SourceInput = {
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  yclid?: string | null;
  ttclid?: string | null;
};

const PAID_MEDIA = ["cpc", "ppc", "paid", "cpm", "cpv"];
const SEARCH_DOMAINS = ["google.", "yandex.", "bing.", "yahoo.", "duckduckgo."];
const SOCIAL_DOMAINS = ["facebook.", "instagram.", "twitter.", "tiktok.", "linkedin.", "vk.", "vk.com", "ok.ru"];

function hasNonEmpty(value?: string | null): boolean {
  if (value == null) return false;
  return value.trim().length > 0;
}

function hasPaidClickId(input: SourceInput): boolean {
  return (
    hasNonEmpty(input.gclid) ||
    hasNonEmpty(input.fbclid) ||
    hasNonEmpty(input.yclid) ||
    hasNonEmpty(input.ttclid)
  );
}

function hasPaidUtmMedium(input: SourceInput): boolean {
  if (!hasNonEmpty(input.utm_medium)) return false;
  const m = input.utm_medium!.toLowerCase();
  return PAID_MEDIA.some((p) => m.includes(p));
}

function isPaid(input: SourceInput): boolean {
  return hasPaidClickId(input) || hasPaidUtmMedium(input);
}

function referrerMatches(referrer: string, domains: string[]): boolean {
  const lower = referrer.toLowerCase();
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return domains.some((d) => host.includes(d));
  } catch {
    return domains.some((d) => lower.includes(d));
  }
}

export function classifySource(input: SourceInput): SourceClassification {
  const refRaw = input.referrer ?? "";
  const ref = refRaw.trim();
  const hasRef = ref.length > 0;

  const hasUtm =
    hasNonEmpty(input.utm_source) ||
    hasNonEmpty(input.utm_medium) ||
    hasNonEmpty(input.utm_campaign);

  if (isPaid(input)) return "paid";
  if (hasRef && referrerMatches(ref, SEARCH_DOMAINS)) return "organic_search";
  if (hasRef && referrerMatches(ref, SOCIAL_DOMAINS)) return "organic_social";
  if (hasRef) return "referral";
  if (!hasRef && !hasUtm && !hasPaidClickId(input)) return "direct";
  return "unknown";
}
```

---

## Ответы на 10 вопросов (SECTION 4 — ANALYSIS QUESTIONS)

1. **Есть ли уже собственный pixel client script?**  
   Да. `public/tracker.js` — один скрипт на страницу, cookie `as_visitor`, отправка визита через GET pixel.

2. **Есть ли уже ingest API для событий?**  
   Да для визитов: GET `/api/tracking/source/pixel` и POST `/api/tracking/source`. Для регистраций/покупок — нет.

3. **Есть ли уже БД для event storage?**  
   Да для визитов: `visit_source_events`. Для конверсий (registration/purchase) — нет.

4. **Есть ли уже сохранение cid / visitor id / session id?**  
   visitor_id — да (cookie + каждая строка visit_source_events). Отдельного cid (click id) как колонки нет, но gclid/fbclid/ttclid сохраняются. session_id нет.

5. **Есть ли уже capture utm / fbclid / gclid / ttclid?**  
   Да. В миграции нет yclid; в коде API yclid есть — возможна ошибка при вставке, пока в БД не добавлена колонка.

6. **Можно ли уже связать клик с регистрацией?**  
   Нет. Нет таблицы регистраций и нет привязки к visitor_id.

7. **Можно ли уже связать регистрацию с покупкой?**  
   Нет. Нет таблиц регистраций и покупок из первого пикселя.

8. **Можно ли уже сейчас считать CAC?**  
   Только по данным рекламных платформ (daily_ad_metrics: spend/leads). По первому пикселю — нет, так как нет конверсий по visitor_id.

9. **Если нет — что именно мешает?**  
   Нет таблицы и API для конверсий (registration/lead/purchase), нет отправки этих событий с сайта с visitor_id, нет связки визит → конверсия для атрибуции.

10. **Какой минимальный path до рабочего pixel MVP?**  
    См. SECTION 5 — MVP PLAN: фикс yclid в БД → таблица конверсий + API приёма событий → вызов с сайта при регистрации/покупке с visitor_id → атрибуция по visitor_id и базовый CAC/ROAS.
