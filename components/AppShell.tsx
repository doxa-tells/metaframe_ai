"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppProvider, useApp } from "./AppContext";
import { ChatPanel } from "./ChatPanel";
import { asset } from "@/lib/brand";
import { withBase } from "@/lib/base";

const NAV = [
  { href: "/image", label: "Фото", icon: "icon-photo", key: "1" },
  { href: "/video", label: "Видео", icon: "icon-video", key: "2" },
  { href: "/nodes", label: "Ноды", icon: "icon-nodes", key: "3" },
];
const NavIcon = ({ name }: { name: string }) => <img className="navicon" src={asset(name)} alt="" draggable={false} />;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { chatOpen, setChatOpen, config } = useApp();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const missing = config && !config.mock
    ? [!config.providers.google && "GEMINI_API_KEY", !config.providers.byteplus && "ARK_API_KEY", !config.providers.higgsfield && "HF_API_KEY"].filter(Boolean)
    : [];

  // Горячие клавиши: 1/2/3 — разделы, C — чат, Esc — закрыть чат
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && chatOpen && !e.defaultPrevented && !document.querySelector(".modal-bg, .popover")) { setChatOpen(false); return; }
      if (typing(e.target)) return;
      const nav = NAV.find((n) => n.key === e.key);
      if (nav) { router.push(nav.href); return; }
      if (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "с") setChatOpen(!chatOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, setChatOpen, router]);

  async function logout() {
    await fetch(withBase("/api/login"), { method: "DELETE" });
    window.location.href = withBase("/login");
  }

  return (
    <div className={`shell ${chatOpen ? "chat-open" : ""}`}>
      <header className="topbar">
        <div className="tb-brand-wrap" ref={menuRef}>
          <button type="button" className={`tb-brand ${menu ? "open" : ""}`} onClick={() => setMenu(!menu)} title="Меню" aria-expanded={menu}>
            <img src={asset("logo-bright")} alt="" draggable={false} />
            <span>MetaFrame</span>
          </button>
          {menu && (
            <div className="tb-menu">
              <div className="tb-menu-keys">
                <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> разделы</div>
                <div><kbd>C</kbd> чат · <kbd>Esc</kbd> закрыть</div>
              </div>
              <button type="button" className="tb-menu-item danger" onClick={logout}>
                <NavIcon name="icon-logout" /> Выйти
              </button>
            </div>
          )}
        </div>
        <nav className="tb-nav" aria-label="Разделы">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`tb-tab ${path?.startsWith(n.href) ? "active" : ""}`} title={`${n.label} (${n.key})`}>
              <NavIcon name={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="tb-right">
          <button className={`tb-btn ${chatOpen ? "active" : ""}`} onClick={() => setChatOpen(!chatOpen)} title="Чат (C)">
            <NavIcon name="icon-chat" />
            <span>Чат</span>
          </button>
        </div>
      </header>
      <main className="main">
        {config?.mock && <div className="banner">Тестовый режим: генерации не настоящие (MOCK_PROVIDERS=1)</div>}
        {config?.storageMissing && (
          <div className="banner warn">Не подключено хранилище: добавьте STORAGE_URL и STORAGE_SECRET в Vercel → Settings → Environment Variables и сделайте Redeploy. Без него не работают загрузка референсов и история.</div>
        )}
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
