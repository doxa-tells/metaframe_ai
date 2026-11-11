import "server-only";
import { cookies } from "next/headers";
import { AUTH_COOKIE, readSession } from "./session";
import { effectiveStatus, getUser, type UserRecord, type UserStatus } from "./users";

// Кто делает запрос. scope — «папка» данных: "" у владельца (старые пути), id у пользователя.
export type Ctx = { uid: string; scope: string; admin: boolean; user: UserRecord | null; status: UserStatus };

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function getCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const s = await readSession(jar.get(AUTH_COOKIE)?.value);
  if (!s) return null;
  if (s.role === "admin") return { uid: "", scope: "", admin: true, user: null, status: "active" };
  const user = await getUser(s.uid);
  if (!user || user.ver !== s.ver) return null;
  return { uid: user.id, scope: user.id, admin: false, user, status: effectiveStatus(user) };
}

const STATUS_TEXT: Record<UserStatus, string> = {
  active: "",
  pending: "Аккаунт ещё на проверке — генерации откроются после подтверждения личности",
  frozen: "Аккаунт заморожен — генерации временно недоступны",
  banned: "Аккаунт заблокирован",
  rejected: "Заявка на доступ отклонена",
};

// active — можно тратить деньги (генерации, загрузки, чат); admin — только владелец
export async function requireCtx(opts: { active?: boolean; admin?: boolean } = {}): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw fail("Нужен вход", 401);
  if (ctx.status === "banned") throw fail(STATUS_TEXT.banned, 401);
  if (opts.admin && !ctx.admin) throw fail("Только для владельца", 403);
  if (opts.active && ctx.status !== "active") {
    const why = ctx.user?.statusReason ? `: ${ctx.user.statusReason}` : "";
    throw fail(STATUS_TEXT[ctx.status] + (ctx.status === "frozen" ? why : ""), 403);
  }
  return ctx;
}

export function clientIp(req: Request): string | undefined {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "").trim() || undefined;
}
