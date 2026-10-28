-- Fase 4: grupos opt-in + itens extraídos (origem sempre apontada).

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  jid text not null,
  name text not null default '',
  follow boolean not null default false,
  interval_min int not null default 60,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, jid)
);

create index if not exists groups_follow_idx
  on groups (tenant_id, follow)
  where follow = true;

create table if not exists extracted_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  group_id uuid references groups (id) on delete set null,
  kind text not null check (kind in ('link', 'phone', 'email', 'address', 'file')),
  value text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

create index if not exists extracted_items_value_idx
  on extracted_items (tenant_id, kind, lower(value));

alter table groups enable row level security;
alter table extracted_items enable row level security;

drop policy if exists groups_isolation on groups;
create policy groups_isolation on groups
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists extracted_items_isolation on extracted_items;
create policy extracted_items_isolation on extracted_items
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
