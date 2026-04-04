# CJM биллинга: inline Paddle Checkout (итерация)

## Было → стало

| Точка | Было | Стало |
| --- | --- | --- |
| PAYWALL (hard) | CTA «Выбрать тариф» → `/pricing-comparison` → только ссылки на `/login` | В оверлее `BillingShellGate`: блок `BillingInlinePricing` (период, 3 плана, Paddle), ссылка на полное сравнение |
| OVER_LIMIT_FULLSCREEN | Только «Управление подпиской» → настройки без Paddle | Тот же оверлей + inline оплата с подсказкой следующего тарифа (`suggestUpgradePlanId`) + кнопка в портал настроек |
| READ_ONLY_SHELL (unpaid/expired/paused) | Нет единого заметного CTA на оплату | Sticky-баннер `ReadOnlyPaywallBanner` с модалкой того же `BillingInlinePricing` |
| Topbar «Сменить тариф» | Клик без действия | Модалка с `BillingInlinePricing`; при `pending_plan_change` — disabled + подсказка; без `billing_manage` — переход в настройки |
| `/pricing-comparison` (сессия есть) | Все CTA вели на login | `PricingBuyButton`: Paddle для залогиненных, прежний login URL для гостей; после оплаты — `broadcast` + редирект в `/app` |
| После оплаты | Ручной refresh | `checkout.completed` → `reloadBootstrap` + `broadcastBillingBootstrapInvalidate` (в провайдере приложения); на лендинге сравнения — инвалидация + `/app` |

Контракт `ResolvedUiStateV1` и `billingShellResolver.ts` **не менялись**. Ветвление UI по `screen`, `reason`, `allowed_actions`, `pending_plan_change`.

## Файлы

- `app/lib/paddle.ts` — `addPaddleEventListener` (стек с login-flow).
- `app/lib/paddleCheckoutClient.ts` — `openPaddleSubscriptionCheckout`, общий listener, таймаут 25s.
- `app/lib/billingPlanDisplay.ts` — цены/лейблы, `suggestUpgradePlanId`.
- `app/app/components/BillingInlinePricing.tsx` — UI выбора плана и оплаты.
- `app/app/components/BillingShellGate.tsx` — inline pricing для subscribe / over-limit; `Suspense` + `project_id` из URL.
- `app/app/components/BillingShellBanners.tsx` — `ReadOnlyPaywallBanner`.
- `app/app/(with-sidebar)/layout.tsx` — подключение баннера.
- `app/app/components/Topbar.tsx` — модалка смены тарифа.
- `app/pricing-comparison/PricingBuyButton.tsx` — залогиненная ветка.
- `app/pricing-comparison/page.tsx` — использование `PricingBuyButton`.
- `app/login/LoginPageClient.tsx` — `addPaddleEventListener` вместо перезаписи глобального handler.

## Риски

- Задержка webhook Paddle: после `checkout.completed` bootstrap может ещё кратко показывать старый `resolved_ui`; копирайт и «Обновить статус» остаются релевантны.
- Один checkout одновременно: `paddleCheckoutClient` отклоняет второй вызов, пока открыто окно.
- На `/pricing-comparison` нет `BillingBootstrapProvider`; после оплаты используется редирект в `/app`, а не локальный `reloadBootstrap`.

## Проверено (ручные сценарии)

Статус: **не автоматизировано** — прогон вручную в staging/prod.

1. **Новый пользователь, signup + Paddle на login** — checkout открывается, события не конфликтуют с in-app listener.
2. **Expired/unpaid, READ_ONLY** — виден sticky-баннер, из модалки открывается Paddle, после успеха bootstrap обновляется в приложении (другая вкладка — broadcast).
3. **OVER_LIMIT** — в hard overlay виден inline upgrade + переходы в проекты/команду/аккаунты.
4. **`pending_plan_change`** — Topbar «Сменить тариф» неактивен; на pricing-comparison кнопка «Приобрести» в состоянии ожидания; в inline-блоках checkout скрыт/заблокирован там, где учтён флаг.
5. **Multi-tab** — после оплаты в одной вкладке вторая подхватывает обновление через `broadcastBillingBootstrapInvalidate`.
6. **PAYWALL** — без ухода на логин сравнения можно оплатить из оверлея.
7. **Гость на `/pricing-comparison`** — CTA ведут на прежний `buildLoginPurchaseHref`.

Скриншоты flow в репозиторий не добавлялись (по согласованию — только текст отчёта).
