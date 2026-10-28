-- Conversa organizada (evidência) ≠ compromisso/tarefa (estado canônico).
-- Anti-Demanda: a mensagem NUNCA é o registro final de um compromisso.

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null,
  name text,
  kind text not null default 'contact'
    check (kind in ('contact', 'self', 'colleague', 'unknown')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

create index if not exists people_tenant_name_idx on people (tenant_id, lower(coalesce(name, '')));

-- Uma conversa 1:1 por canal + telefone (thread).
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  person_id uuid references people (id) on delete set null,
  peer_phone text not null,
  peer_push_name text,
  title text not null default '',
  last_message_at timestamptz not null default now(),
  last_message_id uuid,
  message_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, peer_phone)
);

create index if not exists conversations_tenant_last_idx
  on conversations (tenant_id, last_message_at desc);

-- Fichamento / entendimento da conversa (não é compromisso).
create table if not exists conversation_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  person_id uuid references people (id) on delete set null,
  summary text not null default '',
  open_threads text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (conversation_id)
);

alter table messages
  add column if not exists conversation_id uuid references conversations (id) on delete set null,
  add column if not exists person_id uuid references people (id) on delete set null;

create index if not exists messages_conversation_idx
  on messages (conversation_id, provider_timestamp);

-- Estado canônico: compromisso (tem horário).
create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  scope text not null default 'personal'
    check (scope in ('personal', 'office')),
  title text not null,
  status text not null default 'planned'
    check (status in ('planned', 'confirmed', 'done', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  note text not null default '',
  person_id uuid references people (id) on delete set null,
  conversation_id uuid references conversations (id) on delete set null,
  source_message_id uuid references messages (id) on delete set null,
  needs_confirm boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commitments_tenant_starts_idx
  on commitments (tenant_id, starts_at);
create index if not exists commitments_person_open_idx
  on commitments (tenant_id, person_id, starts_at)
  where status in ('planned', 'confirmed');

-- Estado canônico: tarefa (ação com andamento; sem horário obrigatório).
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  scope text not null default 'personal'
    check (scope in ('personal', 'office')),
  title text not null,
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done', 'cancelled')),
  due_on date,
  note text not null default '',
  person_id uuid references people (id) on delete set null,
  conversation_id uuid references conversations (id) on delete set null,
  source_message_id uuid references messages (id) on delete set null,
  needs_confirm boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_tenant_status_idx
  on tasks (tenant_id, status, due_on);
create index if not exists tasks_person_open_idx
  on tasks (tenant_id, person_id)
  where status in ('todo', 'doing');

-- Auditoria leve de decisões do motor.
create table if not exists decision_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  message_id uuid references messages (id) on delete set null,
  kind text not null,
  action text not null,
  entity_type text,
  entity_id uuid,
  rationale text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists decision_events_tenant_idx
  on decision_events (tenant_id, created_at desc);

alter table people enable row level security;
alter table conversations enable row level security;
alter table conversation_briefs enable row level security;
alter table commitments enable row level security;
alter table tasks enable row level security;
alter table decision_events enable row level security;

drop policy if exists people_isolation on people;
create policy people_isolation on people
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists conversations_isolation on conversations;
create policy conversations_isolation on conversations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists conversation_briefs_isolation on conversation_briefs;
create policy conversation_briefs_isolation on conversation_briefs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists commitments_isolation on commitments;
create policy commitments_isolation on commitments
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists tasks_isolation on tasks;
create policy tasks_isolation on tasks
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists decision_events_isolation on decision_events;
create policy decision_events_isolation on decision_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
