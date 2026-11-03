"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";
import { getModel } from "@/lib/models";

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };

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

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const { chatContext, pendingChat, consumePendingChat, config } = useApp();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-60))); } catch { /* ignore */ }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!pendingChat) return;
    if (pendingChat.text) setInput((v) => (v ? v + "\n" : "") + pendingChat.text);
    if (pendingChat.images?.length) setImages((v) => [...v, ...pendingChat.images!].slice(0, 6));
    consumePendingChat();
  }, [pendingChat, consumePendingChat]);

  async function send() {
    const text = input.trim();
    if ((!text && !images.length) || busy) return;
    const userMsg: Msg = { role: "user", content: text, images: images.length ? images : undefined };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setImages([]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, ...chatContext }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: acc }]);
      }
    } catch (e) {
      setMessages([...history, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const model = chatContext.modelId ? getModel(chatContext.modelId) : undefined;
  const engine = config?.providers.anthropic ? "Claude" : config?.providers.google ? "Gemini" : config?.mock ? "тест" : "не настроен";

  return (
    <aside className="chat">
      <div className="chat-head">
        <div>
          <div className="chat-title"><Icon name="sparkle" size={16} /> Промпт-ассистент</div>
          <div className="muted small">{engine}{model ? ` · под ${model.name}` : ""}</div>
        </div>
        <div className="row gap4">
          <button className="iconbtn" title="Очистить" onClick={() => setMessages([])}><Icon name="trash" size={16} /></button>
          <button className="iconbtn" title="Свернуть" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
      </div>
      <div className="chat-body" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Опишите идею своими словами — я превращу её в промпт под выбранную модель.</p>
            {["Рекламный ролик кроссовок на 10 секунд", "Портрет в стиле fashion editorial", "Улучши мой промпт"].map((s) => (
              <button key={s} className="chip" onClick={() => setInput(s)}>{s}</button>
            ))}
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
        {images.length > 0 && (
          <div className="attach-row">
            {images.map((u) => (
              <div key={u} className="attach">
                <img src={u} alt="" />
                <button onClick={() => setImages(images.filter((x) => x !== u))}><Icon name="x" size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={input}
          placeholder="Опишите, что хотите получить…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={3}
        />
        <button className="btn accent sendbtn" disabled={busy || (!input.trim() && !images.length)} onClick={send}>
          <Icon name="send" size={16} />
        </button>
      </div>
    </aside>
  );
}
