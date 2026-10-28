# Plano de Implementação — Prumo

> Roteiro de execução.
> Depende de: [PRD](PRD.md), [TRD](TRD.md), [Fluxo](FLUXO-APP.md), [UI/UX](UIUX.md), [Esquema](ESQUEMA-BACKEND.md)

**Data**: 2026-10-28

## 1. MVP

Valor testável (usuário-zero, modo Pessoal):

1. Tenant + auth + canais `listen_personal` + `agent_personal`.
2. Ingestão Evolution idempotente + jobs Postgres + debounce Redis.
3. Criar **e atualizar** compromisso/tarefa a partir de 1:1.
4. Agente whitelist: Hoje, remarcar, concluir (com gates).
5. Painel: Hoje, Agenda, Tarefas, Contatos, Canais/Diagnóstico.
6. Grupos opt-in: gravar + extrair + busca com origem (sem MCP, sem alerta periódico ainda).
7. Métrica de token por conversa/turno gravada.

**Não entra no MVP:** modo Escritório completo, Kanban, digest sócios, GlitchTip/Kuma, MCP, mídia pesada.

## 2. Fases

| Fase | Escopo | Prioridade | Dependências |
|---|---|---|---|
| **0. Base** | Repo único, Fastify `/health`, Postgres+RLS, Redis, migrate, Dockerfile, CI Biome+Vitest, scaffold EasyPanel (postgres→redis→app→worker) | Crítica | Conta EasyPanel, repo GitHub privado |
| **1. Canais + ingestão** | Modelagem channels/messages, webhook Evolution, idempotência, worker jobs | Alta | Instâncias Evolution de teste |
| **2. Operar 1:1** | Pipeline regras→LLM curto→commitments/tasks; confirmar na dúvida; API + painel Hoje/Agenda/Tarefas | Alta | OpenRouter |
| **3. Agente** | Whitelist, tools SQL, outbound, gates | Alta | Fase 2 |
| **4. Grupos enxutos** | follow, extratores (portar Poli), index/busca com origem | Alta | Fase 1 |
| **5. Piloto Pessoal** | Usuário-zero real; métrica token; calibrar confirmação | Alta | Fases 2–4 |
| **6. Escritório** | listen_office, agent_office, sectors, demands, Kanban, papéis | Média | MVP Pessoal estável |
| **7. Proatividade** | follow_group + alertas; digest sócios; saúde Evolution | Média | Fase 6 ou paralelo leve |
| **8. Endurecer** | GlitchTip, Uptime Kuma, retenção/export LGPD, ICS | Baixa | Piloto ok |

### Se precisar cortar

1. Busca semântica (fica busca textual + itens extraídos).
2. Painel Contatos rico (mínimo: nome/telefone).
3. Debounce Redis → debounce só em job atrasado no Postgres (Redis fica só rate-limit).

**Não cortar:** atualizar compromisso/tarefa; whitelist; idempotência; gates; separação listen/agent.

## 3. Marcos externos

- Sem data de eleição/cliente amarrada neste plano.
- Marco interno: **piloto Pessoal usável** ao fim da fase 5.
- Contabilidade / pack Escritório só após o loop da seção 8 do brief estar vivo.

## 4. Critério de “pronto” por fase

- **0:** `/health` no domínio EasyPanel; CI verde; migrate no boot; RLS role runtime.
- **1:** mensagem de teste no listen aparece no banco sem duplicar; reenvio de webhook idempotente.
- **2:** diálogo com horário cria compromisso; “remarca para amanhã” (painel) atualiza o mesmo registro; mensagem bruta intacta se o job falhar.
- **3:** número fora da whitelist não obtém resposta; “o que tenho hoje?” reflete SQL; gate bloqueia telefone inventado (teste).
- **4:** grupo sem follow não indexa; com follow, link extraído é buscável com origem.
- **5:** dono usa 5 dias úteis; tokens/msg &lt; baseline Prumo legado; ≥ 70% itens sem retrabalho total (amostra).
- **6:** demanda muda de coluna/responsável e persiste; sócio na whitelist recebe só o que a política permite.
- **7–8:** alertas sem duplicata; monitor de queda; backup documentado.

## 5. Dependências que bloqueiam

- [ ] Nome final do repositório GitHub (sugestão: `prumo`) e org/owner.
- [ ] Projeto EasyPanel novo (não reusar DB de outro).
- [ ] 2 instâncias Evolution de teste (listen + agent) para o modo Pessoal.
- [ ] Chave OpenRouter.
- [ ] Congelar feature nova em Prumo/Demanda/Poli 2 (só hotfix).

## 6. Regra anti-produto-morto

Só abrir o repo e o scaffold EasyPanel **depois** deste pacote de docs aprovado.  
Implementação segue fases 0→5 sem pular para Escritório “para adiantar”.  
Sucesso = loop **entra → atualiza estado → agente/painel mexe → SQL reflete**, não “webhook verde”.
