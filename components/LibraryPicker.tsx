"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listJobs, thumbOf, type Job } from "@/lib/client";
import { getModel } from "@/lib/models";
import { Icon } from "./Icon";
import { favKey, useFavorites } from "./useFavorites";

export type LibItem = { url: string; type: "image" | "video" };
type Tab = "image" | "video" | "fav";
type Feed = { jobs: Job[]; cursor?: string; done: boolean; loading: boolean };
const emptyFeed = (): Feed => ({ jobs: [], done: false, loading: false });

// Окно выбора референсов из уже сделанных генераций
export function LibraryPicker({ kinds, max, onClose, onPick }: {
  kinds: ("image" | "video")[]; max: number; onClose: () => void; onPick: (items: LibItem[]) => void;
}) {
  const fav = useFavorites();
  const [tab, setTab] = useState<Tab>(kinds[0] ?? "image");
  const [feeds, setFeeds] = useState<Record<"image" | "video", Feed>>({ image: emptyFeed(), video: emptyFeed() });
  const [picked, setPicked] = useState<LibItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const feedsRef = useRef(feeds);
  feedsRef.current = feeds;

  const more = useCallback(async (kind: "image" | "video") => {
    const f = feedsRef.current[kind];
    if (f.loading || f.done) return;
    setFeeds((s) => ({ ...s, [kind]: { ...s[kind], loading: true } }));
    try {
      const r = await listJobs(kind, f.cursor);
      setFeeds((s) => ({ ...s, [kind]: { jobs: [...s[kind].jobs, ...r.jobs], cursor: r.cursor, done: !r.cursor, loading: false } }));
    } catch (e) {
      setError((e as Error).message);
      setFeeds((s) => ({ ...s, [kind]: { ...s[kind], loading: false, done: true } }));
    }
  }, []);

  // Первая страница; для избранного — догружаем всё, чтобы найти отмеченное
  const kindsForTab: ("image" | "video")[] = tab === "fav" ? kinds : [tab];
  useEffect(() => {
    for (const k of kindsForTab) {
      const f = feeds[k];
      if (!f.loading && !f.done && (f.jobs.length === 0 || tab === "fav")) more(k);
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = kindsForTab.flatMap((k) => feeds[k].jobs)
    .filter((j) => j.status === "completed")
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((j) => j.outputs.map((o, i) => ({ job: j, i, o })))
    .filter((x) => kinds.includes(x.o.type) && (tab !== "fav" || fav.has(favKey(x.job.id, x.i))));
  const anyLoading = kindsForTab.some((k) => feeds[k].loading);
  const canMore = tab !== "fav" && !feeds[tab].done;

  function click(it: LibItem) {
    if (max === 1) { onPick([it]); onClose(); return; }
    setPicked((cur) => cur.some((x) => x.url === it.url) ? cur.filter((x) => x.url !== it.url) : cur.length >= max ? cur : [...cur, it]);
  }

  return createPortal(
    <div className="modal-bg lib-bg" onClick={onClose}>
      <div className="lib" onClick={(e) => e.stopPropagation()}>
        <div className="lib-head">
          <b>Из генераций</b>
          <div className="lib-tabs">
            {kinds.includes("image") && <button className={tab === "image" ? "on" : ""} onClick={() => setTab("image")}><Icon name="image" size={14} />Фото</button>}
            {kinds.includes("video") && <button className={tab === "video" ? "on" : ""} onClick={() => setTab("video")}><Icon name="video" size={14} />Видео</button>}
            <button className={tab === "fav" ? "on" : ""} onClick={() => setTab("fav")}><Icon name="star" size={14} className="fav-on" />Избранное</button>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={16} /></button>
        </div>
        <div className="lib-grid"
          onScroll={(e) => { const el = e.currentTarget; if (canMore && el.scrollTop + el.clientHeight > el.scrollHeight - 300) more(tab as "image" | "video"); }}>
          {items.map(({ job, i, o }) => {
            const n = picked.findIndex((x) => x.url === o.url);
            return (
              <button key={job.id + i} type="button" className={`lib-item ${n >= 0 ? "on" : ""}`} onClick={() => click({ url: o.url, type: o.type })}
                title={`${getModel(job.modelId)?.name ?? ""}${job.prompt ? " · " + job.prompt.slice(0, 120) : ""}`}>
                {o.type === "video"
                  ? <video src={o.url} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                  : <img src={thumbOf(o)} alt="" loading="lazy" decoding="async" draggable={false} />}
                {o.type === "video" && <span className="lib-play"><Icon name="play" size={14} /></span>}
                {fav.has(favKey(job.id, i)) && <span className="lib-fav"><Icon name="star" size={12} className="fav-on" /></span>}
                {n >= 0 && <span className="lib-n">{n + 1}</span>}
              </button>
            );
          })}
          {!anyLoading && items.length === 0 && (
            <div className="lib-empty muted">{tab === "fav" ? "В избранном пока пусто — отмечайте результаты звёздочкой в галерее" : "Здесь появятся ваши генерации"}</div>
          )}
          {anyLoading && <div className="lib-empty"><div className="spinner" /></div>}
          {canMore && !anyLoading && items.length > 0 && <div className="lib-empty"><button className="btn" onClick={() => more(tab as "image" | "video")}>Показать ещё</button></div>}
        </div>
        {error && <div className="err small">{error}</div>}
        {max > 1 && (
          <div className="lib-foot">
            <span className="muted small">{picked.length ? `Выбрано ${picked.length} из ${max}` : `Можно выбрать до ${max}`}</span>
            <button className="btn" onClick={onClose}>Отмена</button>
            <button className="btn accent" disabled={!picked.length} onClick={() => { onPick(picked); onClose(); }}>Добавить{picked.length ? ` (${picked.length})` : ""}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
