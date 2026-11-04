"use client";
import { useState } from "react";
import { withBase } from "@/lib/base";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(withBase("/api/login"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.href = /\/login\/?$/.test(window.location.pathname) ? withBase("/image") : window.location.pathname + window.location.search;
      return;
    }
    const d = await res.json().catch(() => ({}));
    setError(d.error ?? "Ошибка входа");
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <div className="logo big"><img src={withBase("/assets/logo-chrome.webp")} alt="" /></div>
        <h1>MetaFrame AI</h1>
        <p className="muted small">Nano Banana · Soul · Seedance · Kling</p>
        <input type="password" autoFocus placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="err small">{error}</div>}
        <button className="btn accent wide" disabled={busy || !password}>{busy ? "Вхожу…" : "Войти"}</button>
      </form>
    </div>
  );
}
