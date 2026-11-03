"use client";
import { useEffect, useRef, useState } from "react";
import { getModel, formatUsd } from "@/lib/models";
import { isTerminal, STATUS_LABEL, timeAgo, type Job, type JobOutput } from "@/lib/client";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";

type Props = {
  jobs: Job[];
  layout: "justified" | "grouped";
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onReuse: (job: Job) => void;
  onUseAsInput?: (url: string) => void;
  onAnimate?: (url: string) => void;
  onDelete: (job: Job) => void;
  onCancel: (job: Job) => void;
  emptyText: string;
};

type Card = { job: Job; index: number; out: JobOutput | null };

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

export function Gallery(p: Props) {
  const { sendToChat } = useApp();
  const [open, setOpen] = useState<{ job: Job; index: number } | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const [refAspects, setRefAspects] = useState<Record<string, number>>({});
  const measuring = useRef(new Set<string>());

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

  const cards: Card[] = p.jobs.flatMap((job): Card[] =>
    job.status === "completed" && job.outputs.length
      ? job.outputs.map((o, index) => ({ job, index, out: o }))
      : isTerminal(job.status)
        ? [{ job, index: 0, out: null }]
        : Array.from({ length: expectedCount(job) }, (_, index) => ({ job, index, out: null })),
  );
  const setAspect = (url: string, w: number, h: number) => {
    if (w && h) setAspects((a) => (a[url] ? a : { ...a, [url]: w / h }));
  };
  const copyPrompt = (job: Job) => {
    navigator.clipboard?.writeText(job.prompt);
    setCopied(job.id);
    setTimeout(() => setCopied(null), 1200);
  };

  function tile({ job, index, out }: Card) {
    const key = `${job.id}-${index}`;
    const ar = out ? aspects[out.url] ?? guessAspect(job, refAspects) : guessAspect(job, refAspects);
    const style = p.layout === "justified" ? { flexGrow: ar * 100, flexBasis: `${ar * 260}px` } : undefined;
    const model = getModel(job.modelId);
    const ratioBox = p.layout === "justified" ? <i className="ratio" style={{ paddingBottom: `${100 / ar}%` }} /> : null;

    if (!out) {
      const pending = !isTerminal(job.status);
      return (
        <div key={key} className={`tile ${pending ? "pending" : "failed"}`} style={style}>
          {ratioBox}
          <div className="tile-inner placeholder">
            {pending ? (
              <>
                <div className="spinner big" />
                <div className="small">{STATUS_LABEL[job.status]} · <Elapsed from={job.createdAt} /></div>
                <div className="tiny-text muted">{model?.name}</div>
              </>
            ) : (
              <div className="err-box small">{STATUS_LABEL[job.status]}{job.error ? `: ${job.error}` : ""}</div>
            )}
            <div className="tile-side">
              {pending && job.status === "queued" && job.providerRequestId && (
                <button className="tbtn" title="Отменить" onClick={() => p.onCancel(job)}><Icon name="stop" size={14} /></button>
              )}
              <button className="tbtn" title="Повторить настройки" onClick={() => p.onReuse(job)}><Icon name="reuse" size={14} /></button>
              {!pending && <button className="tbtn" title="Удалить" onClick={() => p.onDelete(job)}><Icon name="trash" size={14} /></button>}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={key} className="tile" style={style}>
        {ratioBox}
        <div className="tile-inner" onClick={() => setOpen({ job, index })}>
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
          {p.layout === "grouped" && <div className="tile-cap">{model?.name} · {formatUsd(job.cost)}</div>}
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (p.layout === "justified") {
    body = (
      <div className="justified">
        {cards.map(tile)}
        <div className="jfill" />
      </div>
    );
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
        <div className="sq-grid">{g.items.map(tile)}</div>
      </section>
    ));
  }

  return (
    <>
      {!p.loading && p.jobs.length === 0 && <div className="empty">{p.emptyText}</div>}
      {body}
      {p.loading && <div className="center pad"><div className="spinner" /></div>}
      {p.hasMore && !p.loading && <div className="center pad"><button className="btn" onClick={p.onLoadMore}>Показать ещё</button></div>}

      {open && (() => {
        const out = open.job.outputs[open.index];
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
    </>
  );
}
