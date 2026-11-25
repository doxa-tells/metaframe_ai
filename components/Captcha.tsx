"use client";
import { useEffect, useRef } from "react";

type Turnstile = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile; __mfTurnstile?: Promise<void> } }

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  window.__mfTurnstile ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { window.__mfTurnstile = undefined; reject(new Error("captcha")); };
    document.head.appendChild(s);
  });
  return window.__mfTurnstile;
}

// Капча Cloudflare Turnstile. Токен одноразовый: после отправки формы виджет пересоздаётся (меняйте key)
export function Captcha({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  useEffect(() => {
    let id: string | undefined;
    let dead = false;
    loadScript().then(() => {
      if (dead || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: siteKey, theme: "dark", language: "ru",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(""),
        "error-callback": () => cb.current(""),
      });
    }).catch(() => {});
    return () => { dead = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey]);
  return <div ref={ref} className="captcha" />;
}
