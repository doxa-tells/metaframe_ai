// Сессии: подписанный cookie «кто вошёл». Работает и в proxy (Web Crypto), и в API.
// Владелец входит по APP_PASSWORD (uid = ""), пользователи — по почте и паролю.
import { isValidToken } from "./auth";

export const AUTH_COOKIE = "ais_auth";
export const SESSION_DAYS = 30;

export type Session = { uid: string; role: "admin" | "user"; ver: number; exp: number };

const enc = new TextEncoder();
const secret = () => (process.env.SESSION_SECRET || process.env.APP_PASSWORD || "").trim();

async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`mf-session:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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

function sameStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signSession(s: Omit<Session, "exp">, days = SESSION_DAYS): Promise<string> {
  const payload = b64url(JSON.stringify({ ...s, exp: Date.now() + days * 86_400_000 }));
  return `s1.${payload}.${await hmacHex(`s1.${payload}`)}`;
}

export async function readSession(token: string | undefined | null): Promise<Session | null> {
  if (!token || !secret()) return null;
  // Старый cookie владельца (HMAC пароля) — чтобы после обновления не выкинуло из студии
  if (!token.includes(".")) return (await isValidToken(token)) ? { uid: "", role: "admin", ver: 0, exp: Infinity } : null;
  const [v, payload, sig] = token.split(".");
  if (v !== "s1" || !payload || !sig) return null;
  if (!sameStr(sig, await hmacHex(`s1.${payload}`))) return null;
  try {
    const s = JSON.parse(unb64url(payload)) as Session;
    if (typeof s.exp !== "number" || s.exp < Date.now()) return null;
    if (s.role !== "admin" && s.role !== "user") return null;
    if (typeof s.uid !== "string" || (s.role === "user" && !/^u[a-f0-9]{10}$/.test(s.uid))) return null;
    return s;
  } catch { return null; }
}

export const cookieOptions = (days = SESSION_DAYS) => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * days,
});
