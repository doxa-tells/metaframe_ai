import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { listUsers, publicUser } from "@/lib/users";

// Список пользователей для владельца (без хэшей паролей)
export async function GET(req: Request) {
  try {
    await requireCtx({ admin: true });
    const fresh = new URL(req.url).searchParams.has("fresh");
    const users = (await listUsers(fresh)).map(publicUser);
    const DAY = 86_400_000;
    return NextResponse.json({
      users: users.map((u) => ({ ...u, blockedDay: (u.blocked ?? []).filter((t) => Date.now() - t < DAY).length })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
