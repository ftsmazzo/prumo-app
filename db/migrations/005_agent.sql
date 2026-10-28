-- Fase 3: whitelist do agente + fila de outbound.

create table if not exists agent_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  phone text not null,
  person_id uuid references people (id) on delete set null,
  can_command boolean not null default true,
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (channel_id, phone)
);

create index if not exists agent_recipients_tenant_idx
  on agent_recipients (tenant_id, phone);

create table if not exists outbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  to_phone text not null,
  body text not null,
  state text not null default 'pending'
    check (state in ('pending', 'sending', 'sent', 'failed')),
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_pending_idx
  on outbound_messages (state, created_at)
  where state = 'pending';

alter table agent_recipients enable row level security;
alter table outbound_messages enable row level security;

drop policy if exists agent_recipients_isolation on agent_recipients;
create policy agent_recipients_isolation on agent_recipients
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists outbound_messages_isolation on outbound_messages;
create policy outbound_messages_isolation on outbound_messages
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
