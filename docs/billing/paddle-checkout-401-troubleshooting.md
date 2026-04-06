# Paddle: 401 на `/pay` и «не можем принять оплату»

Запрос `POST https://checkout-service.paddle.com/transaction-checkout/che_.../pay` выполняется **внутри iframe Paddle**, не вашим бэкендом. Маршруты вроде `login-checkout-status` здесь не участвуют.

## Что можно игнорировать в консоли

- `Unchecked runtime.lastError: The message port closed...` — часто расширения браузера.
- `[LaunchDarkly] Be sure to call identify...` — внутренний SDK в бандле Paddle Checkout.

## Типичные причины 401 на `/pay`

1. **Sandbox vs Live** — `NEXT_PUBLIC_PADDLE_ENV`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` и все `NEXT_PUBLIC_PADDLE_PRICE_*` / `NEXT_PUBLIC_PADDLE_PRODUCT_*` должны быть из **одного** режима Paddle Dashboard (Sandbox или Live). Несостыковка часто даёт 401 на финальном `/pay`.
2. **Токен не того vendor** — client-side token из Developer tools → Authentication должен принадлежать аккаунту, где заведены эти `pri_` / промокоды.
3. **Устаревшая сессия `che_`** — закрыть overlay, обновить страницу, открыть checkout снова и оплатить без долгой паузы.
4. **$0 сегодня + сильное промо** — отказ может выглядеть как общая ошибка оплаты или 401 на стороне Paddle; это не лечится заменой `Checkout.open` в приложении.

## Проверка переменных окружения

- `NEXT_PUBLIC_PADDLE_PRICE_*` — только **Price ID**, префикс `pri_`, **без пробелов** в значении.
- `NEXT_PUBLIC_PADDLE_PRODUCT_*` — только **Product ID**, префикс `pro_`, без пробелов.
- Не перепутать: в строку заказа (`items[].priceId`) в коде попадает только price id — см. `getPaddlePriceId` в `app/lib/paddlePriceMap.ts`, вызовы в `LoginPageClient.tsx` и `app/lib/paddleCheckoutClient.ts`.

## Минимальное воспроизведение

1. Тот же тариф **без** промокода (или со слабой скидкой). Если проходит — сузить к политике промо / $0 / Paddle.
2. Жёсткое обновление страницы или другой браузер (исключить кэш старого JS).

## Поддержка Paddle

Приложите **ID checkout** из URL/логов (`che_...`), скрин ошибки и время попытки. Только они видят точную причину по внутренним логам.

## Диагностика в development

При `next dev` в консоли браузера:

- Однократное сообщение `[paddle:diag]` при инициализации: согласованы ли `NEXT_PUBLIC_PADDLE_ENV` и префикс токена (`live_` vs `test_`).
- Перед открытием checkout: предупреждения, если `priceId` похож на `pro_` или содержит пробелы, или `productId` похож на `pri_`.

Код: `app/lib/paddleCheckoutConfigDiagnostics.ts`, вызовы из `app/lib/paddle.ts`, `LoginPageClient`, `paddleCheckoutClient`.

## Безопасность

Если live API key, webhook secret или client token попали в скриншоты или чат — **ротировать** в Paddle Dashboard.
