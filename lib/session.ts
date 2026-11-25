// Сессии: подписанный cookie «кто вошёл». Работает и в proxy (Web Crypto), и в API.
// Владелец входит по APP_PASSWORD (uid = ""), пользователи — по почте и паролю или через Google.
import { BASE } from "./base";

// Имя и путь cookie новые: прежний cookie (ais_auth, путь «/») был подписан паролем владельца и уходил ещё и лендингу
export const AUTH_COOKIE = "mf_session";
export const SESSION_DAYS = 30;

export type Session = { uid: string; role: "admin" | "user"; ver: number; exp: number };

const enc = new TextEncoder();

// Ключ подписи — отдельный секрет, а не пароль владельца: по своему cookie пароль подобрать нельзя.
// SESSION_SECRET не задан — берём производный от секрета хранилища (он длинный и случайный);
// пароль владельца остаётся только для локальной разработки без хранилища
function secret(): string {
  const own = (process.env.SESSION_SECRET || "").trim();
  if (own) return `s:${own}`;
  const storage = (process.env.STORAGE_SECRET || "").trim();
  if (storage) return `st:${storage}`;
  if (process.env.VERCEL) return "";
  const pw = (process.env.APP_PASSWORD || "").trim();
  return pw ? `pw:${pw}` : "";
}

async function hmacHex(purpose: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`mf-${purpose}-v2:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function sameStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Подписанный токен с назначением и сроком: сессия, ссылка из письма, шаг входа через Google.
// Назначение входит в ключ подписи — токен одного вида не подойдёт вместо другого
export async function signToken(purpose: string, data: Record<string, unknown>, ttlMs: number): Promise<string> {
  if (!secret()) throw Object.assign(new Error("На сервере не задан SESSION_SECRET"), { status: 500 });
  const payload = b64url(JSON.stringify({ ...data, exp: Date.now() + ttlMs }));
  return `s2.${payload}.${await hmacHex(purpose, `s2.${payload}`)}`;
}
export async function readToken<T extends Record<string, unknown>>(purpose: string, token: string | undefined | null): Promise<(T & { exp: number }) | null> {
  if (!token || !secret()) return null;
  const [v, payload, sig, extra] = token.split(".");
  if (v !== "s2" || !payload || !sig || extra !== undefined) return null;
  if (!sameStr(sig, await hmacHex(purpose, `s2.${payload}`))) return null;
  try {
    const d = JSON.parse(unb64url(payload)) as T & { exp: number };
    if (typeof d.exp !== "number" || d.exp < Date.now()) return null;
    return d;
  } catch { return null; }
}

export const signSession = (s: Omit<Session, "exp">, days = SESSION_DAYS): Promise<string> => signToken("session", s, days * 86_400_000);

export async function readSession(token: string | undefined | null): Promise<Session | null> {
  const s = await readToken<Omit<Session, "exp">>("session", token);
  if (!s) return null;
  if (s.role !== "admin" && s.role !== "user") return null;
  if (typeof s.uid !== "string" || typeof s.ver !== "number") return null;
  if (s.role === "admin" ? s.uid !== "" : !/^u[a-f0-9]{10}$/.test(s.uid)) return null;
  return s;
}

// Cookie живёт только под /studio — запросы к лендингу на том же домене его не получают
export const cookieOptions = (days = SESSION_DAYS) => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: BASE, maxAge: 60 * 60 * 24 * days,
});
export const shortCookie = (minutes: number) => ({ ...cookieOptions(), maxAge: 60 * minutes });
