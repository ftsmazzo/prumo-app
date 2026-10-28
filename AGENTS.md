# AGENTS.md — Prumo (prumo-app)

Fonte única de regras para agentes e humanos. Detalhe de produto em `docs/` e `PRODUTO.md`.

## O que é

Motor que lê WhatsApp (1:1 + grupos opt-in), cria e atualiza compromisso/tarefa/demanda, e fala só com quem manda — modo Pessoal, Escritório, ou os dois.

MVP atual: **modo Pessoal** (fase 0 = scaffold + `/health`).

## Stack

- Node 22 + Fastify + TypeScript + Zod
- React + Vite (UI em `web/`, API em `server/`)
- PostgreSQL 16 + RLS (`tenant_id`); jobs no Postgres
- Redis: rate-limit / debounce (não fila principal)
- Evolution API; OpenRouter; EasyPanel (`prumo-app`)

## Repositório público

O GitHub é **público** de propósito: o EasyPanel desta conta não lê repo privado.
Isso exige disciplina:

- Nunca commitar segredos, `.env`, tokens, mensagens reais, números de cliente.
- Só `.env.example` com placeholders.
- Não colocar estratégia confidencial de cliente piloto em docs públicos além do necessário.
- Se um dia o token do EasyPanel passar a acessar privados, avaliar tornar privado.

## Princípios

1. Gravar mensagem bruta primeiro; processar depois. Idempotência `(channel_id, provider_message_id)`.
2. Escuta ≠ envio (números separados).
3. Escopo vem do **canal**, não de adivinhação da IA.
4. Operar > classificar (criar e atualizar compromisso/tarefa).
5. Extratores/gates antes de LLM; números de resumo vêm de SQL.
6. Modos plugáveis; não obrigar quatro telefones.
7. Grupo: opt-in; sem LLM por mensagem.

## Checklist de segurança (todo PR)

- [ ] Nenhum segredo no repo
- [ ] Consulta com `tenant_id` + teste negativo de vazamento (quando houver multi-tenant)
- [ ] Webhook valida origem antes de gravar
- [ ] Entrada com Zod; sem SQL concatenado
- [ ] Whitelist do agente na API
- [ ] Mínimo necessário à IA
- [ ] Alterações relevantes na auditoria

## Fluxo de trabalho

- Issue → branch → PR pequeno para `main`
- CI: typecheck, Biome, Vitest
- Não abrir feature nova em Prumo/Demanda/Poli legados (só hotfix)

## Comandos

```bash
npm ci
npm run dev          # API :3000
npm run dev:web      # Vite :5173
npm test
npm run lint
npm run build
```

## EasyPanel

Cota da conta: não cabia projeto novo. Serviços do unificado ficam no projeto **`prumo`** (legado), com nomes isolados:

| Serviço | Papel |
|---|---|
| `core` | App do unificado (`prumo-app` no GitHub) |
| `core-db` | Postgres dedicado (`prumov2`) |
| `core-redis` | Redis (rate-limit/debounce) |
| `app` / `postgres` / `evolution-*` | **Legado** — não misturar |

Domínio: `https://prumo-core.z23axp.easypanel.host`  
Source: Git **público** `https://github.com/ftsmazzo/prumo-app.git` (HTTPS; privado não lê neste EasyPanel).

Ordem mental: core-db → core-redis → core → worker (quando existir).
