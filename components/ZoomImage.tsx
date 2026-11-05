"use client";
import { useEffect, useRef, useState } from "react";

// Картинка в окне просмотра: клик — приблизить в точку (и обратно), колесо — масштаб,
// мышь — осмотр по движению курсора, на телефоне — перетаскивание пальцем.
export function ZoomImage({ src, placeholder, onSwipe, zoomRef }: {
  src: string; placeholder?: string; onSwipe?: (dir: 1 | -1) => void;
  zoomRef?: { current: { zoomed: boolean; reset: () => void } | null };
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; type: string } | null>(null);

  useEffect(() => { setScale(1); setOrigin({ x: 50, y: 50 }); setLoaded(false); }, [src]);
  useEffect(() => {
    if (!zoomRef) return;
    zoomRef.current = { zoomed: scale > 1, reset: () => setScale(1) };
    return () => { zoomRef.current = null; };
  });

  const pct = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };

  // Колесо/щипок на тачпаде: масштаб от 1 до 6 вокруг курсора
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setOrigin(pct(e));
      setScale((s) => {
        const next = Math.min(6, Math.max(1, s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
        return next < 1.03 ? 1 : next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={box} className={`zoom ${scale > 1 ? "zoomed" : ""}`}
      onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } drag.current = { x: e.clientX, y: e.clientY, ox: origin.x, oy: origin.y, moved: false, type: e.pointerType }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (scale > 1 && e.pointerType === "mouse" && !d) { setOrigin(pct(e)); return; }
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
        if (scale > 1 && d.moved) {
          // Тянем картинку пальцем/мышью: точка осмотра сдвигается в обратную сторону
          const r = box.current!.getBoundingClientRect();
          const k = 100 / (scale - 1);
          setOrigin({ x: Math.min(100, Math.max(0, d.ox - (dx / r.width) * k)), y: Math.min(100, Math.max(0, d.oy - (dy / r.height) * k)) });
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (d.moved) {
          if (scale === 1 && onSwipe && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
          return;
        }
        if (scale > 1) { setScale(1); return; }
        setOrigin(pct(e));
        setScale(2.5);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={(e) => e.preventDefault()}>
      {placeholder && !loaded && <img className="zoom-ph" src={placeholder} alt="" draggable={false} />}
      <img src={src} alt="" draggable={false} onLoad={() => setLoaded(true)}
        style={{ transform: `scale(${scale})`, transformOrigin: `${origin.x}% ${origin.y}%`, opacity: loaded || !placeholder ? 1 : 0 }} />
      {scale > 1 && <span className="zoom-badge">{Math.round(scale * 100)}%</span>}
    </div>
  );
}
