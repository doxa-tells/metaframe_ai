"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";
import { PillPopover } from "./Popover";
import { PROMPT_ENGINEER_TEMPLATE } from "@/lib/chat";
import { deleteChatApi, getChat, listChats, saveChat, timeAgo, uploadFile, type ChatMeta, type ChatMsg, type ChatRecord } from "@/lib/client";

const MAX_IMAGES = 6;
const isUrl = (u: string) => /^(https?:\/\/|\/)/.test(u);

const STORE_KEY = "chatHistory.v1";

// Делим ответ на текст и блоки кода (готовые промпты)
function splitBlocks(text: string): { type: "text" | "code"; value: string }[] {
  const out: { type: "text" | "code"; value: string }[] = [];
  const re = /```[a-zA-Z]*\n?([\s\S]*?)(```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "code", value: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.filter((b) => b.value.trim());
}

function MessageBody({ text, streaming }: { text: string; streaming?: boolean }) {
  const { insertPrompt, canInsert } = useApp();
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <>
      {splitBlocks(text).map((b, i) =>
        b.type === "text" ? (
          <div key={i} className="msg-text">{b.value.trim()}</div>
        ) : (
          <div key={i} className="prompt-block">
            <pre>{b.value}</pre>
            {!streaming && <div className="prompt-actions">
              {canInsert && (
                <button className="btn tiny accent" onClick={() => insertPrompt(b.value)}>
                  <Icon name="insert" size={14} /> В промпт
                </button>
              )}
              <button className="btn tiny" onClick={() => { navigator.clipboard?.writeText(b.value); setCopied(i); setTimeout(() => setCopied(null), 1200); }}>
                <Icon name="copy" size={14} /> {copied === i ? "Скопировано" : "Копировать"}
              </button>
            </div>}
          </div>
        ),
      )}
    </>
  );
}

