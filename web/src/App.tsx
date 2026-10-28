import { useEffect, useState, type FormEvent } from "react";
import { client, type User } from "./api";
import { Mark } from "./components/Mark";

type Tab = "hoje" | "agenda" | "tarefas";

function fmtWhen(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function fmtDay(value: unknown): string {
  if (!value) return "sem prazo";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("pt-BR");
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("hoje");

  useEffect(() => {
    client
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="boot">Abrindo o Prumo…</p>;
  }

  if (!user) {
    return <Login onOk={setUser} />;
  }

  const first = user.name?.split(/\s+/)[0] || "você";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="org-block">
          <div className="org-trigger" style={{ cursor: "default" }}>
            <span className="org-mark">
              <Mark size={16} />
            </span>
            <span className="org-copy">
              <strong>Prumo Pessoal</strong>
              <span>{user.role}</span>
            </span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Principal">
          {(
            [
              ["hoje", "Hoje"],
              ["agenda", "Agenda"],
              ["tarefas", "Tarefas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "nav-btn active" : "nav-btn"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="muted">{user.email}</p>
          <button
            type="button"
            className="btn-ghost"
            style={{ marginTop: "0.55rem", width: "100%" }}
            onClick={() => {
              void client.logout().then(() => setUser(null));
            }}
          >
            Sair
          </button>
        </div>
      </aside>

      <div className="stage">
        <header className="topbar">
          <div className="topbar-greet">
            <h1>
              {greeting()}, {first}
            </h1>
          </div>
        </header>
        <div className="stage-body">
          {tab === "hoje" && <TodayView />}
          {tab === "agenda" && <AgendaView />}
          {tab === "tarefas" && <TasksView />}
        </div>
      </div>
    </div>
  );
}

function Login({ onOk }: { onOk: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onOk(await client.login(email, password));
    } catch {
      setError("Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="door">
      <div className="plumb" aria-hidden="true">
        <span className="bob" />
      </div>
      <header className="door-brand">
        <Mark />
        <span>Prumo</span>
      </header>
      <main className="door-main">
        <h1>Entrar</h1>
        <p className="door-hint">A sessão fica no servidor. Este aparelho não guarda a senha.</p>
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">E-mail</span>
            <input
              className="field-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Senha</span>
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </main>
      <footer className="door-foot">A operação no eixo.</footer>
    </div>
  );
}

function TodayView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof client.today>> | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    try {
      setData(await client.today());
      setError("");
    } catch {
      setError("Falha ao carregar o dia.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted table-state">Abrindo o dia…</p>;

  return (
    <section className="ms-page">
      <header className="ms-page-head">
        <div>
          <h2 className="ms-page-title">Hoje</h2>
          <p className="ms-page-sub">Confirmar, remarcar e concluir o que a escuta organizou.</p>
        </div>
      </header>

      <div className="panel-stack">
        <section className="panel-block">
          <h3>Confirmar</h3>
          {data.pendingConfirm.length === 0 ? (
            <p className="muted panel-empty">Nada pendente.</p>
          ) : (
            <ul className="list-ops">
              {data.pendingConfirm.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <div>
                    <strong>{String(item.title)}</strong>
                    <span className="muted">
                      {" "}
                      · {String(item.kind)} · {fmtWhen(item.at)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const kind = String(item.kind);
                      const id = String(item.id);
                      void (kind === "commitment"
                        ? client.patchCommitment(id, {
                            needsConfirm: false,
                            status: "confirmed",
                          })
                        : client.patchTask(id, { needsConfirm: false })
                      ).then(reload);
                    }}
                  >
                    Confirmar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-block">
          <h3>Compromissos de hoje</h3>
          {data.commitments.length === 0 ? (
            <p className="muted panel-empty">Nenhum horário hoje.</p>
          ) : (
            <ul className="list-ops">
              {data.commitments.map((c) => (
                <li key={String(c.id)}>
                  <div>
                    <strong>{String(c.title)}</strong>
                    <span className="muted"> · {fmtWhen(c.starts_at)}</span>
                    {Boolean(c.needs_confirm) && <span className="tag">confirmar</span>}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const next = new Date(String(c.starts_at));
                      next.setDate(next.getDate() + 1);
                      void client
                        .patchCommitment(String(c.id), {
                          startsAt: next.toISOString(),
                          needsConfirm: false,
                        })
                        .then(reload);
                    }}
                  >
                    Remarcar +1 dia
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-block">
          <h3>Tarefas</h3>
          {data.tasks.length === 0 ? (
            <p className="muted panel-empty">Nenhuma tarefa aberta.</p>
          ) : (
            <ul className="list-ops">
              {data.tasks.map((t) => (
                <li key={String(t.id)}>
                  <div>
                    <strong>{String(t.title)}</strong>
                    <span className="muted"> · {fmtDay(t.due_on)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      void client.patchTask(String(t.id), { status: "done" }).then(reload);
                    }}
                  >
                    Concluir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function AgendaView() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void client.commitments().then((r) => setItems(r.items));
  }, []);

  return (
    <section className="ms-page">
      <header className="ms-page-head">
        <div>
          <h2 className="ms-page-title">Agenda</h2>
          <p className="ms-page-sub">Próximos 14 dias</p>
        </div>
      </header>
      <section className="panel-block">
        {items.length === 0 ? (
          <p className="muted panel-empty">Agenda vazia neste período.</p>
        ) : (
          <ul className="list-ops">
            {items.map((c) => (
              <li key={String(c.id)}>
                <div>
                  <strong>{String(c.title)}</strong>
                  <span className="muted"> · {fmtWhen(c.starts_at)}</span>
                  {Boolean(c.needs_confirm) && <span className="tag">confirmar</span>}
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    const next = new Date(String(c.starts_at));
                    next.setDate(next.getDate() + 1);
                    void client
                      .patchCommitment(String(c.id), { startsAt: next.toISOString() })
                      .then(() => client.commitments().then((r) => setItems(r.items)));
                  }}
                >
                  Remarcar +1 dia
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function TasksView() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void client.tasks().then((r) => setItems(r.items));
  }, []);

  return (
    <section className="ms-page">
      <header className="ms-page-head">
        <div>
          <h2 className="ms-page-title">Tarefas</h2>
          <p className="ms-page-sub">Abertas e concluídas recentes</p>
        </div>
      </header>
      <section className="panel-block">
        {items.length === 0 ? (
          <p className="muted panel-empty">Nenhuma tarefa.</p>
        ) : (
          <ul className="list-ops">
            {items.map((t) => (
              <li key={String(t.id)}>
                <div>
                  <strong>{String(t.title)}</strong>
                  <span className="muted">
                    {" "}
                    · {String(t.status)} · {fmtDay(t.due_on)}
                  </span>
                  {Boolean(t.needs_confirm) && <span className="tag">confirmar</span>}
                </div>
                {String(t.status) !== "done" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      void client
                        .patchTask(String(t.id), { status: "done" })
                        .then(() => client.tasks().then((r) => setItems(r.items)));
                    }}
                  >
                    Concluir
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
