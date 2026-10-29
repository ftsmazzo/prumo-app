-- Empresas + papel do contato; exclusão do número do agente na escuta.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  note text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organizations_tenant_name_uidx
  on organizations (tenant_id, lower(name));

create index if not exists organizations_tenant_idx on organizations (tenant_id);

alter table organizations enable row level security;
drop policy if exists organizations_isolation on organizations;
create policy organizations_isolation on organizations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table people drop constraint if exists people_kind_check;
alter table people
  add column if not exists organization_id uuid references organizations (id) on delete set null,
  add column if not exists role_title text not null default '',
  add column if not exists importance text not null default 'normal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'people_importance_check'
  ) then
    alter table people
      add constraint people_importance_check
      check (importance in ('low', 'normal', 'high', 'critical'));
  end if;
end $$;

alter table people
  add constraint people_kind_check
  check (kind in ('contact', 'self', 'colleague', 'unknown', 'client', 'vendor', 'agent'));

alter table channels
  add column if not exists wa_phone text not null default '';

comment on column channels.wa_phone is 'Número WhatsApp da instância (agente/listen). Peer com este número não entra no motor.';
comment on column people.kind is 'agent = próprio bot/secretaria — nunca fichar como contato.';
comment on column people.importance is 'Sinal para o motor/agente priorizar (cliente alto, etc.).';
comment on column people.role_title is 'Cargo na empresa (ex.: funcionário, dono, sócio).';
