"use client";
import { useCallback, useEffect, useState } from "react";
import { withBase } from "@/lib/base";
import { useMe } from "./MeContext";

type Warn = { id: string; at: number; reason: string };
type MeInfo = { status?: string; statusReason?: string; frozenUntil?: number; warnings?: Warn[]; limit?: number };

const fmt = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

// Для пользователей: заморозка, предупреждения владельца (нужно подтвердить прочтение), смена статуса на лету
export function AccountNotices() {
  const me = useMe();
  const [info, setInfo] = useState<MeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const user = me.role === "user" ? me : null;

  const load = useCallback(async () => {
    const r = await fetch(withBase("/api/me"), { cache: "no-store" }).catch(() => null);
    if (!r) return;
    if (r.status === 401) { window.location.reload(); return; } // бан или выход — на экран входа
    const d = (await r.json().catch(() => null)) as MeInfo | null;
    if (!d) return;
    // Владелец подтвердил, заморозил или разморозил — перерисуем студию с новым статусом
    if (user && d.status && d.status !== user.status) { window.location.reload(); return; }
    setInfo(d);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 90_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [user, load]);

  if (!user) return null;
  const warn = info?.warnings?.[0];

  async function ack() {
    if (!warn) return;
    setBusy(true);
    await fetch(withBase("/api/me"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ack: warn.id }) }).catch(() => {});
    setInfo((i) => (i ? { ...i, warnings: (i.warnings ?? []).filter((w) => w.id !== warn.id) } : i));
    setBusy(false);
  }

  return (
    <>
      {user.status === "frozen" && (
        <div className="banner danger">
          Аккаунт заморожен{user.frozenUntil ? ` до ${fmt(user.frozenUntil)}` : ""}: генерации и загрузки недоступны.
          {user.statusReason ? ` Причина: ${user.statusReason}` : ""} Свои работы можно смотреть и скачивать.
        </div>
      )}
      {warn && (
        <div className="modal-bg">
          <div className="modal warn-modal" role="alertdialog" aria-labelledby="warn-title">
            <div className="modal-head"><b id="warn-title">Предупреждение от модерации</b></div>
            <p className="warn-reason">{warn.reason}</p>
            <p className="muted small">
              {fmt(warn.at)}. Повторные нарушения ведут к заморозке или блокировке аккаунта.{" "}
              <a className="linkbtn inline" href={withBase("/terms")} target="_blank" rel="noreferrer">Правила студии</a>
            </p>
            <button className="btn accent wide" disabled={busy} onClick={ack}>Понятно</button>
          </div>
        </div>
      )}
    </>
  );
}
