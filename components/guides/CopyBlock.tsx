"use client";
import { useState } from "react";

// Блок с промптом или командой и кнопкой «Скопировать»
export function CopyBlock({ text, label, copyLabel, doneLabel }: { text: string; label?: string; copyLabel: string; doneLabel: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* буфер недоступен — текст можно выделить руками */
    }
  };
  return (
    <div className="gd-copy">
      <div className="gd-copy-head">
        <span>{label}</span>
        <button type="button" className="gd-copy-btn" onClick={copy}>{done ? doneLabel : copyLabel}</button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
