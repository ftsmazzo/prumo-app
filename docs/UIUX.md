# UI/UX Design — Prumo

> Direção visual e de experiência.
> Fonte: [x] Brief unificado  [x] Painel Prumo como doador  [x] Decisão: evitar carregar Milestone
> Depende de: [Fluxo do App](FLUXO-APP.md)

**Data**: 2026-10-28

## 1. Referências e tom

- **Referência principal:** painel do Prumo atual (Hoje, agenda, tarefas, contatos) — densidade útil, não dashboard genérico.
- **Não referência:** paridade Milestone (Gantt, capas, Negócios, multi-visão ornamental).
- **Tom:** sério, calmo, operacional — “chefe de gabinete”. Pouca decoração; hierarquia clara do dia.
- **Concorrentes de senso:** apps de agenda + inbox (não Slack corporativo genérico).

## 2. Plataformas-alvo

- [x] Web responsivo (MVP)
- [ ] PWA (depois, se o uso mobile do painel pedir)
- [ ] Mobile nativo
- [ ] Desktop

Agente e alertas vivem no **WhatsApp**; o painel é para conferir, corrigir e configurar.

## 3. Sistema visual

- **Paleta:** fundo neutro quente ou frio estável (não roxo-IA, não cream+terracotta clichê); um accent só para ação primária e estados (atrasado / crítico).
- **Tipografia:** uma família display contida + uma de UI legível (evitar Inter/Roboto default se o Prumo já tiver face própria — reaproveitar se portar CSS; senão Source Serif + grotesk técnica).
- **Componentes centrais:**
  - **Hoje** (lista do dia: compromissos + tarefas + follow-ups)
  - Agenda (dia/semana simples)
  - Lista de tarefas (status + prazo; sem Gantt)
  - Contatos / pessoas
  - Grupos (toggle acompanhar + intervalo)
  - Canais / Diagnóstico (saúde Evolution)
  - Drawer de item (compromisso/tarefa) com origem da conversa
  - (Fase 2) Kanban de demandas por setor

**Cards:** só onde há interação (item clicável, canal). Evitar card-decoration no hero/Hoje.

## 4. Acessibilidade

- Alvo: WCAG 2.2 AA nas telas principais (contraste, foco, labels).
- Sem requisito legal setorial no MVP; tipografia e alvos de toque usáveis em notebook e celular.
- Alertas de canal caído: texto + cor, não só cor.

## 5. Telas principais

| Tela | Jornada | MVP? | Estado |
|---|---|---|---|
| Login / sessão | acesso | Sim | a implementar |
| Onboarding de canais | J1 | Sim | a implementar |
| Hoje | J2, J3 | Sim | doador Prumo |
| Agenda | J2 | Sim | doador Prumo |
| Tarefas | J2 | Sim | doador Prumo (sem projeto obrigatório) |
| Contatos | J2 | Sim | doador Prumo enxuto |
| Grupos | J4 | Sim | doador Poli (lista + acompanhar) |
| Busca | J4 | Sim | simples + origem |
| Canais / Diagnóstico | J1 | Sim | novo |
| Configurações / whitelist | J1, J3 | Sim | novo |
| Quadro (Kanban) | J5 | Fase 2 | doador Demanda |
| Setores / papéis | J5 | Fase 2 | doador Demanda |
| Painel executivo | J5 | Fase 2 | Demanda |

## 6. Princípios de UX do produto

1. **Hoje é a home** do modo Pessoal — não um dashboard de 12 widgets.
2. Toda entidade operacional mostra **origem** (conversa / grupo / manual).
3. Ação primária em item: remarcar, concluir, confirmar — não “abrir 5 abas”.
4. Configuração de canal é chata mas crítica: progresso linear, um QR por vez, estado de saúde visível.
5. Modo Escritório (fase 2) reusa a mesma casca; só acrescenta seções — não é outro app visual.
