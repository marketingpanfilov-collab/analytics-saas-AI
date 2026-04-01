# Dashboard Data Flow — технический аудит

**Дата:** 2026-03  
**Контекст:** после внедрения async backfill, TTL sync, historical missing-range sync.  
**Цель:** выяснить, почему при выборе длинного диапазона historical sync может запускаться, но пользователь не видит автоматического появления данных на экране.

---

## РАЗДЕЛ 1 — Как сейчас работает цепочка: range change → backfill → response → UI

### 1.1 Триггер загрузки на фронте

**Файл:** `app/app/AppDashboardClient.tsx`

- Единственный источник данных для summary/timeseries/KPI/conversions — функция **`loadFromDb(signal, overrideStart?, overrideEnd?)`** (строки 714–835).
- `loadFromDb` вызывается только в двух случаях:
  1. **useEffect** при изменении `projectId | appliedDateFrom | appliedDateTo | sourcesKey | accountIdsKey` (стр. 894–929) — т.е. при первом заходе и при смене применённого диапазона/фильтров.
  2. **`refreshAndReload()`** после успешного POST `/api/dashboard/refresh` (стр. 884) — т.е. только после ручного «Обновить» или по таймеру раз в 30 минут (стр. 932–944).

Итого: один «выстрел» fetch при Apply диапазона; повторного запроса после старта historical sync нет.

### 1.2 Параллельные запросы при одном loadFromDb

Внутри `loadFromDb` один раз выполняется:

```ts
const [sRes, tRes, kRes, cRes] = await Promise.all([
  fetch(`/api/dashboard/summary?${qs}`, ...),
  fetch(`/api/dashboard/timeseries?${qs}`, ...),
  fetch(`/api/dashboard/kpi?${qs}`, ...),
  fetch(`/api/dashboard/timeseries-conversions?${qs}`, ...),
]);
```

- **summary** и **timeseries** — основные источники для графика и KPI (spend, points). В обоих вызывается `ensureBackfill`, возвращается ответ с данными и опционально с `backfill` metadata.
- **metrics** тоже вызывает `ensureBackfill`, но в ответе **нет** поля `backfill` (возвращается только массив метрик).

### 1.3 Backend: ensureBackfill

**Файл:** `app/lib/dashboardBackfill.ts`

- **Когда `triggered = true`:**
  - **Historical:** есть `coverage.missingIntervals.length > 0` → в фоне вызывается POST `/api/dashboard/sync` по каждому недостающему интервалу (без await). TTL не проверяется.
  - **Fresh:** диапазон полностью покрыт, диапазон пересекается с «хвостом» (последние 3 дня), последний sync старше TTL → в фоне sync только по хвосту.
- **Когда возвращается `historicalSyncIntervals`:** только при `reason === "historical"` (есть пропуски по дням).

Во все три endpoint (summary, timeseries, metrics) один и тот же `ensureBackfill(admin, projectId, start, end, req.url)` доходит с одной и той же логикой; разница только в том, как результат кладётся в ответ.

### 1.4 Backend: summary и timeseries

**Файлы:** `app/api/dashboard/summary/route.ts`, `app/api/dashboard/timeseries/route.ts`

- После `ensureBackfill`:
  - Если **`didSync === true`** → **кэш не читается** (сразу идём в БД).
  - Читаем canonical (getCanonicalSummary / getCanonicalTimeseries) — на момент запроса это ещё **частичные** данные (sync в фоне только запущен).
  - Собираем body; при `backfillResult.reason === "historical"` добавляем в body:
    - `backfill: { range_partially_covered: true, historical_sync_started: true, intervals: [...] }`.
  - **Пишем этот ответ в кэш** (summary: 30s, timeseries: 60s) и отдаём его клиенту.

Итого: первый ответ при partial coverage — это текущие (неполные) данные + метаданные о том, что historical sync запущен. Ответ с частичными данными при этом кэшируется.

### 1.5 Backend: metrics

**Файл:** `app/api/dashboard/metrics/route.ts`

- Вызывается `ensureBackfill`, но ответ — сырой массив (canonical или legacy). Поля **`backfill` в ответе нет**. Формат ответа summary/timeseries с `backfill` здесь не дублируется.

### 1.6 Кэш

**Файл:** `app/lib/dashboardCache.ts`

- In-memory Map, ключ: `route:projectId:start:end:sourcesKey:accountIdsKey`.
- TTL: summary 30s, timeseries 60s, metrics 30s.
- При **`didSync === true`** summary/timeseries не читают кэш, но **записывают** в кэш только что отданный ответ (частичные данные + backfill). Следующий запрос с теми же параметрами в течение TTL при **`didSync === false`** (например, после того как покрытие станет полным) получит **этот же закэшированный частичный ответ** и отдаст его клиенту.

