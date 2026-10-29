import { useEffect, useState } from "react";
import { client, type Person } from "../lib/api";

export function People() {
  const [items, setItems] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Person | null>(null);
  const [note, setNote] = useState("");
  const [relation, setRelation] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      const res = await client.people();
      setItems(res.items);
      setError(null);
    } catch {
      setError("Falha ao carregar contatos.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function open(p: Person) {
    setActive(p);
    setName(p.name || "");
    setNote(p.note || "");
    setRelation(p.relation || "");
    setTags((p.tags || []).join(", "));
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      await client.patchPerson(active.id, {
        name: name.trim() || undefined,
        note: note.trim(),
        relation: relation.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setActive(null);
      await reload();
    } catch {
      setError("Não deu para salvar o contato.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !items) return <p className="form-error">{error}</p>;
  if (!items) return <p className="boot">Carregando contatos…</p>;

  return (
    <div className="ms-page">
      {error ? <p className="form-error">{error}</p> : null}
      <section className="ms-dash-panel">
        <header>
          <h3>Contatos</h3>
          <p className="muted">{items.length} pessoas da escuta</p>
        </header>
        {items.length === 0 ? (
          <p className="muted panel-empty">Ainda sem contatos — entram quando o WhatsApp fala.</p>
        ) : (
          <ul className="ms-dash-list">
            {items.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name || p.phone}</strong>
                  <span>
                    {p.phone}
                    {p.relation ? ` · ${p.relation}` : ""}
                    {p.open_commitments || p.open_tasks
                      ? ` · ${p.open_commitments || 0} agenda / ${p.open_tasks || 0} tarefas`
                      : ""}
                  </span>
                  {p.note ? <span className="muted">{p.note}</span> : null}
                  {(p.tags || []).length > 0 ? (
                    <span className="tag-row">
                      {p.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
                <button type="button" className="btn-quiet btn-sm" onClick={() => open(p)}>
                  Editar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active ? (
        <section className="ms-dash-panel">
          <header>
            <h3>Ficha — {active.name || active.phone}</h3>
          </header>
          <label className="field">
            <span>Nome</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Relação</span>
            <input
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              placeholder="sócio, fornecedor, médico…"
            />
          </label>
          <label className="field">
            <span>Nota</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Blurb curto — o que ajuda a decidir depois"
            />
          </label>
          <label className="field">
            <span>Tags (vírgula)</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cliente, vip" />
          </label>
          <div className="row-actions">
            <button type="button" className="btn-quiet" onClick={() => setActive(null)}>
              Fechar
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
