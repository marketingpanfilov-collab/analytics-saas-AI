# Data state patterns for widgets (UX Hardening §6–§7)

Паттерны **EMPTY / LIMITED / BLOCKED** для виджетов согласованы с `resolved_ui_state.data_state_default` и лимитами из `plan_feature_matrix` (bootstrap). Доминирующий **shell** не выводить из локальных эвристик по сырым осям — §14.1.

## Over-limit (§6)

| Тип | Как исправить | До исправления | Блокируется |
| --- | ------------- | -------------- | ----------- |
| Projects | Архив/удаление или upgrade | Список проектов, настройки, биллинг (owner) | Работа в «лишних» проектах, создание новых |
| Seats | Деактивировать членов или upgrade | Owner: участники | Приглашения, новые seats |
| Ad accounts | Отключить интеграции или upgrade | Список read, настройки интеграций | Sync лишних, новые сверх лимита |

Reason codes: `OVER_LIMIT_PROJECTS`, `OVER_LIMIT_SEATS`, `OVER_LIMIT_AD_ACCOUNTS` (возможны несколько; UI — объединённый список в `over_limit_details`).

## Виджеты (§7)

| Widget type | EMPTY | LIMITED | BLOCKED |
| ----------- | ----- | ------- | ------- |
| KPI cards | «Нет данных за период» + CTA подключить/обновить | «Часть метрик по тарифу» + Upgrade | «Нет доступа» + причина (`reason`) |
| Charts | Empty state, ось времени видна | Blur/secondary series + подпись Limited | Placeholder lock + CTA оплаты/доступа |
| LTV | Onboarding данных | Cap по когортам/глубине + Upgrade | Lock screen |
| Attribution | Нет событий / нет связки | Часть отчётов (Growth) | Lock |
| Tables | Пустая таблица с объяснением | Строки capped + «Показать в Growth» | Нет строк + баннер |

Правило: не менять layout компонента без смены `data_state`, чтобы избежать «прыгающего» UI.