### 1.7 Frontend: обработка ответа

**Файл:** `app/app/AppDashboardClient.tsx` (строки 751–826)

- Из `sJson` берутся только `totals` → `setSummary(nextSummary)`.
- Из `tJson` берутся только `points` → `setPoints(pts)`.
- **`sJson.backfill` и `tJson.backfill` нигде не читаются** (по всему `app/app` по backfill/historical_sync/range_partially нет совпадений).
- Нет state вида `isHistoricalBackfillRunning`, `rangePartiallyCovered`, `backfillIntervals`.

График и KPI рендерятся только от `summary` и `points`; обновление — только при следующем вызове `loadFromDb` и успешном приходе новых данных.

### 1.8 Сводка цепочки

1. Пользователь выбирает длинный диапазон и нажимает Apply.
2. Меняются `appliedDateFrom`/`appliedDateTo` → срабатывает useEffect → один раз вызывается `loadFromDb`.
3. summary и timeseries GET: на backend вызывается `ensureBackfill` → при partial coverage запускается historical sync в фоне, `triggered: true`, в ответ добавляется `backfill`.
4. Backend отдаёт текущие (частичные) данные + `backfill`, кладёт этот ответ в кэш.
5. Frontend получает ответ, вызывает `setSummary` и `setPoints` — на экране частичные данные; **backfill не обрабатывается**, повторный запрос не планируется.
6. Sync в фоне завершается через N минут; данных в БД становится больше, но новый GET не выполняется.
7. Пользователь видит обновление только если сам снова нажмёт Apply/Обновить или дождётся 30-минутного таймера.

---

## РАЗДЕЛ 2 — Что работает корректно

- **ensureBackfill:** при partial coverage считает missing intervals и запускает sync только по ним; не блокирует ответ; TTL для historical не мешает.
- **summary/timeseries:** при `didSync === true` не отдают старый кэш, а идут в БД и отдают актуальные на момент запроса данные + metadata backfill в одном формате.
- **Дедуп sync:** один и тот же интервал не дергается повторно (ключ в `syncPromises`).
- **Разделение historical / fresh:** historical — по пропускам, fresh — только хвост при полном покрытии и истечении TTL.
- **Backend после завершения sync:** при следующем GET (при том же диапазоне) `isRangeCovered` уже полный → `didSync === false` → читается кэш. Если кэш не истёк — отдаётся закэшированный **старый частичный** ответ (см. раздел 3).

---

## РАЗДЕЛ 3 — Где именно ломается ожидание пользователя

### 3.1 Отсутствие автоматического refetch (главная причина UX)

- **Факт:** после того как backend вернул ответ с `backfill.historical_sync_started: true`, фронт **ни разу** не перезапрашивает summary/timeseries.
- **Следствие:** даже когда sync через несколько минут допишет данные в БД, экран не обновится сам.
- **Место:** `AppDashboardClient.tsx` — нет ни чтения `backfill`, ни таймера/поллинга/повторного вызова `loadFromDb` при признаке «historical sync started».

### 3.2 Игнорирование backfill metadata на фронте

- **Факт:** в ответах summary и timeseries при historical backfill приходит `backfill: { range_partially_covered, historical_sync_started, intervals }`, но в коде нет обращений к `sJson.backfill` / `tJson.backfill`.
- **Следствие:** нет ни индикатора «данные догружаются», ни логики «через N секунд перезапросить».

### 3.3 Кэш после завершения sync (вторичная проблема)

- **Сценарий:** первый запрос при partial coverage → ответ (частичные данные + backfill) кэшируется на 30s (summary) / 60s (timeseries). Sync в фоне завершается. Пользователь или таймер через 15s снова вызывает `loadFromDb`. На backend покрытие уже полное → `didSync === false` → выполняется **чтение кэша** → клиенту отдаётся **старый частичный** ответ.
- **Место:** `app/api/dashboard/summary/route.ts` (строки 81–88), `app/api/dashboard/timeseries/route.ts` (строки 68–74); кэш не инвалидируется при завершении sync.
- **Итог:** даже при появлении refetch’а без доработки кэша пользователь может до 30–60 секунд продолжать видеть старые неполные данные.

### 3.4 Неполнота backfill metadata в metrics

- **Факт:** в `app/api/dashboard/metrics/route.ts` backfill metadata не добавляется (ответ — массив). Для единообразия и возможного будущего UI по «догрузке» metrics отстаёт от summary/timeseries.

### 3.5 Разное поведение при нуле точек (timeseries)

- При нуле canonical points timeseries уходит в RPC fallback и в этом ответе **не** добавляет `backfill`. Если когда-то сценарий «0 точек + запущен backfill» будет важен для UI, формат ответа будет разным в зависимости от наличия точек.

---

## РАЗДЕЛ 4 — Главная корневая причина