const CURRENT_KEY = "chat.current";

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const { pendingChat, consumePendingChat, config } = useApp();
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chat, setChat] = useState<ChatRecord | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInstr, setShowInstr] = useState(false);
  const [instrDraft, setInstrDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [nameDraft, setNameDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = chat?.messages ?? [];

  const refreshList = useCallback(async () => {
    try { setChats(await listChats()); } catch (e) { setError((e as Error).message); }
  }, []);

  async function open(id: string) {
    setLoading(true);
    try {
      const c = await getChat(id);
      if (c) { setChat(c); try { localStorage.setItem(CURRENT_KEY, c.id); } catch { /* ignore */ } }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); setShowInstr(false); setRenaming(false); }
  }

  async function create(name?: string, msgs: ChatMsg[] = []) {
    const n = name ?? `Проект ${chats.length + 1}`;
    const c = await saveChat({ name: n, instructions: "", messages: msgs });
    setChat(c);
    try { localStorage.setItem(CURRENT_KEY, c.id); } catch { /* ignore */ }
    await refreshList();
    return c;
  }

  // Первый запуск: список проектов; старая общая история переносится в чат «Общий»
  useEffect(() => {
    (async () => {
      try {
        const list = await listChats();
        setChats(list);
        let cur: string | null = null;
        try { cur = localStorage.getItem(CURRENT_KEY); } catch { /* ignore */ }
        if (cur && list.some((c) => c.id === cur)) { await open(cur); return; }
        if (list.length) { await open(list[0].id); return; }
        let legacy: ChatMsg[] = [];
        try { legacy = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { /* ignore */ }
        await create("Общий", legacy);
        try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  useEffect(() => {
    if (!pendingChat) return;
    if (pendingChat.text) setInput((v) => (v ? v + "\n" : "") + pendingChat.text);
    if (pendingChat.images?.length) setImages((v) => [...v, ...pendingChat.images!].slice(0, 6));
    consumePendingChat();
  }, [pendingChat, consumePendingChat]);

  // Картинки в чат: перетаскиванием (из галереи, рефов, с компьютера) и вставкой из буфера
  const addImages = (urls: string[]) => setImages((v) => [...new Set([...v, ...urls])].slice(0, MAX_IMAGES));
  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES);
    if (!imgs.length) { if (files.length) setError("В чат можно добавить только изображения"); return; }
    setError(null);
    setUploading((n) => n + imgs.length);
    const res = await Promise.all(imgs.map((f) => uploadFile(f, config?.storage ?? "local").catch((e: Error) => { setError(e.message); return null; }).finally(() => setUploading((n) => n - 1))));
    addImages(res.filter((u): u is string => Boolean(u)));
  }
  const acceptsDrag = (e: React.DragEvent) => ["Files", "text/uri-list", "text/plain"].some((t) => e.dataTransfer.types.includes(t));
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) { addFiles(Array.from(e.dataTransfer.files)); return; }
    const raw = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    const urls = raw.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#") && isUrl(x));
    if (urls.length) addImages(urls);
  }
  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.items).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter((f): f is File => Boolean(f));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  }

  async function persist(next: ChatRecord) {
    try { await saveChat(next); refreshList(); } catch (e) { setError((e as Error).message); }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !images.length) || busy || !chat) return;
    const userMsg: ChatMsg = { role: "user", content: text, images: images.length ? images : undefined };
    const history = [...chat.messages, userMsg];
    const base = chat;
    setChat({ ...base, messages: [...history, { role: "assistant", content: "" }] });
    setInput("");
    setImages([]);
    setBusy(true);
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, system: base.instructions }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setChat({ ...base, messages: [...history, { role: "assistant", content: acc }] });
      }
    } catch (e) {
      acc = `⚠️ ${(e as Error).message}`;
    } finally {
      const final = { ...base, messages: [...history, { role: "assistant" as const, content: acc }] };
      setChat(final);
      setBusy(false);
      persist(final);
    }
  }

  async function rename() {
    if (!chat) return;
    const name = nameDraft.trim() || chat.name;
    const next = { ...chat, name };
    setChat(next); setRenaming(false);
    await persist(next);
  }
  async function saveInstructions() {
    if (!chat) return;
    const next = { ...chat, instructions: instrDraft };
    setChat(next); setShowInstr(false);
    await persist(next);
  }
  async function clearHistory() {
    if (!chat || !confirm(`Очистить историю «${chat.name}»? Инструкции проекта останутся.`)) return;
    const next = { ...chat, messages: [] };
    setChat(next);
    await persist(next);
  }
  async function remove() {
    if (!chat || !confirm(`Удалить проект «${chat.name}» вместе с историей?`)) return;
    try {
      await deleteChatApi(chat.id);
      const rest = chats.filter((c) => c.id !== chat.id);
      setChats(rest);
      if (rest.length) await open(rest[0].id); else await create("Общий");
    } catch (e) { setError((e as Error).message); }
  }

  const engine = config?.providers.anthropic ? "Claude" : config?.providers.google ? "Gemini" : config?.mock ? "тест" : "не настроен";

  return (
    <aside className={`chat ${dragOver ? "drag" : ""}`}
      onDragOver={(e) => { if (acceptsDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!dragOver) setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}>
      {dragOver && <div className="chat-drop"><Icon name="image" size={22} /><span>Отпустите, чтобы добавить в чат</span></div>}
      <div className="chat-head">
        <div className="chat-head-main">
          {renaming ? (
            <input className="chat-rename" autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setRenaming(false); }} onBlur={rename} />
          ) : (
            <PillPopover placement="down" width={290} title="Проекты" className="chat-switch"
              label={<><span className="chat-title">{chat?.name ?? "Чат"}</span><Icon name="chevron" size={14} /></>}>
              {(close) => (
                <div className="chat-list">
                  <div className="pop-title">Проекты</div>
                  <div className="opt-list">
                    {chats.map((c) => (
                      <button key={c.id} type="button" className={`opt chat-opt ${c.id === chat?.id ? "on" : ""}`} disabled={busy}
                        onClick={() => { close(); if (c.id !== chat?.id) open(c.id); }}>
                        <span className="chat-opt-name">{c.name}</span>
                        <span className="opt-hint">{c.count} сообщ.{c.hasInstructions ? " · свои инструкции" : ""} · {timeAgo(c.updatedAt)}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn wide" disabled={busy} onClick={async () => { close(); await create(); }}>
                    <Icon name="plus" size={14} /> Новый проект
                  </button>
                </div>
              )}
            </PillPopover>
          )}
          <div className="muted small">{engine} · отдельный контекст{chat?.instructions?.trim() ? " · свои инструкции" : ""}</div>
        </div>
        <div className="row gap4">
          <button className="iconbtn" title="Переименовать" disabled={!chat} onClick={() => { setNameDraft(chat?.name ?? ""); setRenaming(true); }}><Icon name="pencil" size={15} /></button>
          <button className={`iconbtn ${showInstr ? "on" : ""}`} title="Инструкции проекта" disabled={!chat} onClick={() => { setInstrDraft(chat?.instructions ?? ""); setShowInstr(!showInstr); }}><Icon name="sliders" size={15} /></button>
          <button className="iconbtn" title="Очистить историю" disabled={!chat || busy} onClick={clearHistory}><Icon name="refresh" size={15} /></button>
          <button className="iconbtn" title="Удалить проект" disabled={!chat || busy} onClick={remove}><Icon name="trash" size={15} /></button>
          <button className="iconbtn" title="Свернуть" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
      </div>

      {showInstr && chat && (
        <div className="chat-instr">
          <div className="row between">
            <b className="small">Инструкции проекта</b>
            <button className="btn tiny" onClick={() => setInstrDraft(PROMPT_ENGINEER_TEMPLATE)} title="Подставить готовые инструкции промпт-инженера">Шаблон: промпт-инженер</button>
          </div>
          <textarea rows={7} value={instrDraft} onChange={(e) => setInstrDraft(e.target.value)}
            placeholder="Необязательно. Контекст и правила только для этого проекта: о чём проект, стиль, персонажи, бренд… Пусто — чат без правил." />
          <div className="row gap8">
            <button className="btn accent" onClick={saveInstructions}>Сохранить</button>
            <button className="btn" onClick={() => setShowInstr(false)}>Отмена</button>
          </div>
        </div>
      )}

      <div className="chat-body" ref={scrollRef}>
        {error && <div className="err small">{error}</div>}
        {loading && <div className="center pad"><div className="spinner" /></div>}
        {!loading && chat && messages.length === 0 && (
          <div className="chat-empty">
            <p>Новый разговор в проекте «{chat.name}». Он видит только свою историю{chat.instructions?.trim() ? " и инструкции проекта" : ""} — другие проекты ему неизвестны.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.images && (
              <div className="msg-images">{m.images.map((u) => <img key={u} src={u} alt="" />)}</div>
            )}
            {m.role === "assistant" ? (
              m.content ? <MessageBody text={m.content} streaming={busy && i === messages.length - 1} /> : <div className="typing"><span /><span /><span /></div>
            ) : (
              <div className="msg-text">{m.content}</div>
            )}
          </div>
        ))}
      </div>
      <div className="chat-input">
        {(images.length > 0 || uploading > 0) && (
          <div className="attach-row">
            {images.map((u) => (
              <div key={u} className="attach">
                <img src={u} alt="" />
                <button onClick={() => setImages(images.filter((x) => x !== u))}><Icon name="x" size={12} /></button>
              </div>
            ))}
            {Array.from({ length: uploading }, (_, i) => <div key={"up" + i} className="attach loading"><div className="spinner" /></div>)}
          </div>
        )}
        <textarea
          value={input}
          placeholder="Сообщение… (картинки можно перетащить или вставить)"
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={3}
        />
        <button className="btn accent sendbtn" disabled={busy || uploading > 0 || !chat || (!input.trim() && !images.length)} onClick={send}>
          <Icon name="send" size={16} />
        </button>
      </div>
    </aside>
  );
}
