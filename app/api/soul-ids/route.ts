import { NextResponse } from "next/server";
import { listSoulIds, createSoulId } from "@/lib/providers/higgsfield";
import { MOCK } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";
import { toAbsolute } from "@/lib/storage";
import { requireCtx } from "@/lib/me";
import { updateUser } from "@/lib/users";
import { logAction } from "@/lib/modlog";

// Персонажи Soul ID живут в аккаунте Higgsfield владельца: пользователю показываем только созданных им
export async function GET() {
  try {
    const me = await requireCtx();
    const own = new Set(me.user?.souls ?? []);
    if (MOCK) {
      const items = me.admin ? [{ id: "mock-soul", name: "Тестовый персонаж", status: "completed" }] : [...own].map((id) => ({ id, name: "Мой персонаж", status: "completed" }));
      return NextResponse.json({ items });
    }
    const items = await listSoulIds();
    return NextResponse.json({ items: me.admin ? items : items.filter((i) => own.has(i.id)) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const { name, images } = (await req.json()) as { name: string; images: string[] };
    if (!name?.trim()) return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
    if (!images?.length) return NextResponse.json({ error: "Добавьте фото" }, { status: 400 });
    if (images.length > 100) return NextResponse.json({ error: "Максимум 100 фото" }, { status: 400 });
    const origin = requestOrigin(req);
    const item = MOCK
      ? { id: `mock-${Date.now()}`, name, status: "in_progress" }
      : await createSoulId(name.trim(), images.map((u) => toAbsolute(u, origin)));
    if (me.user) {
      await updateUser(me.uid, (u) => { u.souls = [...(u.souls ?? []), item.id].slice(-200); });
      // Персонаж обучается на фото человека — оставляем след для разбирательств
      await logAction({ actor: "user", action: "note", userId: me.uid, email: me.user.email, reason: `Создан Soul ID «${name.trim().slice(0, 60)}»`, meta: { soulId: item.id, images: images.slice(0, 100) } });
    }
    return NextResponse.json({ item });
  } catch (e) {
    return errorResponse(e);
  }
}
