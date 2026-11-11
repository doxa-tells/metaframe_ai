import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { parseJobId } from "@/lib/jobs";
import { findByEmail, validUid } from "@/lib/users";

// Найти пользователя по почте, id пользователя, id генерации или ссылке на результат (…/out/<id>/0.png)
export async function GET(req: Request) {
  try {
    await requireCtx({ admin: true });
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });
    if (q.includes("@") && !q.includes("/")) {
      const u = await findByEmail(q);
      return NextResponse.json(u ? { uid: u.id } : { error: "Не найдено" }, { status: u ? 200 : 404 });
    }
    if (validUid(q)) return NextResponse.json({ uid: q });
    const m = /((?:image|video)_\d{13}_[a-f0-9]{8}(?:_u[a-f0-9]{10})?)/.exec(q);
    const p = m ? parseJobId(m[1]) : null;
    if (!p) return NextResponse.json({ error: "Не похоже на почту, id или ссылку на генерацию" }, { status: 400 });
    return NextResponse.json({ jobId: m![1], uid: p.uid || null, owner: !p.uid });
  } catch (e) {
    return errorResponse(e);
  }
}