**Почему пользователь не видит автоматическую подгрузку:**

Фронтенд делает **один** набор запросов (summary + timeseries + …) при смене диапазона и больше **не перезапрашивает** данные после того, как backend вернул ответ с запущенным historical sync. Метаданные `backfill` в ответе есть, но **нигде не читаются** и не используются для повторного запроса или индикации загрузки. Архитектура — «one-shot fetch на Apply»; механизма «дождаться окончания backfill и обновить экран» нет.

Дополнительно: после появления такого механизма (refetch/polling) текущая политика кэша приведёт к тому, что следующий запрос в течение 30–60 s может снова отдать закэшированный частичный ответ.

---

## РАЗДЕЛ 5 — Что исправлять в первую очередь

1. **Must fix — автоматический refetch при historical backfill**  
   На фронте при получении `summary` или `timeseries` с `backfill.historical_sync_started === true` завести состояние (например, «идёт historical backfill») и через N секунд (например, 15–30) один или несколько раз вызвать `loadFromDb` с теми же параметрами, пока не придёт ответ без `backfill` или с полными данными. Либо ограничить число попыток (например, 3–5).

2. **Must fix — использование backfill metadata на фронте**  
   Читать `sJson.backfill` / `tJson.backfill` в `loadFromDb`, сохранять в state (например, `rangePartiallyCovered`, `historicalSyncIntervals`) и использовать для:
   - запуска отложенного refetch (см. п.1);
   - опционально: краткого UI-сообщения («Догружаем данные за выбранный период…»).

3. **Should fix — кэш при partial + backfill**  
   Либо не кэшировать ответ при `backfill.reason === 'historical'`, либо при следующем GET с теми же параметрами при полном покрытии принудительно не брать кэш (например, отдельный флаг или короткий TTL для ответов с backfill). Файлы: `app/api/dashboard/summary/route.ts`, `app/api/dashboard/timeseries/route.ts`.

4. **Should fix — инвалидация или обход кэша после sync**  
   Варианты: не писать в кэш ответ с `backfill.historical_sync_started`; или уменьшить TTL для таких ответов; или на фронте при refetch после backfill добавлять cache-busting (например, временный query-параметр), чтобы гарантированно попасть в БД, а не в старый кэш.

5. **Nice to have**  
   - Единый формат backfill metadata в metrics (если нужен консистентный UI по всем блокам).  
   - Явный индикатор в UI: «Данные за период догружаются» при `rangePartiallyCovered` + refetch.  
   - В timeseries при RPC fallback тоже добавлять `backfill` при `reason === 'historical'` для единообразия.

---

## Ответы на финальные вопросы

1. **Historical sync реально запускается?**  
   Да. При partial coverage `ensureBackfill` в summary/timeseries/metrics вызывает POST `/api/dashboard/sync` по каждому missing interval (без await), с дедупом по ключу `projectId:start:end`.

2. **Dashboard реально узнаёт, что он запущен?**  
   Backend отдаёт в теле ответа summary и timeseries поле `backfill.historical_sync_started: true`. Но фронт **не читает** эти поля, поэтому с точки зрения состояния приложения дашборд «не узнаёт».

3. **Dashboard делает автоматический refetch после sync?**  
   Нет. Повторный запрос происходит только при новом Apply, ручном «Обновить» или по таймеру раз в 30 минут.

4. **Мешает ли cache увидеть новые данные?**  
   Да, в сценарии «refetch через 15s после старта backfill»: если sync успеет завершиться, следующий GET при полном покрытии получит `didSync === false` и отдаст закэшированный частичный ответ (до истечения TTL 30s/60s). Без refetch кэш сам по себе не виноват в том, что пользователь не видит обновления — виновато отсутствие refetch.

5. **Что именно нужно исправить, чтобы данные появлялись без ручного refresh?**  
   - На фронте: читать `backfill` из ответов summary/timeseries и при `historical_sync_started` планировать один или несколько повторных вызовов `loadFromDb` с задержкой (и опционально показывать статус).  
   - На backend/кэше: не кэшировать ответы с historical backfill или не отдавать их из кэша при следующем запросе (или сократить TTL / использовать cache-bust при refetch), чтобы после завершения sync клиент получал свежие данные из БД.

---

## Привязка к файлам

