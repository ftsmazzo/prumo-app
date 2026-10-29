import { useEffect, useState } from "react";
import {
  client,
  type ConversationDetail,
  type ConversationListItem,
} from "../lib/api";

export function Conversations() {
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [query, setQuery] = useState("");
  const [rename, setRename] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [refichando, setRefichando] = useState(false);

  async function reloadList(q?: string) {
    try {
      const res = await client.conversations(q);
      setItems(res.items);
      setError(null);
      return res.items;
    } catch {
      setError("Falha ao carregar conversas.");
      return null;
    }
  }

  useEffect(() => {
    void reloadList();
  }, []);

  async function open(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    setError(null);
    try {
      const d = await client.conversation(id);
      setDetail(d);
      setRename(String(d.conversation.person_name || d.conversation.title || ""));
      setTagsText(((d.conversation.tags as string[]) || []).join(", "));
      setNote(String(d.conversation.person_note || ""));
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : "Não abriu a conversa.");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function saveMeta() {
    if (!detail) return;
    setSaving(true);
    try {
      await client.patchConversation(String(detail.conversation.id), {
        personName: rename.trim() || undefined,
        tags: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        note: note,
      });
      await open(String(detail.conversation.id));
      await reloadList(query || undefined);
    } catch {
      setError("Não salvou a ficha da conversa.");
    } finally {
      setSaving(false);
    }
  }

  async function reficharEsta() {
    if (!detail) return;
    setRefichando(true);
    try {
      await client.refichar(String(detail.conversation.id));
      await open(String(detail.conversation.id));
      await reloadList(query || undefined);
    } catch {
      setError("Falha ao refichar com a IA.");
    } finally {
      setRefichando(false);
    }
  }

  if (!items) return <p className="boot">Carregando conversas…</p>;

  return (
    <div className="inbox-split">
      <aside className="inbox-list">
        <div className="inbox-list-head">
          <input
            className="inbox-search"
            placeholder="Buscar nome, tag ou texto…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void reloadList(query || undefined);
            }}
          />
          <button type="button" className="btn-quiet btn-sm" onClick={() => void reloadList(query || undefined)}>
            Buscar
          </button>
        </div>
        {items.length === 0 ? (
          <p className="muted panel-empty">Nenhuma conversa.</p>
        ) : (
          <ul className="inbox-rows">
            {items.map((c) => {
              const id = String(c.id);
              const active = id === selectedId;
              const tags = (c.tags as string[]) || [];
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={active ? "inbox-row active" : "inbox-row"}
                    onClick={() => void open(id)}
                  >
                    <strong>{String(c.person_name || c.title || c.peer_phone)}</strong>
                    <span className="muted">
                      {new Date(String(c.last_message_at)).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {Number(c.message_count) || 0} msgs
                    </span>
                    {c.briefPreview || c.micro_summary ? (
                      <span className="row-preview">{String(c.micro_summary || c.briefPreview)}</span>
                    ) : null}
                    {tags.length > 0 ? (
                      <span className="tag-row">
                        {tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="inbox-detail">
        {error ? <p className="form-error">{error}</p> : null}
        {!selectedId ? (
          <p className="muted panel-empty">Selecione uma conversa à esquerda.</p>
        ) : loadingDetail ? (
          <p className="boot">Abrindo fio…</p>
        ) : !detail ? (
          <p className="muted panel-empty">Sem detalhe.</p>
        ) : (
          <>
            <header className="inbox-detail-head">
              <div>
                <h3>{String(detail.conversation.person_name || detail.conversation.title)}</h3>
                <p className="muted">{String(detail.conversation.peer_phone)}</p>
              </div>
            </header>

            <div className="context-card">
              <header className="row-actions" style={{ justifyContent: "space-between" }}>
                <h4 style={{ margin: 0 }}>Micro-resumo</h4>
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  disabled={refichando}
                  onClick={() => void reficharEsta()}
                >
                  {refichando ? "Fichando…" : "Refichar com IA"}
                </button>
              </header>
              <p>
                {String(
                  detail.conversation.micro_summary ||
                    detail.brief?.micro_summary ||
                    "Ainda sem resumo — use Refichar com IA.",
                )}
              </p>
              {Array.isArray(detail.brief?.openItems) && detail.brief.openItems.length > 0 ? (
                <ul className="open-items">
                  {(
                    detail.brief.openItems as Array<{
                      kind: string;
                      label: string;
                      ownerAction?: boolean;
                    }>
                  ).map((it, i) => (
                    <li key={`${it.kind}-${i}`}>
                      <span className="tag">{it.kind}</span> {it.label}
                      {it.ownerAction === false ? (
                        <span className="muted"> · não é ação sua</span>
                      ) : it.ownerAction ? (
                        <span className="muted"> · ação sua</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Sem pendência operacional clara.</p>
              )}
            </div>

            <div className="context-card meta-form">
              <label className="field">
                <span>Nome</span>
                <input value={rename} onChange={(e) => setRename(e.target.value)} />
              </label>
              <label className="field">
                <span>Tags da conversa (vírgula)</span>
                <input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="agenda, comercial, urgente…"
                />
              </label>
              <label className="field">
                <span>Nota do contato</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </label>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveMeta()}>
                {saving ? "Salvando…" : "Salvar contexto"}
              </button>
            </div>

            {(detail.commitments.length > 0 || detail.tasks.length > 0) && (
              <div className="context-card">
                <h4>Itens ligados</h4>
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
              </div>
            )}

            <div className="context-card">
              <h4>Fichamento (compreensão)</h4>
              <pre className="brief-box">
                {detail.brief?.summary ? String(detail.brief.summary) : "(sem fichamento)"}
              </pre>
              {detail.brief?.summary &&
              String(detail.brief.summary).includes("[20") ? (
                <p className="muted">
                  Este texto ainda parece dump de mensagens — use Refichar no servidor ou aguarde
                  o worker com OpenRouter.
                </p>
              ) : null}
            </div>

            <div className="context-card">
              <h4>Histórico ({detail.messages.length})</h4>
              <ul className="thread-list dense">
                {detail.messages.map((m) => (
                  <li key={String(m.id)} className={String(m.direction) === "out" ? "mine" : "theirs"}>
                    <span className="who">
                      {String(m.direction) === "out" ? "eu" : String(m.push_name || "contato")}
                      {" · "}
                      {new Date(String(m.provider_timestamp)).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="body">{String(m.text || `(${m.message_type})`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
