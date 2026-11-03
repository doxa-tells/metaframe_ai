"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Кнопка с выпадающей панелью; закрывается по клику снаружи и Esc.
// variant="pill" — таблетка (панель открывается вверх), "card" — карточка параметра (панель вниз).
export function PillPopover({
  label, children, title, active, width = 240, align = "left", className = "", variant = "pill", placement,
}: {
  label: ReactNode; children: (close: () => void) => ReactNode; title?: string; active?: boolean;
  width?: number; align?: "left" | "right"; className?: string; variant?: "pill" | "card"; placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const place = placement ?? (variant === "card" ? "down" : "up");
  return (
    <div className={`pop-wrap ${className}`} ref={ref}>
      <button type="button" className={`${variant === "card" ? "pcard" : "pill"} ${open || active ? "on" : ""}`} onClick={() => setOpen(!open)} title={title}>
        {label}
      </button>
      {open && (
        <div className={`popover ${align} ${place}`} style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function OptionList<T extends string>({
  options, value, onPick, grid,
}: { options: { value: T; label: ReactNode; hint?: ReactNode }[]; value: T; onPick: (v: T) => void; grid?: boolean }) {
  return (
    <div className={`opt-list ${grid ? "grid" : ""}`}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`opt ${o.value === value ? "on" : ""}`} onClick={() => onPick(o.value)}>
          <span>{o.label}</span>
          {o.hint && <span className="opt-hint">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}
