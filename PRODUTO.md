# Produto Unificado — Brief v0

> Nome de trabalho: **Prumo** (packs Pessoal / Escritório / Completo).
> Blueprint completo em [`docs/`](./docs/) (PRD → Plano). Não nasce repo de código até aprovação.
> Fontes: Prumo · Demanda · Poli 2 · conversa 2026-10-28 · architect ECC.

---

## 1. Em uma frase

Sistema que **lê WhatsApp** (1:1 e grupos opt-in), **organiza e atualiza** compromissos/tarefas/demandas, e **fala só com quem manda** — no modo pessoal (chefe) e/ou no modo escritório (sócios e equipe), no mesmo motor.

## 2. Por que unificar (e o que cada um falhou)

| Produto | Força | Falha que dói |
|---|---|---|
| **Prumo** | Lê bem 1:1; painel mais maduro; opera (cria/atualiza) | Come token demais; pessoal demais; dívida Milestone |
| **Demanda** | Modelo de escritório (setor, papel, tenant); barato na classificação | Classifica e trava: não remarca, não move, compromisso “preso” na conversa |
| **Poli 2** | Grupos: extrair, indexar, resumir, alertar, responder com origem | Escopo de campanha; não é gestor pessoal nem Kanban de escritório |

**Tese:** um motor. Três heranças. Dois modos de produto (pessoal / escritório), vendáveis juntos ou separados. Grupos entram como **módulo de escuta**, não como produto à parte.

## 3. Anti-objetivos (o que NÃO vamos ser)

Se qualquer item abaixo entrar no MVP, paramos e cortamos.

1. **Não** é um 4º monólito paralelo (“Prumo 3”) com cópia parcial dos três.
2. **Não** é CRM/ERP completo (Gantt, pipeline Negócios, Form Filler, cobrança de tenant no dia 1).
3. **Não** responde cliente final nem escreve em grupo sem menção/whitelist.
4. **Não** manda LLM em **toda** mensagem de grupo.
5. **Não** obriga os 4 números + grupos no onboarding — modos são plugáveis.
6. **Não** mistura escuta e envio no mesmo número.
7. **Não** “adivinha” se algo é pessoal ou da empresa: o **canal de entrada** define o escopo.

## 4. Quem é atendido

| Persona | Modo | O que ganha |
|---|---|---|
| Chefe / profissional | Pessoal | Dia fechado: agenda, tarefas, o que combinou, o que rolou nos grupos que importam |
| Sócio | Escritório | Visão do que entra no WhatsApp da firma, o que está parado, resumo/alerta |
| Gestor de setor / colaborador | Escritório | Quadro do setor / o que é seu (papéis Demanda) |
| Cliente / fornecedor / membro de grupo | — | **Não usa o produto**; só é ouvido |

## 5. Modos de produto (comercial = técnico)

| Pack | Escutas ativas | Agentes ativos |
|---|---|---|
| **Só Pessoal** | WhatsApp do chefe (+ grupos opt-in) | Agente pessoal |
| **Só Escritório** | WhatsApp da empresa | Agente dos sócios |
| **Completo** | As duas (+ grupos no pessoal; grupos de operação depois) | Os dois agentes |

Regra: **zero a N canais**. O motor não exige os quatro slots cheios.

## 6. Canais (estrutura dos “telefones”)

```
                    ┌─ escuta pessoal (1:1) ─────────────┐
Número do chefe ────┤                                     │
                    └─ escuta grupos (opt-in) ────────────┤
                                                         ├──► INBOX ÚNICO
Número da empresa ── escuta escritório (1:1) ────────────┤     (grava bruto primeiro)
                                                         │
Número agente pessoal ──► só whitelist do chefe ◄────────┤
Número agente escritório ► só sócios / papéis  ◄─────────┘
```

| Slot | Tipo | Direção | Obrigatório? |
|---|---|---|---|
| Escuta pessoal | `listen_personal` | só recebe | se modo Pessoal |
| Escuta escritório | `listen_office` | só recebe | se modo Escritório |
| Agente pessoal | `agent_personal` | só envia (+ recebe comando do chefe) | se modo Pessoal |
| Agente escritório | `agent_office` | só envia (+ comando dos sócios) | se modo Escritório |
| Grupos | flag nos listens | só recebe; processa barato | opcional, default off |

