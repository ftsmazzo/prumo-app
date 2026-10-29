-- Fase 5: métrica de token por turno/conversa.

create table if not exists token_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  message_id uuid references messages (id) on delete set null,
  purpose text not null default 'unknown',
  model text not null default '',
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  total_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists token_usage_tenant_idx
  on token_usage (tenant_id, created_at desc);

alter table token_usage enable row level security;

drop policy if exists token_usage_isolation on token_usage;
create policy token_usage_isolation on token_usage
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
