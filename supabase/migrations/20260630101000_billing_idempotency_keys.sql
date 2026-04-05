-- Идемпотентность POST apply апгрейда подписки (serverless-safe).
create table if not exists public.billing_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  subscription_id text not null,
  target_price_id text not null,
  idempotency_key text not null,
  status text not null check (status in ('in_progress', 'completed', 'failed')),
  response_json jsonb,
  http_status int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint billing_idempotency_keys_unique_triple unique (subscription_id, target_price_id, idempotency_key)
);

create index if not exists billing_idempotency_keys_expires_at_idx
  on public.billing_idempotency_keys (expires_at);

comment on table public.billing_idempotency_keys is 'Кэш ответов apply upgrade Paddle; только service role.';

alter table public.billing_idempotency_keys enable row level security;
