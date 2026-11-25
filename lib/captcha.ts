import "server-only";

// Капча Cloudflare Turnstile: при регистрации, при запросе сброса пароля и после нескольких неудачных входов.
// Включается, когда заданы оба ключа (TURNSTILE_SITE_KEY и TURNSTILE_SECRET_KEY); без них проверка пропускается
export const captchaSiteKey = (): string | null => (process.env.TURNSTILE_SITE_KEY || "").trim() || null;
const secret = () => (process.env.TURNSTILE_SECRET_KEY || "").trim();
export const captchaOn = () => Boolean(captchaSiteKey() && secret());

export async function verifyCaptcha(token: unknown, ip?: string): Promise<boolean> {
  if (!captchaOn()) return true;
  if (typeof token !== "string" || !token || token.length > 4096) return false;
  try {
    const form = new URLSearchParams({ secret: secret(), response: token });
    if (ip) form.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const d = (await r.json().catch(() => null)) as { success?: boolean } | null;
    return d?.success === true;
  } catch { return false; }
}
export const CAPTCHA_ERROR = "Подтвердите, что вы не робот";
