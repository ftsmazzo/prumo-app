-- Auth mínima do painel (modo Pessoal): dono + sessão cookie.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null,
  password_hash text not null,
  name text not null default '',
  role text not null default 'owner'
    check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

alter table users enable row level security;
alter table sessions enable row level security;

drop policy if exists users_isolation on users;
create policy users_isolation on users
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Sessões: lookup por token_hash no login sem tenant setado (owner do schema bypassa RLS).
drop policy if exists sessions_by_user on sessions;
create policy sessions_by_user on sessions
  using (
    user_id in (
      select id from users
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  );
