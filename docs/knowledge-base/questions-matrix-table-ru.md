# BoardIQ: План-таблица вопросов базы знаний (RU)

## Формат

Таблица ниже — это рабочий план: что писать, в каком приоритете и каком статусе.

Статусы:
- `todo` — не начато
- `in_progress` — в работе
- `done` — готово

---

| № | Этап | Блок | Вопрос / тема статьи | Приоритет | Тип | Статус |
|---|---|---|---|---|---|---|
| 1 | До регистрации | Ценность | Что сервис решает в первую неделю? | P0 | Quick | todo |
| 2 | До регистрации | Совместимость | Какие источники поддерживаются? | P0 | Quick | todo |
| 3 | До регистрации | Тарифы | Что входит в Free и платные планы? | P1 | Quick | todo |
| 4 | Регистрация и вход | Signup | Как зарегистрироваться через `/login`? | P0 | Guide | todo |
| 5 | Регистрация и вход | Signup error | Что делать при «email уже зарегистрирован»? | P0 | Diagnostic | todo |
| 6 | Регистрация и вход | Login error | Почему не входит при правильном пароле? | P0 | Diagnostic | todo |
| 7 | Регистрация и вход | Recovery | Как корректно восстановить пароль? | P0 | Guide | todo |
| 8 | Регистрация и вход | Email flow | Почему не пришло письмо, как переотправить? | P1 | Diagnostic | todo |
| 9 | Первая активация | First run | Как понять, что аккаунт активирован корректно? | P0 | Checklist | todo |
| 10 | Первая активация | Routing | Почему редиректит в онбординг? | P1 | Quick | todo |
| 11 | Онбординг | Flow 1-3 | Как пройти шаги 1–3 без ошибок? | P0 | Guide | todo |
| 12 | Онбординг | Step2 error | Почему «Далее» не переводит на шаг 3? | P0 | Diagnostic | todo |
| 13 | Онбординг | Required fields | Какие поля обязательны на шаге компании? | P0 | Checklist | todo |
| 14 | Онбординг | Events | Какие события отправляются на шаге 2? | P0 | Quick | todo |
| 15 | Источники | Meta | Как подключить Meta Ads? | P0 | Guide | todo |
| 16 | Источники | Google | Как подключить Google Ads? | P0 | Guide | todo |
| 17 | Источники | TikTok | Как подключить TikTok Ads? | P0 | Guide | todo |
| 18 | Источники | OAuth errors | Что делать при OAuth callback error? | P0 | Diagnostic | todo |
| 19 | Источники | Validation | Как проверить, что синк реально идет? | P1 | Checklist | todo |
| 20 | Трекинг | Pixel | Как установить Pixel и проверить событие? | P0 | Guide | todo |
| 21 | Трекинг | UTM | Как настроить UTM-стандарты? | P0 | Guide | todo |
| 22 | Трекинг | Conversions | Как настроить события регистрации и покупки? | P0 | Guide | todo |
| 23 | Трекинг | Visibility | Почему событие видно в браузере, но нет в отчетах? | P0 | Diagnostic | todo |
| 24 | Трекинг | Dedup | Как проверить CAPI + Pixel дедупликацию? | P1 | Checklist | todo |
| 25 | Качество данных | Day-0 | Как провести day-0 проверку данных? | P0 | Checklist | todo |
| 26 | Качество данных | Zero data | Почему в дашборде нули? | P0 | Diagnostic | todo |
| 27 | Качество данных | Mismatch | Почему цифры отличаются от кабинета? | P0 | Diagnostic | todo |
| 28 | Качество данных | Freshness | Как работают freshness и задержки? | P1 | Guide | todo |
| 29 | Дашборды | KPI basics | Как читать основные KPI правильно? | P0 | Guide | todo |
| 30 | Дашборды | Decisions | Какие KPI использовать для weekly-решений? | P0 | Quick | todo |
| 31 | Дашборды | Dictionary | Где словарь метрик и формулы? | P1 | Reference | todo |
| 32 | Атрибуция | Interpretation | Как интерпретировать атрибуцию без ошибок? | P0 | Guide | todo |
| 33 | Атрибуция | Model choice | Как выбрать модель для бюджетных решений? | P0 | Quick | todo |
| 34 | Атрибуция | Platform diff | Почему атрибуция отличается от платформ? | P1 | Diagnostic | todo |
| 35 | Роли и доступы | Invite | Как пригласить пользователя и назначить роль? | P0 | Guide | todo |
| 36 | Роли и доступы | Access issue | Инвайт принят, но доступа нет — что проверить? | P0 | Diagnostic | todo |
| 37 | Роли и доступы | Permissions | Где матрица ролей и разрешений? | P1 | Quick | todo |
| 38 | Биллинг | Plan ops | Как работает апгрейд/даунгрейд тарифа? | P0 | Guide | todo |
| 39 | Биллинг | Payment issue | Оплата прошла, доступ не открылся — что делать? | P0 | Diagnostic | todo |
| 40 | Биллинг | Disabled features | Почему отключены синки/функции? | P0 | Diagnostic | todo |
| 41 | Биллинг | Limits | Какие лимиты по seats/projects/sync? | P1 | Quick | todo |
| 42 | Ошибки и recovery | Top issues | Топовые ошибки регистрации/онбординга/подключений | P0 | Diagnostic | todo |
| 43 | Ошибки и recovery | Support payload | Что приложить в тикет для быстрого решения? | P0 | Checklist | todo |
| 44 | Экспорт | Reports | Как экспортировать отчеты и проверить поля? | P0 | Guide | todo |
| 45 | Экспорт | Mismatch | Почему экспорт расходится с экраном? | P1 | Diagnostic | todo |
| 46 | Безопасность | Data/privacy | Где хранятся данные и как запросить удаление? | P0 | Quick | todo |
| 47 | Безопасность | Legal | Terms/Privacy/DPA простым языком | P1 | Reference | todo |
| 48 | Масштабирование | Multi-project | Как перейти к мультипроектной модели? | P1 | Guide | todo |
| 49 | Масштабирование | Agency ops | Как вести несколько клиентов в одном процессе? | P1 | Guide | todo |
| 50 | Поддержка | Ticket | Как оформить эффективный запрос в поддержку? | P0 | Guide | todo |
| 51 | Поддержка | Escalation | Как и когда эскалировать критический блокер? | P1 | Guide | todo |

---

## Связанные документы

- Подробная матрица: [`docs/knowledge-base/questions-matrix.md`](docs/knowledge-base/questions-matrix.md)
- Карта разделов: [`docs/knowledge-base/ia-sections-map.md`](docs/knowledge-base/ia-sections-map.md)
