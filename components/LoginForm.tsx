"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/base";
import { Captcha } from "./Captcha";

type Mode = "login" | "register" | "forgot";
type Props = { google: boolean; siteKey: string | null; mail: boolean; signup: { email: string; name: string } | null };
const EMPTY = { name: "", email: "", phone: "", country: "", purpose: "", password: "", password2: "" };

const NOTES: Record<string, { text: string; ok?: boolean }> = {
  google_off: { text: "Вход через Google пока не настроен — войдите по почте и паролю" },
  google_denied: { text: "Вход через Google отменён" },
  google_fail: { text: "Не удалось войти через Google — попробуйте ещё раз" },
  banned: { text: "Аккаунт заблокирован" },
  verify_bad: { text: "Ссылка подтверждения устарела — войдите и отправьте письмо ещё раз" },
  verified: { text: "Почта подтверждена — можно входить", ok: true },
};

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export function LoginForm({ google, siteKey, mail, signup }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [viaGoogle, setViaGoogle] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [f, setF] = useState(EMPTY);
  const [terms, setTerms] = useState(false);
  const [likeness, setLikeness] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Капча при входе нужна не сразу: сервер просит её после нескольких неудачных попыток
  const [loginCaptcha, setLoginCaptcha] = useState(false);
  const [token, setToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const code = q.get("err") ?? q.get("ok");
    if (code && NOTES[code]) setNote(NOTES[code]);
    // Вернулись от Google с новой почтой: осталось заполнить заявку
    if (q.get("google") === "new" && signup) {
      setMode("register");
      setViaGoogle(true);
      setF((x) => ({ ...x, email: signup.email, name: signup.name }));
    }
  }, [signup]);

  const goIn = () => {
    window.location.href = /\/(login|reset)\/?$/.test(window.location.pathname) ? withBase("/image") : window.location.pathname + window.location.search;
  };
  const resetCaptcha = () => { setToken(""); setCaptchaKey((k) => k + 1); };

  async function send(path: string, body: unknown): Promise<{ ok: boolean; captcha?: boolean }> {
    setBusy(true);
    setError(null);
    const res = await fetch(withBase(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res?.ok) return { ok: true };
    const d = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; captcha?: boolean };
    setError(d.error ?? "Нет связи с сервером");
    setBusy(false);
    resetCaptcha();
    return { ok: false, captcha: d.captcha };
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/login", { email: email.trim(), password, captcha: token || undefined });
    if (r.ok) goIn();
    else if (r.captcha && siteKey) setLoginCaptcha(true);
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!viaGoogle && f.password !== f.password2) { setError("Пароли не совпадают"); return; }
    const r = await send("/api/register", viaGoogle
      ? { name: f.name, phone: f.phone, country: f.country, purpose: f.purpose, terms, likeness, google: true }
      : { ...f, terms, likeness, captcha: token || undefined });
    if (r.ok) goIn();
  }

  async function forgot(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/auth/reset", { email: email.trim(), captcha: token || undefined });
    if (r.ok) { setSent(true); setBusy(false); }
  }

  const switchTo = (m: Mode) => { setMode(m); setViaGoogle(false); setError(null); setNote(null); setSent(false); resetCaptcha(); };
  const needRegCaptcha = Boolean(siteKey) && !viaGoogle;
  const googleBtn = google && (
    <>
      <div className="login-or">или</div>
      <a className="btn wide google" href={withBase("/api/auth/google")}><GoogleIcon />Войти с Google</a>
    </>
  );

  return (
    <div className="login">
      {mode === "login" && (
        <form className="login-box" onSubmit={login}>
          <div className="logo big"><img src={withBase("/assets/logo-bright.webp")} alt="" /></div>
          <h1>MetaFrame AI</h1>
          <p className="muted small">Nano Banana · Soul · Seedance · Kling</p>
          {note && <div className={`small ${note.ok ? "login-ok" : "err"}`}>{note.text}</div>}
          <input type="email" autoComplete="email" autoFocus placeholder="Почта" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
          {loginCaptcha && siteKey && <Captcha key={captchaKey} siteKey={siteKey} onToken={setToken} />}
          {error && <div className="err small">{error}</div>}
          <button className="btn accent wide" disabled={busy || !password || (loginCaptcha && !token)}>{busy ? "Вхожу…" : "Войти"}</button>
          {googleBtn}
          <div className="login-links">
            <button type="button" className="linkbtn" onClick={() => switchTo("register")}>Нет аккаунта? Зарегистрироваться</button>
            {mail && <button type="button" className="linkbtn" onClick={() => switchTo("forgot")}>Забыли пароль?</button>}
          </div>
        </form>
      )}

      {mode === "forgot" && (
        <form className="login-box" onSubmit={forgot}>
          <h1>Сброс пароля</h1>
          {sent ? (
            <p className="muted small">Если такая почта зарегистрирована, мы отправили на неё письмо со ссылкой. Ссылка действует 1 час. Проверьте папку «Спам».</p>
          ) : (
            <>
              <p className="muted small">Укажите почту аккаунта — пришлём ссылку для нового пароля. Если вы входили только через Google, так можно задать пароль.</p>
              <input type="email" autoComplete="email" autoFocus placeholder="Почта" value={email} onChange={(e) => setEmail(e.target.value)} />
              {siteKey && <Captcha key={captchaKey} siteKey={siteKey} onToken={setToken} />}
              {error && <div className="err small">{error}</div>}
              <button className="btn accent wide" disabled={busy || !email.trim() || (Boolean(siteKey) && !token)}>{busy ? "Отправляю…" : "Прислать ссылку"}</button>
            </>
          )}
          <button type="button" className="linkbtn login-switch" onClick={() => switchTo("login")}>Вернуться ко входу</button>
        </form>
      )}

      {mode === "register" && (
        <form className="login-box reg-box" onSubmit={register}>
          <h1>{viaGoogle ? "Осталось заполнить заявку" : "Регистрация"}</h1>
          <p className="muted small">Мы подтверждаем личность каждого пользователя. Указывайте настоящие данные — с вами свяжутся для проверки, после неё откроются генерации.</p>
          <input type="text" autoComplete="name" placeholder="Фамилия и имя, как в документе" value={f.name} onChange={set("name")} />
          <input type="email" autoComplete="email" placeholder="Почта" value={f.email} onChange={set("email")} readOnly={viaGoogle} className={viaGoogle ? "login-locked" : undefined}
            title={viaGoogle ? "Почта подтверждена через Google" : undefined} />
          <input type="tel" autoComplete="tel" placeholder="Телефон с кодом страны" value={f.phone} onChange={set("phone")} />
          <input type="text" autoComplete="country-name" placeholder="Страна" value={f.country} onChange={set("country")} />
          <textarea rows={2} placeholder="Для чего вам студия (необязательно)" value={f.purpose} onChange={set("purpose")} />
          {!viaGoogle && <input type="password" autoComplete="new-password" placeholder="Пароль, от 8 символов" value={f.password} onChange={set("password")} />}
          {!viaGoogle && <input type="password" autoComplete="new-password" placeholder="Пароль ещё раз" value={f.password2} onChange={set("password2")} />}
          <label className="reg-check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>Принимаю <a href={withBase("/terms")} target="_blank" rel="noreferrer">правила студии</a> и согласен на обработку моих данных для проверки личности</span>
          </label>
          <label className="reg-check">
            <input type="checkbox" checked={likeness} onChange={(e) => setLikeness(e.target.checked)} />
            <span>Загружаю фото и видео людей только с их согласия и не создаю незаконный, сексуальный или вводящий в заблуждение контент с реальными людьми</span>
          </label>
          {needRegCaptcha && siteKey && <Captcha key={captchaKey} siteKey={siteKey} onToken={setToken} />}
          {error && <div className="err small">{error}</div>}
          <button className="btn accent wide" disabled={busy || !terms || !likeness || !f.name || !f.email || !f.phone || !f.country || (!viaGoogle && !f.password) || (needRegCaptcha && !token)}>
            {busy ? "Отправляю…" : "Отправить заявку"}
          </button>
          {!viaGoogle && googleBtn}
          <button type="button" className="linkbtn login-switch" onClick={() => switchTo("login")}>Уже есть аккаунт? Войти</button>
        </form>
      )}
    </div>
  );
}
