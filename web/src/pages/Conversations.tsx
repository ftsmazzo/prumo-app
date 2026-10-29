import { useEffect, useState } from "react";
import {
  client,
  type ConversationDetail,
  type ConversationListItem,
} from "../lib/api";

export function Conversations() {
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState("");

  async function reload() {
    try {
      const res = await client.conversations();
      setItems(res.items);
      setError(null);
    } catch {
      setError("Falha ao carregar conversas.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function open(id: string) {
    try {
      const d = await client.conversation(id);
      setDetail(d);
      setRename(String(d.conversation.person_name || d.conversation.title || ""));
      setError(null);
    } catch {
      setError("Não abriu a conversa.");
    }
  }

  async function saveName() {
    if (!detail || !rename.trim()) return;
    await client.patchConversation(String(detail.conversation.id), {
      personName: rename.trim(),
    });
    await open(String(detail.conversation.id));
    await reload();
  }

  if (error && !items) return <p className="form-error">{error}</p>;
  if (!items) return <p className="boot">Carregando conversas…</p>;

  return (
    <div className="ms-page conv-layout">
      {error ? <p className="form-error">{error}</p> : null}

      <section className="ms-dash-panel">
        <header>
          <h3>Conversas</h3>
          <p className="muted">Fio + fichamento — origem do que aparece em Hoje</p>
        </header>
        {items.length === 0 ? (
          <p className="muted panel-empty">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="ms-dash-list">
            {items.map((c) => (
              <li key={String(c.id)}>
                <div>
                  <strong>{String(c.person_name || c.title || c.peer_phone)}</strong>
                  <span>
                    {new Date(String(c.last_message_at)).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {Number(c.message_count) || 0} msgs
                  </span>
                  {c.briefPreview ? <span className="muted">{String(c.briefPreview)}</span> : null}
                </div>
                <button type="button" className="btn-quiet btn-sm" onClick={() => void open(String(c.id))}>
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail ? (
        <section className="ms-dash-panel">
          <header>
            <h3>{String(detail.conversation.person_name || detail.conversation.title)}</h3>
            <p className="muted">{String(detail.conversation.peer_phone)}</p>
          </header>

          <label className="field">
            <span>Nome do contato</span>
            <div className="row-actions">
              <input value={rename} onChange={(e) => setRename(e.target.value)} />
              <button type="button" className="btn-quiet btn-sm" onClick={() => void saveName()}>
                Salvar
              </button>
            </div>
          </label>

          {detail.conversation.person_note ? (
            <p className="muted">Nota: {String(detail.conversation.person_note)}</p>
          ) : null}

          <h4>Fichamento</h4>
          <pre className="brief-box">
            {detail.brief?.summary ? String(detail.brief.summary) : "(sem fichamento ainda)"}
          </pre>

          {(detail.commitments.length > 0 || detail.tasks.length > 0) && (
            <>
              <h4>Itens desta conversa</h4>
              <ul className="ms-dash-list">
                {detail.commitments.map((c) => (
                  <li key={String(c.id)}>
                    <div>
                      <strong>{String(c.title)}</strong>
                      <span>
                        compromisso
                        {c.needs_confirm ? " · confirmar" : ""}
                      </span>
                    </div>
                  </li>
                ))}
                {detail.tasks.map((t) => (
                  <li key={String(t.id)}>
                    <div>
                      <strong>{String(t.title)}</strong>
                      <span>
                        tarefa
                        {t.needs_confirm ? " · confirmar" : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4>Mensagens</h4>
          <ul className="thread-list">
            {detail.messages.map((m) => (
              <li key={String(m.id)} className={String(m.direction) === "out" ? "mine" : "theirs"}>
                <span className="who">{String(m.direction) === "out" ? "eu" : String(m.push_name || "contato")}</span>
                <span className="body">{String(m.text || `(${m.message_type})`)}</span>
              </li>
            ))}
          </ul>

          <button type="button" className="btn-quiet" onClick={() => setDetail(null)}>
            Fechar
          </button>
        </section>
      ) : null}
    </div>
  );
}
