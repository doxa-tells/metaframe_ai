"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/base";

// Новый пароль по ссылке из письма (страница открыта без входа, токен — в адресе)
export default function ResetPage() {
  const [token, setToken] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setToken(new URLSearchParams(window.location.search).get("t") ?? ""); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1 !== p2) { setError("Пароли не совпадают"); return; }
    setBusy(true);
    setError(null);
    const res = await fetch(withBase("/api/auth/reset"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: p1 }) }).catch(() => null);
    if (res?.ok) { window.location.href = withBase("/image"); return; }
    const d = (res ? await res.json().catch(() => ({})) : {}) as { error?: string };
    setError(d.error ?? "Нет связи с сервером");
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <div className="logo big"><img src={withBase("/assets/logo-bright.webp")} alt="" /></div>
        <h1>Новый пароль</h1>
        <p className="muted small">После сохранения вы войдёте в студию, а на других устройствах нужно будет войти заново.</p>
        <input type="password" autoComplete="new-password" autoFocus placeholder="Новый пароль, от 8 символов" value={p1} onChange={(e) => setP1(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Пароль ещё раз" value={p2} onChange={(e) => setP2(e.target.value)} />
        {error && <div className="err small">{error}</div>}
        <button className="btn accent wide" disabled={busy || p1.length < 8 || !p2}>{busy ? "Сохраняю…" : "Сохранить и войти"}</button>
        <a className="linkbtn login-switch" href={withBase("/login")}>Вернуться ко входу</a>
      </form>
    </div>
  );
}