| Что | Файл | Строки / место |
|-----|------|-----------------|
| ensureBackfill, missing intervals, trigger sync | `app/lib/dashboardBackfill.ts` | 224–287 (ensureBackfill), 168–206 (triggerSync) |
| isRangeCovered, getMissingIntervals | `app/lib/dashboardBackfill.ts` | 44–69 (getMissingIntervals), 85–135 (isRangeCovered) |
| summary: backfill в ответе, кэш при didSync | `app/api/dashboard/summary/route.ts` | 75–78, 81–93, 114–121 |
| timeseries: backfill в ответе, кэш при didSync | `app/api/dashboard/timeseries/route.ts` | 61–75, 92–99, 98–99 |
| metrics: ensureBackfill без backfill в ответе | `app/api/dashboard/metrics/route.ts` | 41–62 |
| Кэш TTL, get/set | `app/lib/dashboardCache.ts` | 46–50 (TTL), 28–43 (get/set) |
| loadFromDb, один вызов при изменении диапазона | `app/app/AppDashboardClient.tsx` | 714–835 (loadFromDb), 744–749 (Promise.all), 792–806 (setSummary/setPoints) |
| useEffect, вызывающий loadFromDb | `app/app/AppDashboardClient.tsx` | 894–929 |
| refreshAndReload, 30 min timer | `app/app/AppDashboardClient.tsx` | 837–891, 931–944 |

---

## Отчёт о внедрении (после фикса)

### 1. State на frontend

- **`historicalBackfill`** (`useState<{ started: boolean; intervals: { start: string; end: string }[] } | null>`): приходит из backfill metadata в ответах summary/timeseries. Если в хотя бы одном из ответов есть `historical_sync_started` или `range_partially_covered`, в state пишется `{ started: true, intervals }`.
- **`backfillTimeoutRef`**: id таймера для следующего refetch; очищается при остановке polling или размонтировании.
- **`backfillAttemptRef`**: счётчик попыток refetch (макс. 6); сбрасывается в `clearBackfillPolling()`.

### 2. Polling

- После успешного `loadFromDb` из ответов берётся `sJson?.backfill ?? tJson?.backfill`.
- Если `historical_sync_started` или `range_partially_covered` — вызывается `setHistoricalBackfill({ started: true, intervals })`, затем ставится `setTimeout` на 8 с, по срабатывании которого увеличивается `backfillAttemptRef` и снова вызывается `loadFromDb(c.signal, start, end)` с тем же диапазоном.
- Одновременно активен только один таймер; перед установкой нового предыдущий сбрасывается.

### 3. Остановка polling

- Ответ без backfill metadata → `clearBackfillPolling()` (таймер очищается, attempt = 0, `historicalBackfill` = null).
- Достигнут лимит попыток (`backfillAttemptRef.current >= 6`) → новый таймер не ставится.
- Cleanup эффекта (смена диапазона / projectId / фильтров) → `clearBackfillPolling()`.
- Ошибка в `loadFromDb` (кроме Abort) → `clearBackfillPolling()`.

### 4. Кэширование summary/timeseries

- В **summary** и **timeseries**: если в теле ответа есть `backfill.historical_sync_started === true`, ответ **не** записывается в кэш (`dashboardCacheSet` не вызывается). Следующий refetch с теми же параметрами получает свежие данные из БД после завершения sync.
- Если в этом запросе `ensureBackfill` **запустил** sync (`triggered === true`, в т.ч. **fresh** TTL / «хвост»), ответ **тоже не кэшируется** (`didSync`): фоновый sync не ждётся, снимок из БД может быть неполным; кэширование такого ответа давало заниженный spend до истечения TTL. **Bundle** и **metrics** следуют тому же правилу.

### 5. Как пользователь видит, что данные догружаются

- При `historicalBackfill?.started === true` под блоком с датами показывается жёлтый inline-баннер: **«Подгружаем исторические данные»** и при наличии — интервалы в формате «ДД.ММ.ГГГГ — ДД.ММ.ГГГГ».
- После того как sync закрывает пропуски, следующий refetch возвращает ответ без backfill → баннер исчезает, графики и KPI обновляются без ручного refresh.

### 6. Политика refresh / ensureBackfill (актуализация)

- **`ensureBackfill` (ветка «сегодня»):** при полном покрытии диапазона и `end === UTC today` фоновый fresh-sync идёт только по окну **вчера + сегодня** (`max(requested_start, today−1d)…today`), а не по всему выбранному `[start, end]`.
- **Historical gaps:** длинные `missingIntervals` режутся на **чанки по 7 календарных дней**; каждый чанк — отдельный POST `/api/dashboard/sync` (последовательно по списку чанков).
- **`POST /api/dashboard/refresh`:** по умолчанию при `end === UTC today` диапазон **нормализуется** так же (узкое окно), если в body **нет** `force_full_sync: true`. Ручной **Full re-sync** в UI передаёт `force_full_sync: true` и синкает **весь** выбранный applied-диапазон.
- **Internal cron** (`internal-sync/cron`): по-прежнему только `today…today`; узкое окно refresh на него не распространяется.
- **Прямой** `POST /api/dashboard/sync` без изменений: политика узкого окна относится к `ensureBackfill` и к default refresh, не к произвольным прямым вызовам sync.
