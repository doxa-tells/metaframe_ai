"use client";
import { useEffect, useState } from "react";
import { getModel, formatUsd } from "@/lib/models";
import { isTerminal, STATUS_LABEL, timeAgo, type Job } from "@/lib/client";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";

type Props = {
  jobs: Job[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onReuse: (job: Job) => void;
  onUseAsInput?: (url: string) => void;
  onDelete: (job: Job) => void;
  onCancel: (job: Job) => void;
};

function Elapsed({ from }: { from: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  return <>{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</>;
}

export function History({ jobs, loading, hasMore, onLoadMore, onReuse, onUseAsInput, onDelete, onCancel }: Props) {
  const { sendToChat } = useApp();
  const [open, setOpen] = useState<{ job: Job; index: number } | null>(null);
  const spent = jobs.reduce((s, j) => s + (j.status === "completed" ? j.cost : 0), 0);

  // Каждая картинка из пакета — отдельная карточка
  type CardItem = { job: Job; index: number; out: Job["outputs"][number] | null };
  const cards: CardItem[] = jobs.flatMap((job): CardItem[] =>
    job.status === "completed" && job.outputs.length
      ? job.outputs.map((o, index) => ({ job, index, out: o }))
      : [{ job, index: 0, out: null }],
  );

  return (
    <section className="history">
      <div className="history-head">
        <h2>История</h2>
        <span className="muted small">потрачено в загруженных: {formatUsd(spent)}</span>
      </div>
      {!loading && jobs.length === 0 && <div className="empty">Здесь появятся ваши генерации</div>}
      <div className="grid">
        {cards.map(({ job, index, out }) => {
          const model = getModel(job.modelId);
          const key = `${job.id}-${index}`;
          if (!out) {
            const pending = !isTerminal(job.status);
            return (
              <div key={key} className={`card ${pending ? "pending" : "failed"}`}>
                <div className="card-media placeholder">
                  {pending ? (
                    <>
                      <div className="spinner big" />
                      <div className="small">{STATUS_LABEL[job.status]} · <Elapsed from={job.createdAt} /></div>
                    </>
                  ) : (
                    <div className="err-box small">{STATUS_LABEL[job.status]}{job.error ? `: ${job.error}` : ""}</div>
                  )}
                </div>
                <div className="card-meta">
                  <span>{model?.name ?? job.modelId}</span>
                  <div className="row gap4">
                    {pending && job.status === "queued" && job.providerRequestId && (
                      <button className="iconbtn" title="Отменить" onClick={() => onCancel(job)}><Icon name="stop" size={14} /></button>
                    )}
                    <button className="iconbtn" title="Повторить настройки" onClick={() => onReuse(job)}><Icon name="reuse" size={14} /></button>
                    {!pending && <button className="iconbtn" title="Удалить" onClick={() => onDelete(job)}><Icon name="trash" size={14} /></button>}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={key} className="card">
              <div className="card-media" onClick={() => setOpen({ job, index })}>
                {out.type === "video" ? (
                  <video src={out.url} muted loop playsInline preload="metadata"
                    onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                ) : (
                  <img src={out.url} alt={job.prompt} loading="lazy" draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/uri-list", out.url)} />
                )}
                <div className="card-overlay">
                  <div className="row gap4">
                    {onUseAsInput && out.type === "image" && (
                      <button className="iconbtn dark" title="Использовать как референс" onClick={(e) => { e.stopPropagation(); onUseAsInput(out.url); }}><Icon name="plus" size={14} /></button>
                    )}
                    {out.type === "image" && (
                      <button className="iconbtn dark" title="В чат" onClick={(e) => { e.stopPropagation(); sendToChat({ images: [out.url] }); }}><Icon name="chat" size={14} /></button>
                    )}
                    <a className="iconbtn dark" href={out.url} download target="_blank" rel="noreferrer" title="Скачать" onClick={(e) => e.stopPropagation()}><Icon name="download" size={14} /></a>
                  </div>
                </div>
              </div>
              <div className="card-meta">
                <span title={job.prompt}>{model?.name ?? job.modelId} · {formatUsd(job.cost)}</span>
                <div className="row gap4">
                  <button className="iconbtn" title="Повторить настройки" onClick={() => onReuse(job)}><Icon name="reuse" size={14} /></button>
                  <button className="iconbtn" title="Удалить" onClick={() => onDelete(job)}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {loading && <div className="center pad"><div className="spinner" /></div>}
      {hasMore && !loading && <div className="center pad"><button className="btn" onClick={onLoadMore}>Показать ещё</button></div>}

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
                  <button className="btn" onClick={() => { onReuse(open.job); setOpen(null); }}><Icon name="reuse" size={14} /> Повторить настройки</button>
                  {onUseAsInput && out.type === "image" && (
                    <button className="btn" onClick={() => { onUseAsInput(out.url); setOpen(null); }}><Icon name="plus" size={14} /> Как референс</button>
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
    </section>
  );
}
