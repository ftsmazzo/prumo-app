# Prumo (`prumo-app`)

Motor que lê WhatsApp (1:1 + grupos opt-in), cria e atualiza compromisso/tarefa/demanda, e fala só com quem manda — modo Pessoal, Escritório, ou os dois.

Repo **público** (EasyPanel não lê privado neste ambiente). Segredos só no painel / `.env` local. Ver `AGENTS.md`.

## Docs

| Doc | Caminho |
|---|---|
| Brief | [PRODUTO.md](./PRODUTO.md) |
| PRD → Plano | [docs/](./docs/) |
| Regras agentes | [AGENTS.md](./AGENTS.md) |

## Local

```bash
cp .env.example .env
npm ci
npm run db:up      # Postgres :5433, Redis :6380
npm run dev        # http://127.0.0.1:3000/health
npm run build && npm start
```

## Heranças

Prumo (operar + painel) · Demanda (tenant/RLS) · Poli 2 (grupos/extratores/gates).
