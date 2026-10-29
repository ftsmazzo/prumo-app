-- Contexto maduro (herança Prumo): tags, micro-resumo, origem do nome.

alter table people
  add column if not exists name_source text not null default 'push'
    check (name_source in ('push', 'agent', 'manual', ''));

alter table conversations
  add column if not exists tags text[] not null default '{}',
  add column if not exists micro_summary text not null default '';

alter table conversation_briefs
  add column if not exists micro_summary text not null default '';

create index if not exists conversations_tags_gin
  on conversations using gin (tags);

create index if not exists messages_text_trgm_ready on messages (tenant_id, conversation_id);

comment on column conversations.tags is 'Tags da interação/conversa (cliente, urgência, tema).';
comment on column conversations.micro_summary is 'Resumo curto para o agente (não substitui o fio bruto).';
comment on column conversation_briefs.micro_summary is 'Espelho do micro-resumo no fichamento.';
