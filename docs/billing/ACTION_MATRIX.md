# Action matrix (BoardIQ Billing UX Hardening §4)

Единая таблица «reason / режим → действия в UI». **API остаётся финальным gate** (`requireBillingAccess`, project/org guards); матрица задаёт ожидания для QA и согласованность с `resolved_ui_state.allowed_actions` из `app/lib/billingShellResolver.ts`.

| Reason / режим | `create_project` | `sync` / `refresh` | `export` | `billing_manage` | `navigate_app` | `navigate_settings` | `navigate_projects` |
| -------------- | ---------------- | ------------------ | -------- | ---------------- | -------------- | ------------------- | ------------------- |
| `POST_CHECKOUT_REQUIRED` | ✗ | ✗ | ✗ | по политике модалки | только шаги модалки | ограниченно | ✗ |
| `INVITE_PENDING` / `INVITE_TIMEOUT` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `PAID_NO_PROJECT` | ✓ | ✗ | ✗ | ✓ (owner) | ✓ | ✓ | ✗ |
| `NO_ACTIVE_PROJECT` | ✗* | ✗ | ✗ | по роли | ✓ | ✓ | ✓ |
| `NO_ACCESS_TO_ORG` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (`retry_bootstrap`, `support`, `sign_out` в resolver) |
| `PLAN_CHANGE_PENDING` | ✗ до confirm | ✗ | ✗ | read / retry | ✓ | ✓ | по политике |
| `BILLING_GRACE` / `BILLING_PAST_DUE` | по лимитам | ~ | ~ | ✓ owner | ✓ | ✓ | ✓ |
| `BILLING_UNPAID` / `BILLING_EXPIRED` | ✗ | ✗ | ✗ | ✓ owner | ✓ read-only | ✓ | ✓ |
| `BILLING_NO_SUBSCRIPTION` | ✗ | ✗ | ✗ | ✓ (checkout) | paywall | ограниченно | ✗ |
| `OVER_LIMIT_*` | ✗ до фикса | ✗ | ✗ | ✓ owner | fullscreen block | разрешённые | ✗ |
| `BILLING_REFUNDED` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `BILLING_DEMO_MODE` | по демо-политике | ограничено | ограничено | ~ | ✓ | ✓ | ~ |
| `BOOTSTRAP_UNAVAILABLE` (клиент) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

\*Создание проекта при `NO_ACTIVE_PROJECT` — обычно ✗; исключения документировать отдельно.

Обновлять эту таблицу при изменении `ActionId` / resolver / серверных gates.
