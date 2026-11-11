"use client";
import { withBase } from "@/lib/base";
import type { Me } from "./MeContext";

// Экран вместо студии, пока аккаунт на проверке, отклонён или заблокирован
export function AccountGate({ me }: { me: Extract<Me, { role: "user" }> }) {
  async function logout() {
    await fetch(withBase("/api/login"), { method: "DELETE" });
    window.location.href = withBase("/login");
  }
  const t = me.status === "pending"
    ? { title: "Аккаунт на проверке", text: "Мы подтверждаем личность каждого пользователя вручную. Владелец студии свяжется с вами по телефону или почте, указанным при регистрации. Обычно это занимает до одного рабочего дня — после подтверждения генерации откроются автоматически." }
    : me.status === "rejected"
      ? { title: "Заявка отклонена", text: me.statusReason || "Подтвердить личность не удалось." }
      : { title: "Аккаунт заблокирован", text: me.statusReason || "Аккаунт заблокирован за нарушение правил." };
  return (
    <div className="login">
      <div className="login-box gate-box">
        <div className="logo big"><img src={withBase("/assets/logo-bright.webp")} alt="" /></div>
        <h1>{t.title}</h1>
        <p className="muted">{t.text}</p>
        <div className="gate-who small">{me.name}<br /><span className="muted">{me.email}</span></div>
        {me.status === "pending" && <button className="btn wide" onClick={() => window.location.reload()}>Проверить снова</button>}
        <a className="linkbtn gate-link" href={withBase("/terms")} target="_blank" rel="noreferrer">Правила студии</a>
        <button className="btn wide" onClick={logout}>Выйти</button>
      </div>
    </div>
  );
}
