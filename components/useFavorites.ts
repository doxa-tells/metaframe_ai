"use client";
import { useEffect, useState } from "react";
import { getFavoritesApi, setFavoritesApi } from "@/lib/client";

// Общее для всей страницы состояние избранного (галерея, окно выбора из генераций)
let favs = new Set<string>();
let loaded = false;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load() {
  if (!loading) {
    loading = getFavoritesApi()
      .then((keys) => { favs = new Set(keys); loaded = true; emit(); })
      .catch(() => { loading = null; });
  }
  return loading;
}

export const favKey = (jobId: string, index: number) => `${jobId}:${index}`;

export async function toggleFavorites(keys: string[], on: boolean) {
  const prev = favs;
  const next = new Set(favs);
  for (const k of keys) { if (on) next.add(k); else next.delete(k); }
  favs = next; emit();
  try { favs = new Set(await setFavoritesApi(keys, on)); emit(); }
  catch (e) { favs = prev; emit(); throw e; }
}

export function useFavorites() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((x) => x + 1);
    subs.add(f);
    load();
    return () => { subs.delete(f); };
  }, []);
  return {
    ready: loaded,
    has: (k: string) => favs.has(k),
    size: favs.size,
    toggle: (k: string) => toggleFavorites([k], !favs.has(k)),
    set: toggleFavorites,
  };
}
