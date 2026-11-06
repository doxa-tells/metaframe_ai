"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { ZoomImage } from "./ZoomImage";

export type RefItem = { url: string; kind: string; label: string };

// Просмотр своих референсов (из композера и панели видео): зум, стрелки, «Назад»
export function useRefViewer() {
  const [state, setState] = useState<{ items: RefItem[]; index: number } | null>(null);
  const show = useCallback((items: RefItem[], index: number) => setState({ items, index }), []);
  const viewer = state ? <RefViewer items={state.items} index={state.index} onIndex={(index) => setState((s) => s && { ...s, index })} onClose={() => setState(null)} /> : null;
  return { show, viewer };
}

function RefViewer({ items, index, onIndex, onClose }: { items: RefItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const zoom = useRef<{ zoomed: boolean; reset: () => void } | null>(null);
  const cur = items[index];
  const go = useCallback((d: 1 | -1) => { const n = index + d; if (n >= 0 && n < items.length) onIndex(n); }, [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (zoom.current?.zoomed) zoom.current.reset(); else onClose(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); go(e.key === "ArrowRight" ? 1 : -1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onClose]);

  if (!cur) return null;
  const isVideo = cur.kind === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(cur.url);
  const isAudio = cur.kind === "audio" || /\.(wav|mp3)(\?|$)/i.test(cur.url);
  return createPortal(
    <div className="modal-bg lb-bg" onClick={onClose}>
      <div className="refview" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          {isVideo ? <video key={cur.url} src={cur.url} controls autoPlay loop playsInline />
            : isAudio ? <audio key={cur.url} src={cur.url} controls autoPlay className="lb-audio" />
            : <ZoomImage key={cur.url} src={cur.url} onSwipe={go} zoomRef={zoom} />}
          <button className="pill lb-backbtn" onClick={onClose} title="Назад (Esc)"><Icon name="back" size={15} />Назад</button>
          {index > 0 && <button className="lb-nav prev" onClick={() => go(-1)} aria-label="Предыдущий"><Icon name="left" size={22} /></button>}
          {index < items.length - 1 && <button className="lb-nav next" onClick={() => go(1)} aria-label="Следующий"><Icon name="right" size={22} /></button>}
          <span className="lb-count">Референс · {cur.label}{items.length > 1 ? ` · ${index + 1} / ${items.length}` : ""}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
