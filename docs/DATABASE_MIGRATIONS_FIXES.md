# Исправления миграций после аудита

**Дата:** 2025-03-31  
**Основа:** [DATABASE_MIGRATIONS_AUDIT.md](./DATABASE_MIGRATIONS_AUDIT.md)

Цель — закрыть критичные расхождения между историей миграций и реальной схемой БД без destructive changes и без изменения бизнес-логики.

---

## Закрытые проблемы

### 1. Broken migration 20250326000000 (utm_id)

- **Проблема:** Файл `20250326000000_redirect_click_events_utm_id.sql` повреждён (содержит только символ "C"). В БД колонка `utm_id` в `redirect_click_events` уже есть или должна быть для кода.
- **Решение:** Добавлена **repair-миграция** (новая, не правка старой):
  - `20250331000001_redirect_click_events_utm_id_repair.sql`
  - `ALTER TABLE public.redirect_click_events ADD COLUMN IF NOT EXISTS utm_id text;`
- **Результат:** На новых средах колонка гарантированно есть; на production — no-op при наличии колонки. Destructive changes не выполнялись.

### 2. Отсутствующий индекс conversion_events(click_id)

- **Проблема:** Нет индекса по `click_id` в `conversion_events`, что замедляет attribution debugger, join с `redirect_click_events`, отчёты.
- **Решение:** Новая миграция:
  - `20250331000002_conversion_events_click_id_index.sql`
  - `CREATE INDEX IF NOT EXISTS idx_conversion_events_click_id ON public.conversion_events(click_id);`
- **Результат:** Запросы по click_id и join'ы ускоряются. Безопасно для production (IF NOT EXISTS).

### 3. Схема ad_accounts (provider / external_account_id)

- **Подтверждено:** В реальной БД в `ad_accounts` уже используются колонки **provider** и **external_account_id** (не `platform` / `platform_account_id`).
- **Проблема:** Миграция `20250307000003` создаёт таблицу с `platform` и `platform_account_id`; последующие миграции (000009, 07100000, 07200000, 08000000) и код используют `provider` и `external_account_id`. На чистом развёртывании это ломало бы применение 000009 и далее.
- **Решение:** Добавлена **repair-миграция** (после 000003, до 000004):
  - `20250307000003_repair_ad_accounts_provider_external.sql`
  - Добавляет `provider` и `external_account_id` через `ADD COLUMN IF NOT EXISTS`.
  - При наличии колонок `platform` / `platform_account_id` выполняет backfill в новые колонки.
  - Переименование и удаление колонок не делаются (production не трогаем).
- **Результат:** Новая среда после 000003 получает оба набора колонок; 000009 и далее применяются корректно. Production с уже правильной схемой — no-op.

### 4. Backfill campaigns platform (08000000)

- **Проверка:** Миграция `20250308000000_backfill_campaigns_platform.sql` использует `aa.provider` и `aa.external_account_id`.
- **Результат:** После применения repair для ad_accounts на свежей БД колонки `provider` и `external_account_id` уже есть, backfill 08000000 выполняется без ошибок. Изменения в 08000000 не вносились.

---

## Что не делалось

- Не изменялись и не удалялись старые уже применённые миграции (в т.ч. 20250326000000).
- Не выполнялись destructive schema changes (drop column, rename в production).
- Не менялись бизнес-логика приложения, tracking, attribution, API.
- Не правились рабочие таблицы вручную вне миграций.

---

## Новые файлы миграций

| Файл | Назначение |
|------|------------|
| `20250307000003_repair_ad_accounts_provider_external.sql` | Добавление provider / external_account_id в ad_accounts и backfill при необходимости |
| `20250331000001_redirect_click_events_utm_id_repair.sql` | Добавление колонки utm_id в redirect_click_events |
| `20250331000002_conversion_events_click_id_index.sql` | Индекс по conversion_events(click_id) |

---

## Оставшиеся замечания (не критичные)

- В аудите по-прежнему можно учитывать: таблицы `projects`, `project_members`, `integrations_meta`, `meta_ad_accounts`, `campaigns` и др. создаются вне этой папки миграций — при желании их можно вынести в миграции для полной воспроизводимости.
- Файл `20250326000000_redirect_click_events_utm_id.sql` остаётся в репозитории в текущем (повреждённом) виде; источник истины для utm_id — repair-миграция выше.

---

*Исправления выполнены в соответствии с safe migration policy (IF NOT EXISTS, без удаления колонок и переименований production).*
