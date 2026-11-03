"use client";
import { useRef, useState } from "react";
import type { InputSpec, ModeSpec } from "@/lib/models";
import { uploadFile } from "@/lib/client";
import { useApp } from "./AppContext";

const ACCEPT: Record<string, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/wav,audio/x-wav,audio/mpeg",
};

// Загрузка референсов для режима: выбор файла, перетаскивание файлов и картинок из истории
export function useUploader(mode: ModeSpec, inputs: Record<string, string[]>, onInput: (k: string, v: string[]) => void) {
  const { config } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<InputSpec | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (spec: InputSpec) => (inputs[spec.key] ?? []).filter(Boolean);
  const freeSpec = (kind: string) => mode.inputs.find((s) => s.kind === kind && valueOf(s).length < s.max);

  async function addFiles(files: File[], spec?: InputSpec) {
    setError(null);
    const groups = new Map<InputSpec, File[]>();
    for (const f of files) {
      const kind = f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "image";
      const s = spec ?? freeSpec(kind);
      if (!s) { setError(`В этом режиме нельзя добавить ${kind === "image" ? "изображение" : kind === "video" ? "видео" : "аудио"}`); continue; }
      groups.set(s, [...(groups.get(s) ?? []), f]);
    }
    for (const [s, list] of groups) {
      const room = s.max === 1 ? 1 : s.max - valueOf(s).length;
      const take = list.slice(0, Math.max(0, room));
      if (!take.length) { setError(`${s.label}: максимум ${s.max}`); continue; }
      setUploading((n) => n + take.length);
      const urls: string[] = [];
      for (const f of take) {
        try { urls.push(await uploadFile(f, config?.storage ?? "local")); }
        catch (e) { setError((e as Error).message); }
        finally { setUploading((n) => n - 1); }
      }
      if (urls.length) onInput(s.key, s.max === 1 ? urls.slice(0, 1) : [...valueOf(s), ...urls].slice(0, s.max));
    }
  }

  function pick(spec: InputSpec) {
    target.current = spec;
    if (fileRef.current) {
      fileRef.current.accept = ACCEPT[spec.kind];
      fileRef.current.multiple = spec.max > 1;
      fileRef.current.click();
    }
  }

  // Выбор файлов любого допустимого типа: раскладываются по входам автоматически
  function pickAny() {
    target.current = null;
    if (fileRef.current) {
      fileRef.current.accept = [...new Set(mode.inputs.map((s) => ACCEPT[s.kind]))].join(",");
      fileRef.current.multiple = true;
      fileRef.current.click();
    }
  }

  function addUrl(url: string, spec?: InputSpec): boolean {
    const s = spec ?? freeSpec(/\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : "image");
    if (!s) { setError("В этом режиме нельзя добавить этот файл"); return false; }
    onInput(s.key, s.max === 1 ? [url] : [...valueOf(s), url].slice(0, s.max));
    return true;
  }

  function onDrop(e: React.DragEvent, spec?: InputSpec) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files?.length) { addFiles(Array.from(e.dataTransfer.files), spec); return; }
    const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
    if (url) addUrl(url, spec);
  }

  const fileInput = (
    <input ref={fileRef} type="file" hidden onChange={(e) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length) addFiles(files, target.current ?? undefined);
    }} />
  );

  return { valueOf, addFiles, pick, pickAny, onDrop, uploading, error, setError, fileInput };
}
