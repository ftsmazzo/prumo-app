import { useEffect, useState, type FormEvent } from "react";
import { client, type User } from "./api";

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

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("hoje");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="app">
        <p className="muted">Carregando…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <Login
        onOk={setUser}
        error={error}
        setError={setError}
      />
    );
  }

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="mark">Prumo</p>
          <h1>Hoje</h1>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void client.logout().then(() => setUser(null));
          }}
        >
          Sair
        </button>
      </header>

      <nav className="tabs" aria-label="Seções">
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
            className={tab === id ? "tab on" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "hoje" && <TodayView />}
      {tab === "agenda" && <AgendaView />}
      {tab === "tarefas" && <TasksView />}
    </main>
  );
}

function Login(props: {
  onOk: (u: User) => void;
  error: string | null;
  setError: (s: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    props.setError(null);
    try {
      const u = await client.login(email, password);
      props.onOk(u);
    } catch {
      props.setError("Não entrou. Confira e-mail e senha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app narrow">
      <p className="mark">Prumo</p>
      <h1>Entrar</h1>
      <p className="lede">Painel do modo Pessoal — conferir e confirmar o que a escuta organizou.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {props.error && <p className="err">{props.error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

function TodayView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof client.today>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      setData(await client.today());
      setErr(null);
    } catch {
      setErr("Falha ao carregar o dia.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="muted">Carregando o dia…</p>;

  return (
    <div className="stack gap">
      <section>
        <h2>Confirmar</h2>
        {data.pendingConfirm.length === 0 ? (
          <p className="muted">Nada pendente.</p>
        ) : (
          <ul className="list">
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
                  onClick={() => {
                    const kind = String(item.kind);
                    const id = String(item.id);
                    void (kind === "commitment"
                      ? client.patchCommitment(id, { needsConfirm: false, status: "confirmed" })
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

      <section>
        <h2>Compromissos de hoje</h2>
        {data.commitments.length === 0 ? (
          <p className="muted">Nenhum horário hoje.</p>
        ) : (
          <ul className="list">
            {data.commitments.map((c) => (
              <li key={String(c.id)}>
                <div>
                  <strong>{String(c.title)}</strong>
                  <span className="muted"> · {fmtWhen(c.starts_at)}</span>
                  {Boolean(c.needs_confirm) && <span className="tag">confirmar</span>}
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const id = String(c.id);
                    const next = new Date(String(c.starts_at));
                    next.setDate(next.getDate() + 1);
                    void client
                      .patchCommitment(id, { startsAt: next.toISOString(), needsConfirm: false })
                      .then(reload);
                  }}
                >
                  +1 dia
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Tarefas</h2>
        {data.tasks.length === 0 ? (
          <p className="muted">Nenhuma tarefa aberta.</p>
        ) : (
          <ul className="list">
            {data.tasks.map((t) => (
              <li key={String(t.id)}>
                <div>
                  <strong>{String(t.title)}</strong>
                  <span className="muted"> · {fmtDay(t.due_on)}</span>
                </div>
                <button
                  type="button"
                  className="ghost"
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
  );
}

function AgendaView() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void client.commitments().then((r) => setItems(r.items));
  }, []);
  return (
    <section className="stack gap">
      <h2>Próximos 14 dias</h2>
      {items.length === 0 ? (
        <p className="muted">Agenda vazia neste período.</p>
      ) : (
        <ul className="list">
          {items.map((c) => (
            <li key={String(c.id)}>
              <div>
                <strong>{String(c.title)}</strong>
                <span className="muted"> · {fmtWhen(c.starts_at)}</span>
                {Boolean(c.needs_confirm) && <span className="tag">confirmar</span>}
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const id = String(c.id);
                  const next = new Date(String(c.starts_at));
                  next.setDate(next.getDate() + 1);
                  void client
                    .patchCommitment(id, { startsAt: next.toISOString() })
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
  );
}

function TasksView() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void client.tasks().then((r) => setItems(r.items));
  }, []);
  return (
    <section className="stack gap">
      <h2>Tarefas</h2>
      {items.length === 0 ? (
        <p className="muted">Nenhuma tarefa.</p>
      ) : (
        <ul className="list">
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
                  className="ghost"
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
  );
}
