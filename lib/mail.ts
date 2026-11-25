import "server-only";
import { BASE } from "./base";

// Письма (подтверждение почты, сброс пароля) — через Resend. Без RESEND_API_KEY письма не отправляются,
// и студия работает как раньше: без подтверждения почты и без «Забыли пароль»
const key = () => (process.env.RESEND_API_KEY || "").trim();
export const mailOn = () => Boolean(key());
const from = () => (process.env.MAIL_FROM || "MetaFrame <no-reply@metaframe.ltd>").trim();

// Публичный адрес студии: по нему строятся ссылки в письмах и адрес возврата от Google
export const appUrl = () => `${(process.env.APP_URL || "https://metaframe.ltd").trim().replace(/\/$/, "")}${BASE}`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, text: string, button: string, link: string, foot: string): string {
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#060b0e;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e8e9ec">
<div style="max-width:460px;margin:0 auto;background:#0b151b;border:1px solid #1a313d;border-radius:14px;padding:32px">
<div style="font-size:13px;letter-spacing:.14em;color:#7b8a94;margin-bottom:18px">METAFRAME AI</div>
<h1 style="font-size:20px;margin:0 0 12px;color:#fff">${esc(title)}</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 24px;color:#c9ccd3">${esc(text)}</p>
<a href="${esc(link)}" style="display:inline-block;background:#00e5ff;color:#00222a;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(button)}</a>
<p style="font-size:12px;line-height:1.5;margin:26px 0 0;color:#7b8a94">${esc(foot)}</p>
</div></body></html>`;
}

async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!mailOn()) throw Object.assign(new Error("Отправка писем не настроена"), { status: 503 });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: from(), to: [to], subject, html, text }),
  });
  if (!r.ok) {
    console.error("[mail]", r.status, (await r.text().catch(() => "")).slice(0, 300));
    throw Object.assign(new Error("Не удалось отправить письмо — попробуйте позже"), { status: 502 });
  }
}

export function sendVerifyMail(to: string, name: string, link: string): Promise<void> {
  const text = `${name ? `${name}, п` : "П"}одтвердите почту, чтобы завершить регистрацию в MetaFrame Studio. Ссылка действует 3 дня.`;
  return send(to, "Подтвердите почту — MetaFrame", layout("Подтвердите почту", text, "Подтвердить почту", link,
    "Если вы не регистрировались в MetaFrame Studio, просто не отвечайте на это письмо."), `${text}\n\n${link}`);
}

export function sendResetMail(to: string, link: string): Promise<void> {
  const text = "Кто-то запросил сброс пароля для вашего аккаунта MetaFrame Studio. Ссылка действует 1 час и сработает один раз.";
  return send(to, "Сброс пароля — MetaFrame", layout("Новый пароль", text, "Задать новый пароль", link,
    "Если это были не вы, ничего делать не нужно: пароль останется прежним."), `${text}\n\n${link}`);
}
