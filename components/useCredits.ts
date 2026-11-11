"use client";
import { useCallback, useEffect, useState } from "react";
import { withBase } from "@/lib/base";

export type PayClaim = { pkg: string; credits: number; price: number; at: number } | null;
type State = { credits: number | null; payClaim: PayClaim };

// Баланс кредитов пользователя: общий для всех мест на странице, обновляется после генераций (mf:spent)
let shared: State = { credits: null, payClaim: null };
const subs = new Set<(s: State) => void>();
let inflight: Promise<void> | null = null;

export function refreshCredits(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch(withBase("/api/me"), { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { role?: string; credits?: number; payClaim?: PayClaim } | null) => {
      if (d?.role === "user") { shared = { credits: d.credits ?? 0, payClaim: d.payClaim ?? null }; subs.forEach((f) => f(shared)); }
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

export function useCredits(enabled: boolean) {
  const [s, setS] = useState<State>(shared);
  useEffect(() => {
    if (!enabled) return;
    subs.add(setS);
    refreshCredits();
    const onSpent = () => { refreshCredits(); setTimeout(refreshCredits, 15_000); }; // возврат за отказ приходит позже
    window.addEventListener("mf:spent", onSpent);
    const t = setInterval(refreshCredits, 60_000);
    return () => { subs.delete(setS); window.removeEventListener("mf:spent", onSpent); clearInterval(t); };
  }, [enabled]);
  const setClaim = useCallback((payClaim: PayClaim) => { shared = { ...shared, payClaim }; subs.forEach((f) => f(shared)); }, []);
  return { ...s, refresh: refreshCredits, setClaim };
}
