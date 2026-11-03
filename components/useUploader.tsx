"use client";
import { useEffect, useRef, useState } from "react";
import type { InputSpec, ModeSpec } from "@/lib/models";
import { uploadFile } from "@/lib/client";
import { useApp } from "./AppContext";

const ACCEPT: Record<string, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/wav,audio/x-wav,audio/mpeg",
};
const REF_MIME = "application/x-metaframe-ref";

export type PendingUpload = { id: string; key: string; kind: string; preview: string };

const kindOf = (f: File) => (f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "image");

// Загрузка референсов для режима: выбор файла, перетаскивание, вставка из буфера, перестановка
export function useUploader(mode: ModeSpec, inputs: Record<string, string[]>, onInput: (k: string, v: string[]) => void) {
  const { config } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<InputSpec | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // Актуальные значения для асинхронных загрузок (иначе параллельные загрузки затирают друг друга)
  const latest = useRef(inputs);
  latest.current = inputs;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const valueOf = (spec: InputSpec) => (inputs[spec.key] ?? []).filter(Boolean);
  const liveValue = (key: string) => (latest.current[key] ?? []).filter(Boolean);
  const reserved = (key: string) => pendingRef.current.filter((x) => x.key === key).length;
  const freeSpec = (kind: string) => mode.inputs.find((s) => s.kind === kind && valueOf(s).length + reserved(s.key) < s.max);

  async function addFiles(files: File[], spec?: InputSpec) {
    setError(null);
    const groups = new Map<InputSpec, File[]>();
    for (const f of files) {
      const kind = kindOf(f);
      const s = spec ?? freeSpec(kind);
      if (!s) { setError(`В этом режиме нельзя добавить ${kind === "image" ? "изображение" : kind === "video" ? "видео" : "аудио"}`); continue; }
      groups.set(s, [...(groups.get(s) ?? []), f]);
    }
    await Promise.all([...groups].map(async ([s, list]) => {
      const room = s.max === 1 ? 1 : s.max - liveValue(s.key).length - reserved(s.key);
      const take = list.slice(0, Math.max(0, room));
      if (!take.length) { setError(`${s.label}: максимум ${s.max}`); return; }
      // Карточка-заглушка с превью на каждый файл
      const slots: PendingUpload[] = take.map((f) => ({
        id: Math.random().toString(36).slice(2), key: s.key, kind: kindOf(f), preview: URL.createObjectURL(f),
      }));
      setPending((cur) => [...cur, ...slots]);
      const results = await Promise.all(take.map((f) => uploadFile(f, config?.storage ?? "local").catch((e: Error) => { setError(e.message); return null; })));
      const urls = results.filter((u): u is string => Boolean(u));
      if (urls.length) onInput(s.key, s.max === 1 ? urls.slice(0, 1) : [...liveValue(s.key), ...urls].slice(0, s.max));
      setPending((cur) => cur.filter((x) => !slots.includes(x)));
      slots.forEach((x) => URL.revokeObjectURL(x.preview));
    }));
  }
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  // Вставка картинок/видео из буфера обмена (Cmd/Ctrl+V в любом месте страницы)
  const hasInputs = mode.inputs.length > 0;
  useEffect(() => {
    if (!hasInputs) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => Boolean(f) && /^(image|video|audio)\//.test(f!.type));
      if (!files.length) return;
      e.preventDefault();
      addFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [hasInputs]);

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

  // Перестановка: внутри одного входа — сдвиг, между одиночными слотами одного типа — обмен
  function moveRef(fromKey: string, from: number, toKey: string, to: number) {
    const a = mode.inputs.find((s) => s.key === fromKey);
    const b = mode.inputs.find((s) => s.key === toKey);
    if (!a || !b || a.kind !== b.kind) return;
    const src = [...valueOf(a)];
    if (fromKey === toKey) {
      if (from === to) return;
      const [item] = src.splice(from, 1);
      src.splice(to, 0, item);
      onInput(a.key, src);
      return;
    }
    const dst = [...valueOf(b)];
    const item = src[from];
    if (!item) return;
    if (b.max === 1 || dst.length >= b.max) {
      // обмен местами (в пустой одиночный слот — просто перенос)
      const at = b.max === 1 ? 0 : Math.min(to, dst.length - 1);
      const other = dst[at];
      dst[at] = item;
      if (other) src[from] = other; else src.splice(from, 1);
      onInput(a.key, src);
      onInput(b.key, dst);
    } else {
      src.splice(from, 1);
      dst.splice(Math.min(to, dst.length), 0, item);
      onInput(a.key, src);
      onInput(b.key, dst);
    }
  }

  // Свойства для миниатюры, которую можно перетаскивать
  function dragProps(spec: InputSpec, index: number) {
    const id = `${spec.key}:${index}`;
    return {
      draggable: true,
      "data-over": over === id ? "1" : undefined,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData(REF_MIME, JSON.stringify({ key: spec.key, index }));
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(REF_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (over !== id) setOver(id);
      },
      onDragLeave: () => setOver((o) => (o === id ? null : o)),
      onDragEnd: () => setOver(null),
      onDrop: (e: React.DragEvent) => {
        const raw = e.dataTransfer.getData(REF_MIME);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        const src = JSON.parse(raw) as { key: string; index: number };
        moveRef(src.key, src.index, spec.key, index);
      },
    };
  }

  function onDrop(e: React.DragEvent, spec?: InputSpec) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData(REF_MIME);
    if (raw) {
      // миниатюру бросили в слот (а не на другую миниатюру)
      if (spec) {
        const src = JSON.parse(raw) as { key: string; index: number };
        moveRef(src.key, src.index, spec.key, 0);
      }
      return;
    }
    if (e.dataTransfer.files?.length) { addFiles(Array.from(e.dataTransfer.files), spec); return; }
    const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
    if (url && /^(https?:|\/)/.test(url)) addUrl(url, spec);
  }

  const fileInput = (
    <input ref={fileRef} type="file" hidden onChange={(e) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length) addFiles(files, target.current ?? undefined);
    }} />
  );

  const isRefDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(REF_MIME);

  return { valueOf, addFiles, pick, pickAny, onDrop, dragProps, isRefDrag, pending, uploading: pending.length, error, setError, fileInput };
}
