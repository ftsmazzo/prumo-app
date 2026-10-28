# TRD — Prumo

> Technical Requirements Document — traduz o PRD em decisões técnicas.
> Fonte: [x] Entrevista com usuário  [x] Leitura de código (Prumo, Demanda, Poli 2)  [x] Revisão architect ECC
> Depende de: [PRD](PRD.md)

**Data**: 2026-10-28

## 1. Stack tecnológica

| Camada | Tecnologia | Motivo/restrição |
|---|---|---|
| Frontend | React 18/19, Vite, TypeScript | Painel; herda padrões do Prumo sem módulos Milestone |
| Backend | Node 22+, **Fastify**, TypeScript, Zod, `tsx` | Um serviço; schema na borda; Express 5 evitado (atrito middleware — architect ECC) |
| Banco | PostgreSQL 16 com **RLS**; `tenant_id` em toda tabela de negócio | Isolamento real; runtime sem superusuário do schema |
| Fila / jobs | Tabela `jobs` no Postgres (`FOR UPDATE SKIP LOCKED`) | Sobrevive a restart; padrão Poli; um serviço a menos que fila só-Redis |
| Redis | Rate-limit + locks/debounce de curta TTL | Burst de webhook e janelas 1:1; **não** é a fila principal |
| IA | OpenRouter: modelo barato (estrutura) + modelo maior (redigir); Whisper se áudio | Custo controlável; saída validada com Zod; números de resumo vêm de SQL |
| Extratores | Código determinístico (portar de Poli `extrair/` + `gates`) | Zero token em link/fone/endereço; gates pós-modelo |
| WhatsApp | Evolution API | Já na casa; canais `listen_*` ≠ `agent_*` |
| Lint/format | **Biome** (um só) | Não misturar oxlint+Biome |
| Testes | Vitest + PGlite (unidade); **Postgres real** para testes de RLS/vazamento | PGlite não prova RLS |
| Deploy | EasyPanel: `postgres`, `redis`, `app`, `worker` (+ Evolution já existente) | Serviços isolados; não reusar banco de outro projeto |
| Observabilidade | `/health` + logs no MVP; GlitchTip + Uptime Kuma **pós-piloto** | Architect: não bloquear MVP |

## 2. Integrações externas

| Integração | Finalidade | Observações |
|---|---|---|
| Evolution API | Webhook de mensagens; envio do agente; histórico/grupos | Token/segredo no webhook; nunca misturar listen e send no mesmo número de negócio |
| OpenRouter | LLM e embeddings (grupos) | Modelos por env; timeout/retry; fallback se modelo barato falhar |
| SMTP | E-mail de confirmação/recuperação do painel | Pode começar com log em dev; SMTP no EasyPanel depois |
| GlitchTip / Uptime Kuma | Erros e uptime | Fase pós-MVP estável |

## 3. Requisitos não-funcionais

- **Performance:** ingestão mediana &lt; 30 s; busca em grupo p95 &lt; 10 s (amostra MVP); painel Hoje &lt; 2 s com dados do dia.
- **Escala:** MVP = 1–poucos tenants, dezenas de conversas ativas, grupos opt-in limitados. Monólito + worker basta.
- **Segurança:** sessão cookie httpOnly; senha Argon2id; whitelist do agente; webhook autenticado; segredos só em env; RLS + `tenant_id` em toda query de negócio; role runtime sem dono do schema.
- **Compliance:** minimização do payload à IA; auditoria de alterações de demanda/usuário/regra; retenção configurável.
- **Disponibilidade:** sem SLA formal; healthcheck; jobs retomáveis; alerta de instância Evolution caída (fase 2).
- **Idioma/fuso:** pt-BR; fuso configurável por tenant (default `America/Sao_Paulo`).

## 4. Ambiente e deploy

- EasyPanel, projeto dedicado (nome do repo).
- Serviços na ordem: **Postgres → Redis → app (migrate + API/UI) → worker**. Evolution já na infra; só apontar URL/chave/instâncias.
- CI: GitHub Actions — typecheck, lint (Biome), test (Vitest); testes RLS em Postgres de serviço.
- Dockerfile multi-estágio: build do frontend → estáticos servidos pelo app (padrão Demanda) ou nginx interno — preferência: **app serve `/` estático + `/api`**.
- `DATABASE_URL` (migrate) ≠ `APP_DATABASE_URL` (runtime com RLS), no espírito do Demanda.

## 5. Restrições herdadas

- Evolution e EasyPanel já são padrão da Fábrica — não negociável no MVP.
- Não integrar banco/dados dos repos Prumo/Demanda/Poli no dia 1; portar **padrões e trechos** (extratores, gates, ideias de UI), não migrar produção de cara.
- Uma linguagem no core: **TypeScript**. Python do Demanda não entra no monólito.
- Anti-objetivos do PRD/brief são restrição técnica: sem LLM por mensagem de grupo; sem misturar listen/send.

## 6. Manutenção

- Mantenedor: time pequeno / fundador + agentes (mesmo perfil dos três produtos).
- Complexidade aceitável: monólito claro, pastas por domínio (`ingest`, `extract`, `items`, `agent`, `groups`, `api`), sem microserviços, sem n8n no caminho crítico.
- Legados: congelar feature nova; só hotfix de piloto já vendido.

## 7. Decisões de arquitetura (ADRs curtos)

| # | Decisão |
|---|---|
| A1 | Escopo da mensagem = tipo do canal de entrada |
| A2 | Estado canônico de compromisso/tarefa/demanda no SQL; conversa é origem, não o registro final |
| A3 | Jobs no Postgres; Redis só rate-limit/debounce |
| A4 | Extrair → indexar → LLM sob demanda (pergunta / temporizador / redação) |
| A5 | Gates pós-modelo obrigatórios em respostas com números/links/telefones |
| A6 | `tenant_id` (não `workspace_id`) como nome canônico |

---

## Checklist de segurança (todo PR)

- [ ] Nenhum segredo no repo
- [ ] Query com `tenant_id` + teste negativo de vazamento
- [ ] Webhook valida origem antes de gravar
- [ ] Entrada com Zod; sem SQL concatenado
- [ ] Autorização por papel/whitelist na API
- [ ] Mínimo necessário à IA
- [ ] Alterações relevantes na auditoria
