# Esquema Backend — Prumo

> Modelagem de dados e API.
> Fonte: [x] PRD/TRD  [x] Heranças Demanda (RLS), Poli (grupos/itens/jobs), Prumo (compromissos/tarefas)
> Depende de: [TRD](TRD.md)

**Data**: 2026-10-28

## 1. Entidades principais

Toda tabela de negócio tem `tenant_id` + política RLS. Runtime usa papel sem bypass de RLS.

| Entidade | Campos-chave | Relacionamentos |
|---|---|---|
| `tenants` | id, name, slug, timezone, modes (pessoal/escritório flags), settings | Pai de tudo |
| `users` | id, tenant_id, email, password_hash, name, role | Sessões; papéis MVP: `owner`, `admin` (+ `partner`/`manager`/`member` na fase 2) |
| `sessions` | user_id, token_hash, expires_at | Cookie httpOnly |
| `channels` | tenant_id, kind (`listen_personal` \| `listen_office` \| `agent_personal` \| `agent_office`), instance_name, secret_hash, status, listen_groups | 0..N por tenant |
| `people` | tenant_id, phone, name, kind, tags | Contatos / interlocutores |
| `agent_recipients` | tenant_id, channel_id, person_id / phone, can_command | Whitelist do agente |
| `messages` | tenant_id, channel_id, provider_message_id, direction, remote_jid, participant_phone, type, text, media_ref, sent_at, raw | **UNIQUE (channel_id, provider_message_id)** |
| `conversations` | tenant_id, channel_id, person_id, last_message_at | 1:1 |
| `groups` | tenant_id, channel_id, jid, name, follow, interval_min, last_read_message_id | Opt-in |
| `extracted_items` | tenant_id, message_id, type (link\|file\|contact\|address), value, data, dedupe_key | Sempre aponta origem |
| `commitments` | tenant_id, scope (`personal`\|`office`), title, starts_at, ends_at, status, person_id, source_message_id, needs_confirm | Estado canônico |
| `tasks` | tenant_id, scope, title, status, due_on, assignee_user_id, person_id, source_message_id, needs_confirm | **Sem** project_id obrigatório |
| `demands` | tenant_id, sector_id, title, status, urgency, assignee_user_id, source… | Fase 2 escritório |
| `sectors` | tenant_id, name | Fase 2 |
| `windows` | tenant_id, group_id, from_msg, to_msg, text, embedding | Busca semântica grupos |
| `summaries` / `alerts` | grupo, importância, dedupe_key, sent_at | Fase 2 leitura periódica |
| `jobs` | tenant_id, type, payload, dedupe_key, run_at, attempts, state | Fila Postgres |
| `audit_log` | tenant_id, actor, action, entity, before/after | Auditoria leve |
| `outbound_messages` | tenant_id, channel_id, to_jid, body, state, provider_id | Tudo que o agente envia |

## 2. Autenticação e autorização

- **Painel:** e-mail + senha (Argon2id), sessão cookie httpOnly (só hash no banco), rate-limit (Redis).
- **Agente WhatsApp:** whitelist em `agent_recipients`; fora da lista = silêncio.
- **Webhook:** segredo por canal (header; não confiar só em query string).
- **API:** papel do usuário + escopo do modo; nunca confiar `tenant_id` do body — vem da sessão.
- **Fase 2:** papéis Demanda (sócio / gestor / colaborador) e escopo por setor.

## 3. Endpoints/ações principais

| Endpoint/Ação | Método | Auth | Regra |
|---|---|---|---|
| `/health` | GET | Não | Processo + ping DB (sem detalhes sensíveis) |
| `/webhooks/evolution/:channelId` | POST | Segredo canal | Grava idempotente; enfileira jobs |
| `/api/auth/*` | POST/GET | Misto | Login, logout, me |
| `/api/channels` | GET/POST/PATCH | Admin | Ligar/desligar slots; nunca devolver segredo em claro |
| `/api/today` | GET | Sim | Compromissos + tarefas do dia (SQL) |
| `/api/commitments` | GET/POST/PATCH | Sim | Criar/remarcar/cancelar |
| `/api/tasks` | GET/POST/PATCH | Sim | Status, prazo, concluir |
| `/api/people` | GET/PATCH | Sim | Contatos |
| `/api/groups` | GET/PATCH | Sim | `follow`, intervalo |
| `/api/search` | GET | Sim | Híbrida; devolve origem |
| `/api/diagnostics` | GET | Admin | Saúde canais, fila, últimos erros |
| Agent tools (interno) | — | Whitelist | `today`, `reschedule`, `complete`, `search_groups`… |

Busca/comando ricos também ocorrem via turno do agente (não só REST).

## 4. Processamento assíncrono

| Job | Gatilho | Faz |
|---|---|---|
| `ingest_followup` | mensagem nova 1:1 | Debounce (Redis lock) → operar compromisso/tarefa |
| `extract_items` | mensagem (1:1 ou grupo) | Extratores determinísticos |
| `index_window` | ~10 msgs de grupo | Embedding |
| `agent_turn` | mensagem no canal agent | Tools + gates + outbound |
| `send_outbound` | linha pendente | Evolution send + retry |
| `follow_group` | cron por grupo (fase 2) | Resumo + importância + alerta |
| `health_check` | periódico (fase 2) | Instância Evolution |

Worker: mesmo código do app, processo separado (`worker` no EasyPanel), consome `jobs`.

## 5. Armazenamento

- Estruturado: Postgres.
- Mídia: volume EasyPanel (`MEDIA_DIR`), metadados no banco; dedupe por hash no tenant.
- Vetores: pgvector quando o módulo de busca semântica de grupos entrar (pode ser migration da fase grupos).
- Sensível: mensagens, telefones; segredos de canal só hash; chaves de API só env.
- Volume MVP: 1 tenant ativo (usuário-zero), crescimento controlado; retenção “manter” até política fina.

## 6. Invariantes

1. `UNIQUE (channel_id, provider_message_id)`.
2. Compromisso/tarefa têm estado próprio; texto da mensagem não é o registro final.
3. Canal `listen_*` não envia; `agent_*` não é escuta do número do negócio.
4. Toda query de negócio filtra `tenant_id` (sessão) + RLS.
5. Resposta do agente com link/fone/número passa por gates (evidência).
