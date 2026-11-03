import { NextResponse } from "next/server";

export function errorResponse(e: unknown) {
  const err = e as { message?: string; status?: number };
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  console.error("[api]", err?.message ?? e);
  return NextResponse.json({ error: err?.message ?? "Ошибка сервера" }, { status });
}

export function requestOrigin(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
