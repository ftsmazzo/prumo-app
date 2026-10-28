import { useEffect, useState } from "react";
import { client, type User } from "./lib/api";
import { Agenda } from "./pages/Agenda";
import { AppShell, type Tab } from "./pages/AppShell";
import { Login } from "./pages/Login";
import { Tasks } from "./pages/Tasks";
import { Today } from "./pages/Today";

const TITLES: Record<Tab, { title: string; subtitle: string }> = {
  hoje: {
    title: "Hoje",
    subtitle: "Confirmar, remarcar e concluir o que a escuta organizou.",
  },
  agenda: { title: "Agenda", subtitle: "Próximos 14 dias." },
  tarefas: { title: "Tarefas", subtitle: "Abertas e concluídas recentes." },
};

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

  const meta = TITLES[tab];

  return (
    <AppShell
      user={user}
      tab={tab}
      onTabChange={setTab}
      title={meta.title}
      subtitle={meta.subtitle}
      onLogout={() => {
        void client.logout().then(() => setUser(null));
      }}
    >
      {tab === "hoje" && <Today />}
      {tab === "agenda" && <Agenda />}
      {tab === "tarefas" && <Tasks />}
    </AppShell>
  );
}
