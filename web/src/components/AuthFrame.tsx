import type { ReactNode } from "react";
import { Mark } from "./Mark";

/** Casca da porta de autenticação — portada de prumo/src/pages/auth/AuthFrame.tsx. */
export function AuthFrame({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
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
        <h1>{title}</h1>
        <p className="door-hint">{hint}</p>
        {children}
      </main>
      <footer className="door-foot">A operação no eixo.</footer>
    </div>
  );
}
