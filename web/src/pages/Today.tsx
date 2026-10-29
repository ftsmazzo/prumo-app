import { useEffect, useState } from "react";
import { client, type TodayItem, type TodayResponse } from "../lib/api";
import { fmtDay, fmtWhen } from "../lib/format";

function whoLine(item: TodayItem): string {
  const name = item.person_name ? String(item.person_name) : "";
  return name ? ` · ${name}` : "";
}

export function Today() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function reload() {
    try {
      setData(await client.today());
      setError(null);
    } catch {
      setError("Falha ao carregar o dia.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function resetJunk() {
    setResetting(true);
    try {
      await client.resetPending();
      await reload();
    } catch {
      setError("Não deu para limpar propostas.");
    } finally {
      setResetting(false);
    }
  }

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="boot">Carregando o dia…</p>;

  return (
    <div className="ms-page">
      <section className="ms-dash-panel">
        <header>
          <h3>Confirmar</h3>
          {data.pendingConfirm.length > 0 ? (
            <button type="button" className="btn-quiet btn-sm" disabled={resetting} onClick={() => void resetJunk()}>
              {resetting ? "Limpando…" : "Descartar propostas e reavaliar"}
            </button>
          ) : null}
        </header>
        {data.pendingConfirm.length === 0 ? (
          <p className="muted panel-empty">Nada pendente.</p>
        ) : (
          <ul className="ms-dash-list">
            {data.pendingConfirm.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <div>
                  <strong>{String(item.title)}</strong>
                  <span>
                    {String(item.kind) === "commitment" ? "Compromisso" : "Tarefa"}
                    {whoLine(item)} · {fmtWhen(item.at)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => void confirmItem(item, reload)}
                >
                  Confirmar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ms-dash-panel">
        <header>
          <h3>Compromissos de hoje</h3>
        </header>
        {data.commitments.length === 0 ? (
          <p className="muted panel-empty">Nenhum horário hoje.</p>
        ) : (
          <ul className="ms-dash-list">
            {data.commitments.map((c) => (
              <li key={String(c.id)}>
                <div>
                  <strong>{String(c.title)}</strong>
                  <span>
                    {fmtWhen(c.starts_at)}
                    {whoLine(c)}
                  </span>
                </div>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => void postpone(c, reload)}
                >
                  +1 dia
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ms-dash-panel">
        <header>
          <h3>Tarefas</h3>
        </header>
        {data.tasks.length === 0 ? (
          <p className="muted panel-empty">Nenhuma tarefa aberta.</p>
        ) : (
          <ul className="ms-dash-list">
            {data.tasks.map((t) => (
              <li key={String(t.id)}>
                <div>
                  <strong>{String(t.title)}</strong>
                  <span>
                    {fmtDay(t.due_on)}
                    {whoLine(t)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => void completeTask(t, reload)}
                >
                  Concluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function confirmItem(item: TodayItem, reload: () => void) {
  const kind = String(item.kind);
  const id = String(item.id);
  await (kind === "commitment"
    ? client.patchCommitment(id, { needsConfirm: false, status: "confirmed" })
    : client.patchTask(id, { needsConfirm: false }));
  reload();
}

async function postpone(c: TodayItem, reload: () => void) {
  const id = String(c.id);
  const next = new Date(String(c.starts_at));
  next.setDate(next.getDate() + 1);
  await client.patchCommitment(id, { startsAt: next.toISOString(), needsConfirm: false });
  reload();
}

async function completeTask(t: TodayItem, reload: () => void) {
  await client.patchTask(String(t.id), { status: "done" });
  reload();
}
