# PRD — Prumo

> Product Requirements Document — o quê e por quê, não como.
> Fonte: [x] Entrevista com usuário  [x] Leitura de código existente (Prumo, Demanda, Poli 2)
> **Versão 1.0** — produto unificado. Substitui a linha de três produtos paralelos.

**Data**: 2026-10-28
**Responsável**: Fábrica dos Dados
**Brief de origem**: [`../PRODUTO.md`](../PRODUTO.md)

## 1. Resumo em uma frase

Motor que lê WhatsApp (1:1 + grupos opt-in), cria e atualiza compromisso/tarefa/demanda, e fala só com quem manda — modo Pessoal, Escritório, ou os dois.

## 2. Problema e contexto

- **Problema real:** combinados e pedidos nascem no WhatsApp (privado e grupos) e se perdem. No pessoal, o chefe não fecha o dia. No escritório, sócios não veem o que está parado por setor. Quem tenta resolver com três ferramentas separadas (Prumo / Demanda / Poli) herda lacunas cruzadas: um lê bem e gasta token; outro classifica e não opera; o terceiro só cobre grupos de campanha.
- **Como é resolvido hoje:** Prumo (1:1 pessoal, caro), Demanda (escritório, classifica sem remarcar), Poli 2 (grupos de campanha), mais rolagem manual do histórico.
- **Por que agora:** os três já provaram pedaços do motor (Evolution, extração, tenant, painel). Unificar evita um quarto produto morto e atende a mesma pessoa que precisa dos dois universos (chefe + escritório).

## 3. Público-alvo

- **Persona principal:** profissional/empreendedor ou sócio que vive no WhatsApp e precisa que o sistema **opere** (criar, atualizar, lembrar), não só arquivar.
- **Pack Pessoal:** o próprio chefe (usuário-zero / autônomo).
- **Pack Escritório:** sócios, gestores de setor, colaboradores (3 papéis fixos no MVP do modo).
- **Não é usuário:** cliente, fornecedor, membro de grupo — só são ouvidos.

## 4. Objetivos e métricas de sucesso

| Objetivo | Métrica | Meta |
|---|---|---|
| Nada combinado morre na conversa | % de compromissos/tarefas criados **ou atualizados** a partir de 1:1 sem retrabalho total | ≥ 70% |
| Sistema opera, não só classifica | Remarcar / concluir / mudar responsável funciona ponta a ponta (agente ou painel) | 100% dos fluxos do MVP |
| Custo de IA sob controle | Tokens médios por mensagem 1:1 processada vs Prumo legado | tendência de queda mensurável |
| Grupos úteis sem ruído | Busca com origem correta (amostra fixa de 30 perguntas) | ≥ 90% |
| Packs plugáveis | Modo desligado não cria job nem exige canal | zero job órfão |

## 5. Escopo

### Dentro do escopo (MVP)

- Um motor, um tenant (`tenant_id`), modos **Pessoal** e/ou **Escritório** (canais plugáveis).
- Escuta 1:1 → criar **e atualizar** compromisso e tarefa (estado canônico no SQL).
- Agente com whitelist: consultar “Hoje”, remarcar, concluir (número de agente ≠ número de escuta).
- Painel web: Hoje, agenda, tarefas, contatos (base visual do Prumo enxuta).
- Grupos **opt-in** (modo Pessoal): gravar, extrair (link/contato/endereço/arquivo), busca com origem; sem LLM por mensagem.
- Política de token: regras/extratores primeiro; LLM com contexto mínimo; números de resumo via SQL.
- Entrega do MVP **começa pelo modo Pessoal** completo; Escritório entra na fase seguinte no mesmo repo.

### Fora do escopo (por enquanto)

- CRM/ERP completo (Gantt, pipeline Negócios, Form Filler, billing de tenant).
- Responder cliente final; escrever em grupo sem menção + autorização.
- LLM em toda mensagem de grupo; Fontes MCP / urna / RAG de campanha.
- App mobile nativo; OAuth Google Agenda (feed ICS depois).
- Quatro números obrigatórios no onboarding.
- Manter Prumo / Demanda / Poli como produtos ativos com feature nova após o unificado existir.

## 6. Funcionalidades principais

| Funcionalidade | Prioridade | Descrição curta |
|---|---|---|
| Canais listen / agent | MVP | Slots plugáveis; escopo pelo canal |
| Ingestão idempotente | MVP | Webhook Evolution; grava bruto primeiro |
| Operar compromisso/tarefa | MVP | Criar e atualizar (não só classificar) |
| Agente whitelist | MVP | Comando e digest só a autorizados |
| Painel Hoje | MVP | Agenda + tarefas do dia |
| Extratores de grupo | MVP | Link, telefone, endereço, contato, arquivo |
| Busca com origem | MVP | Resposta cita grupo/autor/data |
| Gates anti-alucinação | MVP | Link/fone/número só se estiver na evidência |
| Modo Escritório (demanda/setor/papéis) | Fase 2 | Mesmo motor; Kanban e agente dos sócios |
| Leitura periódica de grupo + alertas | Fase 2 | Resumo, importância, dedupe, teto/dia |
| Digest escritório | Fase 2 | Resumo/alerta aos sócios |
| Áudio/imagem/PDF pesados | Fase 2 | Transcrição e extração |
| ICS / calendário externo | Depois | Sem OAuth no início |
| MCP / fontes externas | Depois | Fora do núcleo |

## 7. Restrições de negócio

- **Prazo:** sem data externa rígida; entregas curtas, piloto cedo (usuário-zero no Pessoal).
- **Orçamento:** custo de LLM é restrição de produto (medir desde o dia 1).
- **LGPD:** guarda conversas e dados de terceiros. MVP: isolamento por tenant, papéis, auditoria leve, retenção configurável (padrão: manter), minimização do que vai à IA. Exportação/exclusão automatizada depois.

## 8. Riscos e premissas

- **Premissa:** Evolution continua viável para escuta e envio em números separados. Se falhar → risco de ban; mitigar com número dedicado e monitoramento.
- **Premissa:** o usuário aceita um repo novo e congela feature nova nos três legados até o loop do MVP provar valor.
- **Risco (alto):** falso positivo de compromisso → política “confirmar na dúvida”.
- **Risco (alto):** virar Frankenstein (três UIs coladas) → anti-objetivos do brief são lei.
- **Risco (médio):** token explode de novo → extratores + debounce + contexto mínimo + métrica.
- **Risco (médio):** grupos sem opt-in viram lixo e LGPD → default off; acompanhar só o marcado.

---

## Decisões travadas neste PRD

1. Nome de trabalho do produto: **Prumo** (packs Pessoal / Escritório / Completo).
2. Um motor; modos plugáveis; canal define escopo.
3. Operar > classificar.
4. MVP valida primeiro o modo **Pessoal** (+ módulo grupo enxuto).
5. Os três repos legados são **doadores**, não produtos paralelos após o unificado.
