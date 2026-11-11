"use client";
import { useState } from "react";
import { withBase } from "@/lib/base";

type Mode = "login" | "register";
const EMPTY = { name: "", email: "", phone: "", country: "", purpose: "", password: "", password2: "" };

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [f, setF] = useState(EMPTY);
  const [terms, setTerms] = useState(false);
  const [likeness, setLikeness] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const goIn = () => {
    window.location.href = /\/login\/?$/.test(window.location.pathname) ? withBase("/image") : window.location.pathname + window.location.search;
  };

  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(withBase(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res?.ok) { goIn(); return; }
    const d = res ? await res.json().catch(() => ({})) : {};
    setError((d as { error?: string }).error ?? "Нет связи с сервером");
    setBusy(false);
  }

  function login(e: React.FormEvent) {
    e.preventDefault();
    send("/api/login", { email: email.trim(), password });
  }

  function register(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) { setError("Пароли не совпадают"); return; }
    send("/api/register", { ...f, terms, likeness });
  }

  const switchTo = (m: Mode) => { setMode(m); setError(null); };

  return (
    <div className="login">
      {mode === "login" ? (
        <form className="login-box" onSubmit={login}>
          <div className="logo big"><img src={withBase("/assets/logo-bright.webp")} alt="" /></div>
          <h1>MetaFrame AI</h1>
          <p className="muted small">Nano Banana · Soul · Seedance · Kling</p>
          <input type="email" autoComplete="email" autoFocus placeholder="Почта" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="err small">{error}</div>}
          <button className="btn accent wide" disabled={busy || !password}>{busy ? "Вхожу…" : "Войти"}</button>
          <button type="button" className="linkbtn login-switch" onClick={() => switchTo("register")}>Нет аккаунта? Зарегистрироваться</button>
        </form>
      ) : (
        <form className="login-box reg-box" onSubmit={register}>
          <h1>Регистрация</h1>
          <p className="muted small">Мы подтверждаем личность каждого пользователя. Указывайте настоящие данные — с вами свяжутся для проверки.</p>
          <input type="text" autoComplete="name" placeholder="Фамилия и имя, как в документе" value={f.name} onChange={set("name")} />
          <input type="email" autoComplete="email" placeholder="Почта" value={f.email} onChange={set("email")} />
          <input type="tel" autoComplete="tel" placeholder="Телефон с кодом страны" value={f.phone} onChange={set("phone")} />
          <input type="text" autoComplete="country-name" placeholder="Страна" value={f.country} onChange={set("country")} />
          <textarea rows={2} placeholder="Для чего вам студия (необязательно)" value={f.purpose} onChange={set("purpose")} />
          <input type="password" autoComplete="new-password" placeholder="Пароль, от 8 символов" value={f.password} onChange={set("password")} />
          <input type="password" autoComplete="new-password" placeholder="Пароль ещё раз" value={f.password2} onChange={set("password2")} />
          <label className="reg-check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>Принимаю <a href={withBase("/terms")} target="_blank" rel="noreferrer">правила студии</a> и согласен на обработку моих данных для проверки личности и разбора нарушений</span>
          </label>
          <label className="reg-check">
            <input type="checkbox" checked={likeness} onChange={(e) => setLikeness(e.target.checked)} />
            <span>Загружаю фото и видео людей только с их согласия и не создаю незаконный, сексуальный или вводящий в заблуждение контент с реальными людьми</span>
          </label>
          {error && <div className="err small">{error}</div>}
          <button className="btn accent wide" disabled={busy || !terms || !likeness || !f.name || !f.email || !f.phone || !f.country || !f.password}>
            {busy ? "Отправляю…" : "Отправить заявку"}
          </button>
          <button type="button" className="linkbtn login-switch" onClick={() => switchTo("login")}>Уже есть аккаунт? Войти</button>
        </form>
      )}
    </div>
  );
}
