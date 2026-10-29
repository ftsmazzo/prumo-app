import { useEffect, useState } from "react";
import { client, type TodayItem } from "../lib/api";
import { fmtDay } from "../lib/format";

export function Tasks() {
  const [items, setItems] = useState<TodayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await client.tasks();
      setItems(r.items);
      setError(null);
    } catch {
      setError("Falha ao carregar as tarefas.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (!items) return <p className="boot">Carregando as tarefas…</p>;

  return (
    <div className="ms-page">
      <section className="ms-dash-panel">
        <header>
          <h3>Tarefas</h3>
        </header>
        {items.length === 0 ? (
          <p className="muted panel-empty">Nenhuma tarefa.</p>
        ) : (
          <ul className="ms-dash-list">
            {items.map((t) => (
              <li key={String(t.id)}>
                <div>
                  <strong>{String(t.title)}</strong>
                  <span>
                    {String(t.status)} · {fmtDay(t.due_on)}
                    {t.person_name ? ` · ${String(t.person_name)}` : ""}
                    {Boolean(t.needs_confirm) && <span className="tag tag-due"> confirmar</span>}
                  </span>
                </div>
                {String(t.status) !== "done" ? (
                  <button
                    type="button"
                    className="btn-quiet btn-sm"
                    onClick={() => void completeTask(t, reload)}
                  >
                    Concluir
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function completeTask(t: TodayItem, reload: () => void) {
  await client.patchTask(String(t.id), { status: "done" });
  reload();
}
