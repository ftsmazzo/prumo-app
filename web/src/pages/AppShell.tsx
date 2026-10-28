import type { ReactNode } from "react";
import { Mark } from "../components/Mark";
import type { User } from "../lib/api";

export type Tab = "hoje" | "agenda" | "tarefas";

const NAV: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "hoje", label: "Hoje", icon: <IconGrid /> },
  { id: "agenda", label: "Agenda", icon: <IconAgenda /> },
  { id: "tarefas", label: "Tarefas", icon: <IconTasks /> },
];

function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function IconAgenda() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.2"
        y="3.2"
        width="11.6"
        height="10.2"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path d="M2.2 6.4h11.6" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M5.2 2.2v2.2M10.8 2.2v2.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 4.2h9.6M3.2 8h9.6M3.2 11.8h6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Casca do painel — sidebar + topo, portada e simplificada de prumo/src/pages/app/AppShell.tsx. */
export function AppShell({
  tab,
  onTabChange,
  title,
  subtitle,
  user,
  onLogout,
  children,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  title: string;
  subtitle?: string;
  user: User;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="org-block">
          <div className="org-trigger" style={{ cursor: "default" }}>
            <span className="org-mark">
              <Mark size={16} />
            </span>
            <span className="org-copy">
              <strong>Prumo</strong>
              <span>Pessoal</span>
            </span>
          </div>
        </div>

        <nav className="side-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "active" : undefined}
              onClick={() => onTabChange(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="muted">{user.email}</p>
        </div>
      </aside>

      <div className="stage">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="btn-quiet" onClick={onLogout}>
            Sair
          </button>
        </header>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
