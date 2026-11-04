"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getModel, formatUsd } from "@/lib/models";
import { isTerminal, STATUS_LABEL, timeAgo, type Job, type JobOutput } from "@/lib/client";
import { downloadItems, fileNameFor } from "@/lib/archive";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";
import { PillPopover } from "./Popover";

export type GalleryView = { layout: "masonry" | "square"; split: boolean; masonrySize: number; squareSize: number };
export type BulkItem = { id: string; indexes?: number[] };

type Props = {
  jobs: Job[];
  viewKey: string;
  defaultView: GalleryView;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onReuse: (job: Job) => void;
  onUseAsInput?: (url: string) => void;
  onAnimate?: (url: string) => void;
  onDelete: (job: Job) => void;
  onBulkDelete: (items: BulkItem[]) => Promise<void>;
  onCancel: (job: Job) => void;
  emptyText: string;
};

type Card = { job: Job; index: number; out: JobOutput | null };
const cardKey = (c: { job: Job; index: number }) => `${c.job.id}:${c.index}`;

const SIZE = { masonry: { min: 140, max: 480 }, square: { min: 110, max: 360 } } as const;

function Elapsed({ from }: { from: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  return <>{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</>;
}

// Первый референс-картинка задачи (по порядку входов модели)
function firstImageRef(job: Job): string | null {
  const mode = getModel(job.modelId)?.modes.find((m) => m.id === job.modeId);
  for (const s of mode?.inputs ?? []) {
    if (s.kind !== "image") continue;
    const u = (job.inputs?.[s.key] ?? []).find(Boolean);
    if (u) return u;
  }
  return null;
}

// Соотношение сторон до загрузки: явный формат, иначе («Авто») — как у первого референса
function guessAspect(job: Job, refAspects: Record<string, number>): number {
  const ar = String(job.params.aspect_ratio ?? "");
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar);
  if (m) return Number(m[1]) / Number(m[2]);
  const ref = firstImageRef(job);
  if (ref && refAspects[ref]) return refAspects[ref];
  return job.kind === "video" ? 16 / 9 : 3 / 4;
}

// Сколько картинок ждём от задачи
function expectedCount(job: Job): number {
  const n = Number(job.params.count ?? job.params.batch_size ?? job.params.num_images ?? 1);
  return Number.isFinite(n) && n > 1 ? Math.min(Math.floor(n), 8) : 1;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

const inField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// Настройки вида сохраняются в браузере отдельно для фото и видео
function useView(key: string, def: GalleryView): [GalleryView, (patch: Partial<GalleryView>) => void] {
  const [view, setView] = useState<GalleryView>(def);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setView({ ...def, ...(JSON.parse(raw) as Partial<GalleryView>) });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback((patch: Partial<GalleryView>) => {
    setView((v) => {
      const next = { ...v, ...patch };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  return [view, update];
}

export function Gallery(p: Props) {
  const { sendToChat } = useApp();
  const [view, setView] = useView(p.viewKey, p.defaultView);
  const [open, setOpen] = useState<{ job: Job; index: number } | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [refAspects, setRefAspects] = useState<Record<string, number>>({});
  const measuring = useRef(new Set<string>());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selMode, setSelMode] = useState(false);
  const anchor = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Замеряем первый референс у задач в процессе, чтобы заглушка сразу была нужной формы
  useEffect(() => {
    for (const job of p.jobs) {
      if (isTerminal(job.status)) continue;
      const ref = firstImageRef(job);
      if (!ref || measuring.current.has(ref)) continue;
      measuring.current.add(ref);
      const img = new Image();
      img.onload = () => { if (img.naturalWidth && img.naturalHeight) setRefAspects((a) => ({ ...a, [ref]: img.naturalWidth / img.naturalHeight })); };
      img.src = ref;
    }
  }, [p.jobs]);

  const cards: Card[] = useMemo(() => p.jobs.flatMap((job): Card[] =>
    job.status === "completed" && job.outputs.length
      ? job.outputs.map((o, index) => ({ job, index, out: o }))
      : isTerminal(job.status)
        ? [{ job, index: 0, out: null }]
        : Array.from({ length: expectedCount(job) }, (_, index) => ({ job, index, out: null })),
  ), [p.jobs]);

  // Выбирать можно готовые результаты и ошибки (их — чтобы удалить), но не то, что ещё генерируется
  const selectable = useMemo(() => cards.filter((c) => isTerminal(c.job.status)), [cards]);
  const selecting = selMode || sel.size > 0;

  // Убираем из выделения то, чего больше нет
  useEffect(() => {
    setSel((s) => {
      if (!s.size) return s;
      const alive = new Set(selectable.map(cardKey));
      const next = new Set([...s].filter((k) => alive.has(k)));
      return next.size === s.size ? s : next;
    });
  }, [selectable]);

  function toggle(c: Card, range: boolean) {
    const key = cardKey(c);
    const from = anchor.current; // запоминаем до обновления: функция ниже выполнится позже
    setSel((s) => {
      const next = new Set(s);
      if (range && from) {
        const keys = selectable.map(cardKey);
        const a = keys.indexOf(from);
        const b = keys.indexOf(key);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(keys[i]);
          return next;
        }
      }
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    anchor.current = key;
  }
  const clearSel = () => { setSel(new Set()); setSelMode(false); anchor.current = null; };
  const selectAll = () => setSel(new Set(selectable.map(cardKey)));
  const selectedCards = selectable.filter((c) => sel.has(cardKey(c)));

  async function downloadSelected() {
    const withFiles = selectedCards.filter((c) => c.out);
    if (!withFiles.length) return;
    const used = new Set<string>();
    const items = withFiles.map((c) => ({ url: c.out!.url, name: fileNameFor(c.job.prompt, c.job.createdAt, c.index, c.out!.url, used) }));
    const d = new Date();
    const zipName = `metaframe_${d.toISOString().slice(0, 10)}_${items.length}.zip`;
    setBusy(`Скачиваю 0/${items.length}`);
    try {
      const { failed } = await downloadItems(items, zipName, (done, total) => setBusy(`Скачиваю ${done}/${total}`));
      setNotice(failed ? `Не удалось скачать ${failed} из ${items.length}` : null);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteSelected() {
    if (!selectedCards.length) return;
    if (!confirm(`Удалить выбранное (${selectedCards.length})? Это действие нельзя отменить.`)) return;
    const byJob = new Map<string, { job: Job; idx: number[] }>();
    for (const c of selectedCards) {
      const g = byJob.get(c.job.id) ?? { job: c.job, idx: [] };
      g.idx.push(c.index);
      byJob.set(c.job.id, g);
    }
    const items: BulkItem[] = [...byJob.values()].map(({ job, idx }) =>
      !job.outputs.length || idx.length >= job.outputs.length ? { id: job.id } : { id: job.id, indexes: idx });
    setBusy("Удаляю…");
    try {
      await p.onBulkDelete(items);
      clearSel();
    } finally {
      setBusy(null);
    }
  }

  // Клавиши: Esc — снять выделение, Cmd/Ctrl+A — выбрать всё, Delete — удалить
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || inField(e.target)) return;
      if (e.key === "Escape" && selecting) { clearSel(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && selectable.length) { e.preventDefault(); selectAll(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.size && !busy) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setAspect = (url: string, w: number, h: number) => {
    if (w && h) setAspects((a) => (a[url] ? a : { ...a, [url]: w / h }));
  };
  const copyPrompt = (job: Job) => {
    navigator.clipboard?.writeText(job.prompt);
    setCopied(job.id);
    setTimeout(() => setCopied(null), 1200);
  };

  const masonry = view.layout === "masonry";
  const rowH = view.masonrySize;

  function checkbox(c: Card) {
    const on = sel.has(cardKey(c));
    return (
      <button type="button" className={`tsel ${on ? "on" : ""}`} aria-label={on ? "Снять выбор" : "Выбрать"} title="Выбрать (Shift — диапазон)"
        onClick={(e) => { e.stopPropagation(); toggle(c, e.shiftKey); }}>
        {on && <Icon name="check" size={13} />}
      </button>
    );
  }

  function tile(c: Card) {
    const { job, index, out } = c;
    const key = cardKey(c);
    const ar = out ? aspects[out.url] ?? guessAspect(job, refAspects) : guessAspect(job, refAspects);
    const style = masonry ? { flexGrow: ar * 100, flexBasis: `${ar * rowH}px` } : undefined;
    const model = getModel(job.modelId);
    const ratioBox = masonry ? <i className="ratio" style={{ paddingBottom: `${100 / ar}%` }} /> : null;
    const isSel = sel.has(key);
    const onTileClick = (e: React.MouseEvent) => {
      if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) { toggle(c, e.shiftKey); return; }
      if (out) setOpen({ job, index });
    };

    if (!out) {
      const pending = !isTerminal(job.status);
      return (
        <div key={key} className={`tile ${pending ? "pending" : "failed"} ${isSel ? "selected" : ""}`} style={style}>
          {ratioBox}
          <div className="tile-inner placeholder" onClick={pending ? undefined : onTileClick}>
            {pending ? (
              <>
                <div className="spinner big" />
                <div className="small">{STATUS_LABEL[job.status]} · <Elapsed from={job.createdAt} /></div>
                <div className="tiny-text muted">{model?.name}</div>
              </>
            ) : (
              <div className="err-box small">{STATUS_LABEL[job.status]}{job.error ? `: ${job.error}` : ""}</div>
            )}
            {!pending && checkbox(c)}
            {!selecting && (
              <div className="tile-side" onClick={(e) => e.stopPropagation()}>
                {pending && job.status === "queued" && job.providerRequestId && (
                  <button className="tbtn" title="Отменить" onClick={() => p.onCancel(job)}><Icon name="stop" size={14} /></button>
                )}
                <button className="tbtn" title="Повторить настройки" onClick={() => p.onReuse(job)}><Icon name="reuse" size={14} /></button>
                {!pending && <button className="tbtn" title="Удалить" onClick={() => p.onDelete(job)}><Icon name="trash" size={14} /></button>}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div key={key} className={`tile ${isSel ? "selected" : ""}`} style={style}>
        {ratioBox}
        <div className="tile-inner" onClick={onTileClick}>
          {out.type === "video" ? (
            <>
              <video src={out.url} muted loop playsInline preload="metadata"
                onLoadedMetadata={(e) => setAspect(out.url, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
                onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
              <span className="play"><Icon name="play" size={22} /></span>
            </>
          ) : (
            <img src={out.url} alt={job.prompt} loading="lazy" draggable
              onLoad={(e) => setAspect(out.url, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              onDragStart={(e) => e.dataTransfer.setData("text/uri-list", out.url)} />
          )}
          {checkbox(c)}
          {!selecting && (
            <>
              <div className="tile-side" onClick={(e) => e.stopPropagation()}>
                <a className="tbtn" href={out.url} download target="_blank" rel="noreferrer" title="Скачать"><Icon name="download" size={14} /></a>
                <button className="tbtn" title={copied === job.id ? "Скопировано" : "Копировать промпт"} onClick={() => copyPrompt(job)}>
                  <Icon name={copied === job.id ? "check" : "copy"} size={14} />
                </button>
                <button className="tbtn" title="Повторить настройки" onClick={() => p.onReuse(job)}><Icon name="reuse" size={14} /></button>
                <button className="tbtn" title="Удалить" onClick={() => p.onDelete(job)}><Icon name="trash" size={14} /></button>
              </div>
              {out.type === "image" && (
                <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
                  {p.onUseAsInput && <button className="tact" onClick={() => p.onUseAsInput!(out.url)}><Icon name="image" size={14} /><span>Референс</span></button>}
                  {p.onAnimate && <button className="tact" onClick={() => p.onAnimate!(out.url)}><Icon name="film" size={14} /><span>Анимировать</span></button>}
                  <button className="tact" onClick={() => sendToChat({ images: [out.url] })}><Icon name="chat" size={14} /><span>В чат</span></button>
                </div>
              )}
            </>
          )}
          {!masonry && <div className="tile-cap">{model?.name} · {formatUsd(job.cost)}</div>}
        </div>
      </div>
    );
  }

  function block(items: Card[]) {
    return masonry ? (
      <div className="justified">
        {items.map(tile)}
        <div className="jfill" />
      </div>
    ) : (
      <div className="sq-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${view.squareSize}px, 1fr))` }}>{items.map(tile)}</div>
    );
  }

  let body: React.ReactNode;
  if (!view.split) {
    body = block(cards);
  } else {
    const groups: { label: string; items: Card[] }[] = [];
    for (const c of cards) {
      const label = dayLabel(c.job.createdAt);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(c);
      else groups.push({ label, items: [c] });
    }
    body = groups.map((g) => (
      <section key={g.label} className="day">
        <h3>{g.label}</h3>
        {block(g.items)}
      </section>
    ));
  }

  const sizeKey = masonry ? "masonrySize" : "squareSize";
  const range = SIZE[view.layout];

  return (
    <div className={`gallery ${selecting ? "selecting" : ""} ${masonry ? "is-masonry" : "is-square"}`}>
      <div className={`gbar ${selecting ? "sel" : ""}`}>
        {selecting ? (
          <>
            <button className="pill icon" onClick={clearSel} title="Снять выделение (Esc)"><Icon name="x" size={15} /></button>
            <span className="gbar-count">Выбрано: {sel.size}</span>
            {sel.size < selectable.length && <button className="pill" onClick={selectAll} title="Cmd/Ctrl + A"><Icon name="selectall" size={15} />Выбрать все</button>}
            <span className="gbar-grow" />
            {busy && <span className="gbar-busy"><span className="spinner" />{busy}</span>}
            <button className="pill" disabled={Boolean(busy) || !selectedCards.some((c) => c.out)} onClick={downloadSelected}>
              <Icon name="download" size={15} />{selectedCards.filter((c) => c.out).length > 1 ? "Скачать архивом" : "Скачать"}
            </button>
            <button className="pill danger" disabled={Boolean(busy) || !sel.size} onClick={deleteSelected} title="Delete"><Icon name="trash" size={15} />Удалить</button>
          </>
        ) : (
          <>
            {notice && <span className="gbar-note">{notice}</span>}
            <span className="gbar-grow" />
            {selectable.length > 0 && (
              <button className="pill" onClick={() => setSelMode(true)} title="Выделить несколько (или Cmd/Ctrl + клик по карточке)">
                <Icon name="check" size={15} />Выбрать
              </button>
            )}
            <PillPopover placement="down" align="right" width={250} title="Вид"
              label={<><Icon name={masonry ? "masonry" : "grid"} size={15} />Вид</>}>
              {() => (
                <div className="view-pop">
                  <div className="pop-title">Сетка</div>
                  <div className="opt-list">
                    <button type="button" className={`opt row-opt ${!masonry ? "on" : ""}`} onClick={() => setView({ layout: "square" })}>
                      <span className="row gap8"><Icon name="grid" size={16} />Квадраты</span>{!masonry && <Icon name="check" size={15} />}
                    </button>
                    <button type="button" className={`opt row-opt ${masonry ? "on" : ""}`} onClick={() => setView({ layout: "masonry" })}>
                      <span className="row gap8"><Icon name="masonry" size={16} />Мозаика</span>{masonry && <Icon name="check" size={15} />}
                    </button>
                  </div>
                  <div className="view-row">
                    <span className="row gap8"><Icon name="calendar" size={16} />По датам</span>
                    <button type="button" className={`toggle ${view.split ? "on" : ""}`} onClick={() => setView({ split: !view.split })} aria-label="Разбить по датам"><span /></button>
                  </div>
                  <div className="pop-title">Размер карточек</div>
                  <input type="range" className="pop-range" min={range.min} max={range.max} step={10} value={view[sizeKey]}
                    onChange={(e) => setView({ [sizeKey]: Number(e.target.value) } as Partial<GalleryView>)} />
                  <div className="row between muted tiny-text"><span>Мельче</span><span>Крупнее</span></div>
                </div>
              )}
            </PillPopover>
          </>
        )}
      </div>

      {!p.loading && p.jobs.length === 0 && <div className="empty">{p.emptyText}</div>}
      {body}
      {p.loading && <div className="center pad"><div className="spinner" /></div>}
      {p.hasMore && !p.loading && <div className="center pad"><button className="btn" onClick={p.onLoadMore}>Показать ещё</button></div>}

      {open && (() => {
        const out = open.job.outputs[open.index];
        if (!out) return null;
        const model = getModel(open.job.modelId);
        const mode = model?.modes.find((m) => m.id === open.job.modeId);
        return (
          <div className="modal-bg" onClick={() => setOpen(null)}>
            <div className="lightbox" onClick={(e) => e.stopPropagation()}>
              <div className="lightbox-media">
                {out.type === "video" ? <video src={out.url} controls autoPlay loop playsInline /> : <img src={out.url} alt="" />}
              </div>
              <div className="lightbox-side">
                <div className="row between">
                  <b>{model?.name}</b>
                  <button className="iconbtn" onClick={() => setOpen(null)}><Icon name="x" size={16} /></button>
                </div>
                <div className="muted small">{mode?.label} · {timeAgo(open.job.createdAt)} · {formatUsd(open.job.cost)}</div>
                {open.job.prompt && <div className="lb-prompt">{open.job.prompt}</div>}
                <div className="lb-params">
                  {Object.entries(open.job.params).filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
                    <span key={k} className="chip static">{k}: {String(v)}</span>
                  ))}
                </div>
                <div className="col gap8">
                  <button className="btn" onClick={() => { p.onReuse(open.job); setOpen(null); }}><Icon name="reuse" size={14} /> Повторить настройки</button>
                  {p.onUseAsInput && out.type === "image" && (
                    <button className="btn" onClick={() => { p.onUseAsInput!(out.url); setOpen(null); }}><Icon name="image" size={14} /> Как референс</button>
                  )}
                  {p.onAnimate && out.type === "image" && (
                    <button className="btn" onClick={() => { p.onAnimate!(out.url); setOpen(null); }}><Icon name="film" size={14} /> Анимировать</button>
                  )}
                  {out.type === "image" && (
                    <button className="btn" onClick={() => { sendToChat({ images: [out.url], text: "Разбери этот кадр и предложи промпт для похожего" }); setOpen(null); }}><Icon name="chat" size={14} /> Обсудить в чате</button>
                  )}
                  <a className="btn" href={out.url} download target="_blank" rel="noreferrer"><Icon name="download" size={14} /> Скачать</a>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
