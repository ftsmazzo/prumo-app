-- Fase 1: tenants, canais, mensagens, jobs. RLS por tenant_id.

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Sao_Paulo',
  mode_personal boolean not null default true,
  mode_office boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  kind text not null check (
    kind in ('listen_personal', 'listen_office', 'agent_personal', 'agent_office')
  ),
  name text not null,
  instance_name text,
  secret_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'down', 'disabled')),
  listen_groups boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, name)
);

create index if not exists channels_tenant_idx on channels (tenant_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  provider_message_id text not null,
  direction text not null check (direction in ('in', 'out')),
  remote_jid text not null,
  contact_phone text not null,
  push_name text,
  message_type text not null,
  text text,
  media jsonb,
  provider_timestamp timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (channel_id, provider_message_id)
);

create index if not exists messages_tenant_created_idx
  on messages (tenant_id, created_at desc);
create index if not exists messages_channel_created_idx
  on messages (channel_id, created_at desc);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  state text not null default 'pending'
    check (state in ('pending', 'running', 'done', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_dedupe_pending_idx
  on jobs (tenant_id, dedupe_key)
  where dedupe_key is not null and state in ('pending', 'running');

create index if not exists jobs_claim_idx
  on jobs (state, run_at, id)
  where state = 'pending';

alter table tenants enable row level security;
alter table channels enable row level security;
alter table messages enable row level security;
alter table jobs enable row level security;

-- Políticas: app seta app.tenant_id na sessão. Superuser/dono do schema bypassa (migrate).
drop policy if exists tenants_isolation on tenants;
create policy tenants_isolation on tenants
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists channels_isolation on channels;
create policy channels_isolation on channels
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists messages_isolation on messages;
create policy messages_isolation on messages
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists jobs_isolation on jobs;
create policy jobs_isolation on jobs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
