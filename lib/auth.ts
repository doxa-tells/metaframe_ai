// Простая защита паролем: cookie хранит HMAC от пароля, сам пароль не хранится.
export const AUTH_COOKIE = "ais_auth";

export async function authToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("ai-studio-auth-v1"));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isValidToken(token: string | undefined): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw || !token) return false;
  const expected = await authToken(pw);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
