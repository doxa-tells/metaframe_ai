"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppProvider, useApp } from "./AppContext";
import { ChatPanel } from "./ChatPanel";
import { Icon } from "./Icon";

const NAV = [
  { href: "/image", label: "Фото", icon: "image" },
  { href: "/video", label: "Видео", icon: "video" },
  { href: "/nodes", label: "Ноды", icon: "nodes" },
];

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { chatOpen, setChatOpen, config } = useApp();
  const missing = config && !config.mock
    ? [!config.providers.google && "GEMINI_API_KEY", !config.providers.byteplus && "ARK_API_KEY", !config.providers.higgsfield && "HF_API_KEY"].filter(Boolean)
    : [];

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="logo">AI</div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`navbtn ${path?.startsWith(n.href) ? "active" : ""}`} title={n.label}>
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="grow" />
        <button className={`navbtn ${chatOpen ? "active" : ""}`} onClick={() => setChatOpen(!chatOpen)} title="Промпт-ассистент">
          <Icon name="chat" size={20} />
          <span>Чат</span>
        </button>
        <button className="navbtn" onClick={logout} title="Выйти">
          <Icon name="logout" size={20} />
          <span>Выход</span>
        </button>
      </nav>
      <main className="main">
        {config?.mock && <div className="banner">Тестовый режим: генерации не настоящие (MOCK_PROVIDERS=1)</div>}
        {missing && missing.length > 0 && (
          <div className="banner warn">Не заданы ключи: {missing.join(", ")}. Добавьте их в Vercel → Settings → Environment Variables и сделайте Redeploy.</div>
        )}
        {children}
      </main>
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
