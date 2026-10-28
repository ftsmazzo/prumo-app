import { useState, type FormEvent } from "react";
import { AuthFrame } from "../components/AuthFrame";
import { Field, FieldInput } from "../components/Field";
import { client, type User } from "../lib/api";

export function Login({ onOk }: { onOk: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await client.login(email, password);
      onOk(user);
    } catch {
      setError("Não entrou. Confira e-mail e senha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Entrar"
      hint="A sessão fica no servidor. Este aparelho não guarda a senha."
    >
      <form onSubmit={onSubmit} className="form">
        <Field label="E-mail">
          <FieldInput
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Senha">
          <FieldInput
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </AuthFrame>
  );
}
