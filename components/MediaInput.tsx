"use client";
import { useRef, useState } from "react";
import type { InputSpec } from "@/lib/models";
import { uploadFile } from "@/lib/client";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";

const ACCEPT: Record<string, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/wav,audio/x-wav,audio/mpeg",
};

export function MediaThumb({ url, kind }: { url: string; kind: string }) {
  if (kind === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(url)) return <video src={url} muted playsInline preload="metadata" />;
  if (kind === "audio" || /\.(wav|mp3)(\?|$)/i.test(url)) return <div className="audio-thumb"><Icon name="play" size={16} /> аудио</div>;
  return <img src={url} alt="" />;
}

export function MediaInput({ spec, value, onChange }: { spec: InputSpec; value: string[]; onChange: (v: string[]) => void }) {
  const { config } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const full = value.length >= spec.max;

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files).slice(0, spec.max - value.length);
    if (!list.length) return;
    setUploading((n) => n + list.length);
    const urls: string[] = [];
    for (const f of list) {
      try {
        urls.push(await uploadFile(f, config?.storage ?? "local"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    onChange([...value, ...urls].slice(0, spec.max));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) { addFiles(e.dataTransfer.files); return; }
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url && !full) onChange([...value, url.trim()].slice(0, spec.max));
  }

  return (
    <div className="field">
      <div className="field-label">
        {spec.label}{spec.required && <span className="req">*</span>}
        <span className="muted small"> {value.length}/{spec.max}{spec.hint ? ` · ${spec.hint}` : ""}</span>
      </div>
      <div
        className={`media-input ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {value.map((u, i) => (
          <div key={u + i} className="media-item">
            <MediaThumb url={u} kind={spec.kind} />
            {spec.max > 1 && <span className="idx">{i + 1}</span>}
            <button className="rm" onClick={() => onChange(value.filter((_, j) => j !== i))} title="Убрать"><Icon name="x" size={12} /></button>
          </div>
        ))}
        {uploading > 0 && <div className="media-item loading"><div className="spinner" /></div>}
        {!full && (
          <button className="media-add" onClick={() => fileRef.current?.click()} title="Добавить файл">
            <Icon name="plus" size={18} />
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple={spec.max > 1}
          accept={ACCEPT[spec.kind]}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>
      {error && <div className="err small">{error}</div>}
    </div>
  );
}
