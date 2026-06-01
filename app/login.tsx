"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError("Не получилось войти. Проверь почту и пароль.");
  };

  return (
    <div className="center">
      <form className="setup" onSubmit={submit} noValidate>
        <h2>Копилка</h2>
        <p className="sub" style={{ marginBottom: 16 }}>Вход для родителей</p>
        <input
          className="field"
          type="email"
          autoComplete="username"
          required
          placeholder="Почта"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", marginBottom: 12 }}
        />
        {error && <p className="sub" style={{ color: "#b3261e", marginBottom: 12 }}>{error}</p>}
        <button className="savebtn" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
