"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getConfig, type AppConfig } from "@/lib/client";

type InsertHandler = (text: string) => void;

type Ctx = {
  config: AppConfig | null;
  // Вставка промпта из чата в активное поле
  registerInsert: (h: InsertHandler | null) => void;
  insertPrompt: (text: string) => void;
  canInsert: boolean;
  // Контекст для чата: с какой моделью сейчас работает пользователь
  chatContext: { modelId?: string; modeId?: string };
  setChatContext: (c: { modelId?: string; modeId?: string }) => void;
  // Отправка в чат
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  pendingChat: { text?: string; images?: string[] } | null;
  sendToChat: (p: { text?: string; images?: string[] }) => void;
  consumePendingChat: () => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const handler = useRef<InsertHandler | null>(null);
  const [canInsert, setCanInsert] = useState(false);
  const [chatContext, setChatContext] = useState<{ modelId?: string; modeId?: string }>({});
  const [chatOpen, setChatOpenState] = useState(true);
  const [pendingChat, setPendingChat] = useState<{ text?: string; images?: string[] } | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
    try {
      const saved = localStorage.getItem("chatOpen");
      if (saved !== null) setChatOpenState(saved === "1");
    } catch { /* нет доступа к storage */ }
  }, []);

  const setChatOpen = useCallback((v: boolean) => {
    setChatOpenState(v);
    try { localStorage.setItem("chatOpen", v ? "1" : "0"); } catch { /* ignore */ }
  }, []);

  const registerInsert = useCallback((h: InsertHandler | null) => {
    handler.current = h;
    setCanInsert(Boolean(h));
  }, []);
  const insertPrompt = useCallback((text: string) => handler.current?.(text), []);
  const sendToChat = useCallback((p: { text?: string; images?: string[] }) => {
    setPendingChat(p);
    setChatOpen(true);
  }, [setChatOpen]);
  const consumePendingChat = useCallback(() => setPendingChat(null), []);

  return (
    <AppCtx.Provider value={{
      config, registerInsert, insertPrompt, canInsert, chatContext, setChatContext,
      chatOpen, setChatOpen, pendingChat, sendToChat, consumePendingChat,
    }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp вне AppProvider");
  return c;
}
