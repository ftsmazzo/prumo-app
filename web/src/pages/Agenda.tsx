import { useEffect, useState } from "react";
import { client, type TodayItem } from "../lib/api";
import { fmtWhen } from "../lib/format";

export function Agenda() {
  const [items, setItems] = useState<TodayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await client.commitments();
      setItems(r.items);
      setError(null);
    } catch {
      setError("Falha ao carregar a agenda.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (!items) return <p className="boot">Carregando a agenda…</p>;

  return (
    <div className="ms-page">
      <section className="ms-dash-panel">
        <header>
          <h3>Próximos 14 dias</h3>
        </header>
        {items.length === 0 ? (
          <p className="muted panel-empty">Agenda vazia neste período.</p>
        ) : (
          <ul className="ms-dash-list">
            {items.map((c) => (
              <li key={String(c.id)}>
                <div>
                  <strong>{String(c.title)}</strong>
                  <span>
                    {fmtWhen(c.starts_at)}
                    {Boolean(c.needs_confirm) && <span className="tag tag-due"> confirmar</span>}
                  </span>
                </div>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => void postpone(c, reload)}
                >
                  Remarcar +1 dia
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function postpone(c: TodayItem, reload: () => void) {
  const id = String(c.id);
  const next = new Date(String(c.starts_at));
  next.setDate(next.getDate() + 1);
  await client.patchCommitment(id, { startsAt: next.toISOString() });
  reload();
}