**Roteamento:** mensagem herda o escopo do canal. Sem classificador “pessoal vs empresa”.

## 7. Motor único — o que cada herança alimenta

```
Webhook Evolution
       │
       ▼
  GRAVAR BRUTO (idempotente)          ← Demanda + Poli (nunca perder)
       │
       ▼
  FILA / JOBS (Postgres)              ← Poli/Prumo padrão
       │
       ├── 1:1 pessoal ──► LEITURA OPERADORA          ← Prumo (enxuto em token)
       │                    cria/atualiza compromisso,
       │                    tarefa, nota; confirma na dúvida
       │
       ├── 1:1 escritório ► CLASSIFICA + OPERA       ← Demanda (regras) + Prumo (atualizar)
       │                    demanda/setor/responsável;
       │                    mover, remarcar, anexar follow-up
       │
       └── grupo (opt-in) ► EXTRAIR → INDEXAR →      ← Poli 2
                            (LLM só em: pergunta,
                             temporizador, alerta)
       │
       ▼
  ESTADO CANÔNICO NO SQL
  (compromisso, tarefa, demanda, item, resumo)
       │
       ├── Painel web (base visual Prumo + setores Demanda)
       └── Agentes (tools sobre o SQL; whitelist; gates Poli)
```

### Herança explícita

| Capacidade | Herda de | Descarta / muda |
|---|---|---|
| Painel “Hoje”, agenda, tarefas, contatos | **Prumo** | Módulos Milestone (Gantt, Negócios, capa de projeto) |
| Tenant, setor, papéis, Kanban, RLS | **Demanda** | “Só classificar sem atualizar” |
| Extratores, gates, janelas, ler_grupo, alerta com teto | **Poli 2** | Fontes MCP/urna, papéis Head/VIP de campanha (no MVP) |
| Fichamento cumulativo agressivo | Prumo | **Cortar**: contexto mínimo + SQL; LLM sob demanda |
| Compromisso = texto da conversa | Demanda | **Morrer**: compromisso é entidade com horário/estado |

## 8. Loop que o produto tem que fechar (senão é morto)

O critério de vida não é “ingestão ok”. É este loop:

1. **Entra** mensagem (1:1 ou grupo marcado).
2. **Vira ou atualiza** item real (compromisso com horário, tarefa com status, demanda com setor).
3. **Humano ou agente mexe** (remarcar, concluir, mudar responsável, pedir “o que tenho hoje?”).
4. **Estado no SQL muda**; painel e próximo resumo refletem isso.
5. **Custo de token** fica sob métrica (por conversa / por alerta / por turno).

Se o passo 2 ou 3 falhar, voltamos ao Demanda atual (classifica e trava) ou ao Prumo caro — os dois caminhos mortos.

## 9. Política de token (requisito de produto)

| Situação | Usa LLM? | Como |
|---|---|---|
| Gravar mensagem | Não | SQL |
| Link, telefone, endereço, vCard | Não | Extratores Poli |
| Indexar janela de grupo | Embedding barato | Lote; não chat |
| Cada mensagem 1:1 | Só se necessário | Debounce + regras primeiro; LLM com contexto curto |
| Grupo a cada mensagem | **Nunca** chat completo | Só extrair/indexar |
| Temporizador de grupo | Sim, barato | Resumo + importância 0–3 |
| Pergunta ao agente | Sim | Tools + evidência; **gates** (não inventar número/link) |
| Digest / alerta sócios | Sim, redator | Números vêm de SQL |

## 10. Modelo mental de dados (mínimo)

- `workspace` (tenant)
- `channel` (tipo, instância Evolution, escopo, saúde)
- `person` / `contact`
- `message` (bruto, idempotente)
- `conversation` (1:1) · `group` (opt-in, acompanhar, intervalo)
- `item_extracted` (link, arquivo, contato, endereço → origem)
- `commitment` (horário, estado, escopo pessoal|empresa)
- `task` (status, responsável, escopo; **sem** projeto obrigatório)
- `demand` (setor, urgência, responsável) — modo escritório
- `summary` / `alert` (dedupe, importância)
- `agent_recipient` + whitelist
- `job` (fila Postgres)

