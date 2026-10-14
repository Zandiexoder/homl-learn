import { useState } from "react";
import { Logo } from "../components/Icon";
import { api } from "../lib/api";

export function Login({ firstRun, onDone }: { firstRun: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (firstRun && password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api(firstRun ? "/auth/setup" : "/auth/login", { body: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="panel stack" style={{ padding: 28, gap: 18 }} onSubmit={submit}>
        <div className="row">
          <Logo />
          <span className="display" style={{ fontWeight: 700, fontSize: 22 }}>homl learn</span>
        </div>
        <div>
          <h1 className="display" style={{ fontSize: 26, fontWeight: 500 }}>{firstRun ? "Set a password" : "Welcome back"}</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {firstRun ? "This server is yours alone. Choose a password of at least 8 characters." : "Enter your password to open your notebooks."}
          </p>
        </div>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete={firstRun ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {firstRun && (
          <label className="field">
            Confirm password
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          {firstRun ? "Set password and continue" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
