-- VIP: segunda marca ortogonal a Cliente (prioridade de aviso).

alter table people
  add column if not exists vip boolean not null default false;

comment on column people.vip is 'Prioridade de aviso (pedido Eliezer). Ortogonal a kind=client.';

create index if not exists people_vip_idx on people (tenant_id) where vip = true;