Isolamento: `workspace_id` em tudo; RLS como no Demanda.

## 11. MVP (primeiro valor mensurável)

### Dentro

1. Modelo de canais + modos (Pessoal / Escritório / ambos), com 1 modo completo funcionando de ponta a ponta.
2. Escuta 1:1 → **criar e atualizar** compromisso e tarefa (não só classificar).
3. Agente com whitelist: consultar Hoje, remarcar, concluir.
4. Painel Hoje + lista agenda/tarefas (base Prumo enxuta).
5. Grupos **opt-in**: gravar + extrair + 1 busca “onde está X?” com origem (sem MCP).
6. Política de token medida desde o dia 1.

### Fora do MVP (fase 2+)

- Segundo modo no mesmo workspace (se o MVP foi só um).
- Kanban rico por setor + papéis completos Demanda.
- Alertas periódicos de grupo + digest escritório.
- Áudio/imagem/PDF pesados.
- Fontes MCP.
- Billing, app mobile, resposta a cliente.

### Ordem de entrega sugerida

1. **Contrato do motor** (canais, escopos, entidades, jobs) num repo **único** — não três PRs espalhados.
2. Modo Pessoal 1:1 operando (leitura + atualização + agente) — prova que não somos o Demanda travado.
3. Módulo Grupo (extrair + buscar) — prova o ponto cego.
4. Modo Escritório (demanda/setor) em cima do mesmo motor — prova o pack B2B.
5. Pack Completo + painel unificado.

## 12. O que fazer com os três repos

| Repo | Destino |
|---|---|
| **Prumo** | Doador principal de UI + padrões de operação; não continua como produto paralelo após migração |
| **Demanda** | Doador de multi-tenant/RLS/setores; código de “só classificar” não dita o loop |
| **Poli 2** | Doador do módulo Grupo (extrair, gates, janelas, ler_grupo); não vira o core do produto |

**Regra anti-morto:** até o MVP do unificado provar o loop da seção 8, **não** abrir feature nova nos três. Só correção crítica / piloto já vendido.

Repo novo: **um**, com este brief na raiz (`PRODUTO.md`). Nome do produto e do repositório vêm depois da aprovação deste desenho.

## 13. Métricas de que está vivo

| Sinal | Meta inicial |
|---|---|
| Compromisso criado **ou atualizado** a partir de conversa, sem retrabalho total | ≥ 70% dos detectados |
| Remarcação / conclusão via agente ou painel funciona de ponta a ponta | 100% dos fluxos do MVP |
| Token médio por mensagem 1:1 processada | tendência de queda vs Prumo atual |
| Busca em grupo com origem correta (amostra fixa) | ≥ 90% |
| Modo desligado não exige canal nem cobra job | zero job órfão |

## 14. Decisões abertas (bloquear implementação se não responder)

1. **Nome do produto** e se a marca comercial é uma ou duas (Pessoal / Escritório).
2. Qual modo entra **primeiro** no código (recomendação: Pessoal operando, depois Escritório).
3. Stack canônica do repo único: **TypeScript (linha Prumo/Poli)** ou **Python (linha Demanda)** — escolher uma; não híbrido no core.
4. Grupos no MVP: só no modo Pessoal, ou também escuta de grupos operacionais do escritório?
5. Piloto: você (usuário-zero) e/ou contabilidade — quem valida o loop primeiro?

## 15. Go / No-go

**Go** se concordarmos que:

- um motor + modos plugáveis;
- operar > classificar;
- grupos = módulo Poli enxuto;
- um repo novo só depois deste brief aprovado;
- anti-objetivos da seção 3 são lei.

**No-go** (geraríamos o 4º morto) se:

- tentarmos “juntar UIs” sem loop de atualização;
- mantivermos três produtos vivos com o unificado pela metade;
- ligarmos LLM em massa em grupo “para ver o que acontece”.

---

*Próximo passo após aprovação: ADR de stack + esqueleto do repo único (`channel` / `inbox` / `items` / `agent`) sem features de painel ainda.*
