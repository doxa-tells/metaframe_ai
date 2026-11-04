// Привязывает metaframe.ltd к проекту metaframe-ai (студия на metaframe.ltd/studio).
// Запуск: node scripts/domain.mjs  — использует вход Vercel CLI (npx vercel login).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const DOMAIN = "metaframe.ltd";
const TARGET = "metaframe-ai";
const say = (s) => console.log(`\x1b[36m▸ ${s}\x1b[0m`);
const warn = (s) => console.log(`\x1b[33m! ${s}\x1b[0m`);

function token() {
  const paths = [
    join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"),
    join(homedir(), ".local/share/com.vercel.cli/auth.json"),
    join(homedir(), ".config/com.vercel.cli/auth.json"),
  ];
  for (const p of paths) if (existsSync(p)) { try { const t = JSON.parse(readFileSync(p, "utf8")).token; if (t) return t; } catch {} }
  return null;
}

let TOKEN = token();
if (!TOKEN) {
  say("Вход в Vercel (откроется браузер)");
  execSync("npx -y vercel@latest login", { stdio: "inherit" });
  TOKEN = token();
}
if (!TOKEN) { console.error("Не нашёл токен Vercel CLI. Выполните npx vercel login и запустите снова."); process.exit(1); }

let TEAM = "";
try { TEAM = JSON.parse(readFileSync(new URL("../.vercel/project.json", import.meta.url), "utf8")).orgId || ""; } catch {}
const q = (path) => `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}${TEAM.startsWith("team_") ? `teamId=${TEAM}` : ""}`;
async function api(path, init = {}) {
  const r = await fetch(q(path), { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error?.message || `Vercel ${r.status}`), { status: r.status, body });
  return body;
}

// Если команда не записана в .vercel — ищем ту, где есть проект metaframe-ai
if (!TEAM) {
  const { teams = [] } = await api("/v2/teams");
  for (const t of [{ id: "" }, ...teams]) {
    TEAM = t.id;
    try { await api(`/v9/projects/${TARGET}`); break; } catch { TEAM = ""; }
  }
}

say(`Ищу, к какому проекту привязан ${DOMAIN}`);
const { projects = [] } = await api("/v9/projects?limit=100");
const target = projects.find((p) => p.name === TARGET);
if (!target) { console.error(`Проект ${TARGET} не найден в этом аккаунте Vercel.`); process.exit(1); }
let owner = null;
for (const p of projects) {
  const { domains = [] } = await api(`/v9/projects/${p.id}/domains?limit=100`);
  if (domains.some((d) => d.name === DOMAIN)) { owner = p; break; }
}

if (owner && owner.id === target.id) {
  say(`${DOMAIN} уже привязан к ${TARGET}`);
} else {
  if (owner) {
    const { deployments = [] } = await api(`/v6/deployments?projectId=${owner.id}&target=production&limit=1`);
    const live = deployments[0];
    warn(`${DOMAIN} сейчас у проекта «${owner.name}»${live ? ` (последняя выкладка: ${new Date(live.createdAt).toLocaleString("ru-RU")})` : " (выкладок нет)"}.`);
    if (live) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question(`Перенести ${DOMAIN} из «${owner.name}» в студию? Сайт «${owner.name}» перестанет открываться на ${DOMAIN}. [y/N] `)).trim().toLowerCase();
      rl.close();
      if (a !== "y" && a !== "д") { warn("Оставил как есть. Студия доступна на metaframe-ai.vercel.app/studio."); process.exit(0); }
    }
    say(`Отвязываю ${DOMAIN} от «${owner.name}»`);
    await api(`/v9/projects/${owner.id}/domains/${DOMAIN}`, { method: "DELETE" });
  }
  say(`Привязываю ${DOMAIN} к ${TARGET}`);
  await api(`/v10/projects/${target.id}/domains`, { method: "POST", body: JSON.stringify({ name: DOMAIN }) });
}

// Проверка DNS
const cfg = await api(`/v6/domains/${DOMAIN}/config`).catch(() => null);
if (cfg?.misconfigured) {
  warn(`DNS ещё не указывает на Vercel. Если домен в Cloudflare: DNS → запись ${DOMAIN} (A 76.76.21.21) и www (CNAME cname.vercel-dns.com), облако серое «DNS only».`);
} else {
  say(`Готово: https://${DOMAIN}/studio (после выкладки)`);
}
