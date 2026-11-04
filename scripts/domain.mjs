// Студия на metaframe.ltd/studio, лендинг остаётся на metaframe.ltd.
// В проект лендинга добавляется правило маршрутизации: /studio/* → студия (metaframe-ai).
// Код лендинга не меняется. Запуск: node scripts/domain.mjs (использует вход Vercel CLI).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const DOMAIN = "metaframe.ltd";
const STUDIO_PROJECT = "metaframe-ai";
const STUDIO_URL = "https://metaframe-ai.vercel.app";
const say = (s) => console.log(`\x1b[36m▸ ${s}\x1b[0m`);
const warn = (s) => console.log(`\x1b[33m! ${s}\x1b[0m`);

function token() {
  for (const p of [
    join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"),
    join(homedir(), ".local/share/com.vercel.cli/auth.json"),
    join(homedir(), ".config/com.vercel.cli/auth.json"),
  ]) if (existsSync(p)) { try { const t = JSON.parse(readFileSync(p, "utf8")).token; if (t) return t; } catch {} }
  return null;
}
let TOKEN = token();
if (!TOKEN) { say("Вход в Vercel (откроется браузер)"); execSync("npx -y vercel@latest login", { stdio: "inherit" }); TOKEN = token(); }
if (!TOKEN) { console.error("Не нашёл токен Vercel CLI. Выполните npx vercel login и запустите снова."); process.exit(1); }

let TEAM = "";
try { TEAM = JSON.parse(readFileSync(new URL("../.vercel/project.json", import.meta.url), "utf8")).orgId || ""; } catch {}
const url = (path) => `https://api.vercel.com${path}${TEAM.startsWith("team_") ? `${path.includes("?") ? "&" : "?"}teamId=${TEAM}` : ""}`;
async function api(path, init = {}) {
  const r = await fetch(url(path), { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`${init.method || "GET"} ${path}: ${body?.error?.message || r.status}`), { status: r.status, body });
  return body;
}

say(`Ищу проект лендинга (${DOMAIN})`);
const { projects = [] } = await api("/v9/projects?limit=100");
const studio = projects.find((p) => p.name === STUDIO_PROJECT);
if (!studio) { console.error(`Проект ${STUDIO_PROJECT} не найден.`); process.exit(1); }
const domainsOf = async (p) => (await api(`/v9/projects/${p.id}/domains?limit=100`)).domains || [];
let landing = null;
for (const p of projects) if ((await domainsOf(p)).some((d) => d.name === DOMAIN)) { landing = p; break; }
if (!landing) { console.error(`${DOMAIN} не привязан ни к одному проекту.`); process.exit(1); }
if (landing.id === studio.id) { warn(`${DOMAIN} привязан к самой студии — правило не нужно, студия уже на ${DOMAIN}/studio.`); process.exit(0); }
say(`Лендинг: «${landing.name}»`);

// 1. Правила маршрутизации в проекте лендинга: /studio и /studio/* → студия
const RULE = "MetaFrame Studio";
const existingRaw = JSON.stringify(await api(`/v1/projects/${landing.id}/routes`).catch(() => ({})));
const mine = [`${RULE} (root)`, `${RULE} (pages)`].filter((n) => existingRaw.includes(n)).map((name) => ({ name }));
const rules = [
  { name: `${RULE} (root)`, src: "^/studio$", dest: `${STUDIO_URL}/studio` },
  { name: `${RULE} (pages)`, src: "^/studio/(.*)$", dest: `${STUDIO_URL}/studio/$1` },
];
let version = null;
if (mine.length >= 2) {
  say("Правила /studio уже есть в проекте лендинга");
} else {
  for (const r of rules) {
    if (mine.some((m) => m.name === r.name)) continue;
    const post = (body) => api(`/v1/projects/${landing.id}/routes`, { method: "POST", body: JSON.stringify(body) });
    let res;
    try {
      res = await post({
        route: { name: r.name, description: "Студия MetaFrame (проект metaframe-ai)", enabled: true, srcSyntax: "regex", route: { src: r.src, dest: r.dest } },
        position: { placement: "start" },
      });
    } catch (e) {
      if (e.status !== 400) throw e;
      // запасной формат запроса
      res = await post({ name: r.name, routeType: "rewrite", srcSyntax: "regex", route: { src: r.src, dest: r.dest }, position: { placement: "start" } });
    }
    version = res.version || version;
    say(`Добавлено правило: ${r.name}`);
  }
  if (version?.id) {
    await api(`/v1/projects/${landing.id}/routes/versions`, { method: "POST", body: JSON.stringify({ id: version.id, action: "promote" }) });
    say("Правила опубликованы");
  }
}

// 2. www.metaframe.ltd — к лендингу (с переадресацией на metaframe.ltd), а не к студии
const WWW = `www.${DOMAIN}`;
if ((await domainsOf(studio)).some((d) => d.name === WWW)) {
  await api(`/v9/projects/${studio.id}/domains/${WWW}`, { method: "DELETE" });
  say(`${WWW} отвязан от студии`);
}
if (!(await domainsOf(landing)).some((d) => d.name === WWW)) {
  await api(`/v10/projects/${landing.id}/domains`, { method: "POST", body: JSON.stringify({ name: WWW, redirect: DOMAIN, redirectStatusCode: 308 }) })
    .then(() => say(`${WWW} → ${DOMAIN} (в проекте лендинга)`))
    .catch((e) => warn(`${WWW}: ${e.message}`));
}

// 3. Проверка
await new Promise((r) => setTimeout(r, 4000));
try {
  const r = await fetch(`https://${DOMAIN}/studio/login`, { redirect: "manual" });
  const html = r.status === 200 ? await r.text() : "";
  if (html.includes("MetaFrame")) say(`Готово: https://${DOMAIN}/studio`);
  else warn(`${DOMAIN}/studio ответил ${r.status}. Если только что выкладывали студию — подождите минуту, правила применяются не мгновенно.`);
} catch (e) { warn(`Проверка не прошла: ${e.message}`); }
