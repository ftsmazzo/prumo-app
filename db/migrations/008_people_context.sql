-- Contexto de pessoa (herança Prumo): nota e relação — sem CRM Milestone.

alter table people
  add column if not exists note text not null default '',
  add column if not exists relation text not null default '';

comment on column people.note is 'Blurb curto do contato (secretária), não dump de conversa.';
comment on column people.relation is 'Como se relaciona (ex.: sócio, fornecedor, médico).';
