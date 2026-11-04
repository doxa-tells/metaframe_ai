"use client";
import { useRef, useState } from "react";
import type { InputSpec, ModeSpec, ModelSpec, ParamSpec } from "@/lib/models";
import { formatUsd } from "@/lib/models";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";
import { OptionList, PillPopover } from "./Popover";
import { MediaThumb } from "./MediaInput";
import { useUploader } from "./useUploader";
import { emblemFor, emblemWhiteFor, heroFor, modeIcon } from "@/lib/brand";

type Props = {
  models: ModelSpec[];
  model: ModelSpec;
  mode: ModeSpec;
  prompt: string;
  params: Record<string, unknown>;
  inputs: Record<string, string[]>;
  cost: number;
  validation: string | null;
  error: string | null;
  missingKey: string | null;
  onModel: (id: string) => void;
  onMode: (id: string) => void;
  onPrompt: (v: string) => void;
  onParam: (k: string, v: unknown) => void;
  onInput: (k: string, v: string[]) => void;
  onSubmit: () => void;
};

const KIND_ICON: Record<string, string> = { image: "image", video: "video", audio: "sound" };

export function VideoPanel(p: Props) {
  const { sendToChat } = useApp();
  const up = useUploader(p.mode, p.inputs, p.onInput);
  const { valueOf } = up;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const singles = p.mode.inputs.filter((s) => s.max === 1);
  const multis = p.mode.inputs.filter((s) => s.max > 1);
  const isKling = p.model.id.startsWith("kling");

  // Подстановка ссылок на референсы в промпт
  const refTokens: { token: string; label: string }[] = [];
  for (const s of multis) {
    valueOf(s).forEach((_, i) => {
      const n = i + 1;
      if (isKling) refTokens.push({ token: `@${s.kind}_${n}`, label: `${s.kind === "image" ? "Изображение" : "Видео"} ${n}` });
      else refTokens.push({ token: `[${s.kind === "image" ? "изображение" : s.kind === "video" ? "видео" : "аудио"} ${n}]`, label: `${s.kind === "image" ? "Изображение" : s.kind === "video" ? "Видео" : "Аудио"} ${n}` });
    });
  }
  function insertToken(t: string) {
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? p.prompt.length;
    const next = p.prompt.slice(0, pos) + (pos && !/\s$/.test(p.prompt.slice(0, pos)) ? " " : "") + t + " " + p.prompt.slice(pos);
    p.onPrompt(next);
    setTimeout(() => ta?.focus(), 0);
  }

  const audio = p.mode.params.find((x) => x.key === "generate_audio");
  const cards = p.mode.params.filter((x) => x.type === "select" || x.type === "slider");
  const touched = Boolean(p.prompt.trim()) || p.mode.inputs.some((s) => valueOf(s).length > 0);
  const [tried, setTried] = useState(false);
  const [nudge, setNudge] = useState(false);
  const message = up.error ?? p.error ?? p.missingKey ?? (touched || tried ? p.validation : null);
  // Кнопка всегда активна: если чего-то не хватает — подсказываем и ставим курсор в промпт
  function tryGenerate() {
    if (p.validation || p.missingKey) {
      setTried(true);
      setNudge(true);
      setTimeout(() => setNudge(false), 400);
      taRef.current?.focus();
      return;
    }
    setTried(false);
    p.onSubmit();
  }

  function slot(s: InputSpec) {
    const v = valueOf(s)[0];
    const pend = up.pending.find((x) => x.key === s.key);
    return (
      <div key={s.key} className={`vslot ${dragKey === s.key ? "drag" : ""} ${v ? "filled" : ""}`}
        {...(v ? { draggable: true, onDragStart: up.dragProps(s, 0).onDragStart } : {})}
        onDragOver={(e) => { e.preventDefault(); setDragKey(s.key); }}
        onDragLeave={() => setDragKey(null)}
        onDrop={(e) => { setDragKey(null); up.onDrop(e, s); }}
        onClick={() => !v && up.pick(s)}>
        {pend ? (
          <>
            {pend.kind === "image" ? <img className="pend" src={pend.preview} alt="" draggable={false} /> : <video className="pend" src={pend.preview} muted draggable={false} />}
            <div className="vslot-loading"><div className="spinner" /></div>
          </>
        ) : v ? (
          <>
            <MediaThumb url={v} kind={s.kind} />
            <button className="vx" onClick={(e) => { e.stopPropagation(); p.onInput(s.key, []); }} aria-label="Убрать"><Icon name="x" size={12} /></button>
          </>
        ) : (
          <div className="vslot-empty"><Icon name="plus" size={18} /></div>
        )}
        <span className="vslot-label">{s.label}{s.required ? " *" : ""}</span>
      </div>
    );
  }

  function cardFor(spec: ParamSpec, idx: number) {
    const align = idx % 2 === 1 ? "right" : "left";
    const v = p.params[spec.key];
    if (spec.type === "select") {
      const cur = spec.options.find((o) => o.value === String(v ?? spec.default));
      return (
        <PillPopover key={spec.key} variant="card" width={220} title={spec.label} placement="up" align={align}
          label={<><span className="pc-label">{spec.label}</span><span className="pc-value">{cur?.label ?? String(v)}</span><Icon name="chevron" size={14} className="pc-chev" /></>}>
          {(close) => <OptionList grid={spec.options.every((o) => o.label.length <= 6)} options={spec.options} value={String(v ?? spec.default)} onPick={(x) => { p.onParam(spec.key, x); close(); }} />}
        </PillPopover>
      );
    }
    if (spec.type === "slider") {
      const n = Number(v ?? spec.default);
      return (
        <PillPopover key={spec.key} variant="card" width={260} title={spec.label} placement="up" align={align}
          label={<><span className="pc-label">{spec.label}</span><span className="pc-value">{n}{spec.unit ?? ""}</span><Icon name="chevron" size={14} className="pc-chev" /></>}>
          {() => (
            <>
              <div className="pop-title">{spec.label}: <b>{n} {spec.unit}</b></div>
              <input type="range" className="pop-range" min={spec.min} max={spec.max} step={spec.step} value={n}
                onChange={(e) => p.onParam(spec.key, Number(e.target.value))} />
              <div className="quick">
                {[spec.min, 5, 10, 15, 20, spec.max].filter((x, i, a) => x >= spec.min && x <= spec.max && a.indexOf(x) === i).map((x) => (
                  <button key={x} className={x === n ? "on" : ""} onClick={() => p.onParam(spec.key, x)}>{x}{spec.unit}</button>
                ))}
              </div>
            </>
          )}
        </PillPopover>
      );
    }
    return null;
  }

  return (
    <aside className="vpanel">
      {p.model.modes.length > 1 && (
        <div className="vtabs">
          {p.model.modes.map((m) => (
            <button key={m.id} className={m.id === p.mode.id ? "on" : ""} onClick={() => p.onMode(m.id)} title={m.label}>
              <img className="tabicon" src={modeIcon(m.id)} alt="" draggable={false} />{m.label.split(" → ")[0]}
            </button>
          ))}
        </div>
      )}

      <div className="vscroll">
        <PillPopover variant="card" className="hero-wrap" width={340} title="Сменить модель"
          label={
            <div className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.82) 0%, rgba(0,0,0,.45) 55%, rgba(0,0,0,0) 100%), url(${heroFor(p.model.id)})` }}>
              <img className="hero-emblem" src={emblemWhiteFor(p.model.id)} alt="" draggable={false} />
              <span className="hero-change"><Icon name="pencil" size={13} /> Сменить</span>
              <div className="hero-title">{p.mode.label.toUpperCase()}</div>
              <div className="hero-sub">{p.model.name}</div>
            </div>
          }>
          {(close) => (
            <div className="opt-list">
              {p.models.map((m) => (
                <button key={m.id} type="button" className={`opt model with-emblem ${m.id === p.model.id ? "on" : ""}`} onClick={() => { p.onModel(m.id); close(); }}>
                  <img className="opt-emblem" src={emblemFor(m.id)} alt="" draggable={false} />
                  <span className="opt-body">
                    <b>{m.name}</b>
                    <span className="opt-hint">{m.vendor} · {m.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </PillPopover>

        {singles.length > 0 && <div className="vslots">{singles.map(slot)}</div>}

        {multis.length > 0 && (() => {
          const all = multis.flatMap((s) => valueOf(s).map((u, i) => ({ s, u, i })));
          const pend = up.pending.filter((x) => multis.some((s) => s.key === x.key));
          const total = multis.reduce((n, s) => n + s.max, 0);
          return (
            <div className={`vdrop ${dragKey === "multi" ? "drag" : ""} ${all.length ? "has" : ""}`}
              onDragOver={(e) => { e.preventDefault(); if (!up.isRefDrag(e)) setDragKey("multi"); }}
              onDragLeave={() => setDragKey(null)}
              onDrop={(e) => { setDragKey(null); up.onDrop(e); }}>
              {all.length === 0 && pend.length === 0 ? (
                <button className="vdrop-empty" onClick={() => up.pickAny()}>
                  <span className="vdrop-icons">{multis.map((s) => <span key={s.key}><Icon name={KIND_ICON[s.kind]} size={16} /></span>)}</span>
                  <b>{multis.length > 1 ? "Добавить референсы" : multis[0].label}</b>
                  <span className="muted small">{multis.length > 1 ? multis.map((s) => s.label.split(" (")[0]).join(", ") : multis[0].hint ?? `до ${multis[0].max} файлов`}</span>
                </button>
              ) : (
                <>
                  <div className="vdrop-head"><span>{multis.length > 1 ? "Референсы" : multis[0].label}</span><span className="muted small">{all.length + pend.length}/{total}</span></div>
                  <div className="vthumbs">
                    {all.map(({ s, u, i }) => (
                      <div key={s.key + u + i} className="vthumb" title={`${s.label} — перетащите, чтобы поменять порядок`} {...up.dragProps(s, i)}>
                        <MediaThumb url={u} kind={s.kind} />
                        <span className="tag">{s.kind === "image" ? "Ф" : s.kind === "video" ? "В" : "А"}{i + 1}</span>
                        <button onClick={() => p.onInput(s.key, valueOf(s).filter((_, j) => j !== i))} aria-label="Убрать"><Icon name="x" size={11} /></button>
                      </div>
                    ))}
                    {pend.map((f) => (
                      <div key={f.id} className="vthumb loading">
                        {f.kind === "image" ? <img src={f.preview} alt="" draggable={false} /> : f.kind === "video" ? <video src={f.preview} muted draggable={false} /> : null}
                        <div className="spinner" />
                      </div>
                    ))}
                    {all.length + pend.length < total && <button className="vthumb add" onClick={() => up.pickAny()}><Icon name="plus" size={16} /></button>}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        <div className="vprompt">
          <div className="vprompt-label">Промпт</div>
          <textarea ref={taRef} value={p.prompt} rows={5}
            placeholder={p.mode.id === "reference"
              ? `Опишите видео и роль каждого референса${isKling ? " — ссылайтесь на них через @" : ""}…`
              : p.mode.id === "image" ? "Опишите действие и движение камеры от первого кадра…" : "Опишите сцену, действие, камеру и звук…"}
            onChange={(e) => p.onPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) p.onSubmit(); }} />
          <div className="vchips">
            {refTokens.length > 0 && (
              <PillPopover width={200} placement="up" label={<><Icon name="at" size={14} /> Элементы</>} title="Вставить ссылку на референс">
                {(close) => <OptionList options={refTokens.map((t) => ({ value: t.token, label: t.label, hint: t.token }))} value=""
                  onPick={(x) => { insertToken(x); close(); }} />}
              </PillPopover>
            )}
            {audio && (
              <button className={`pill ${p.params.generate_audio ? "on" : "off"}`} onClick={() => p.onParam("generate_audio", !p.params.generate_audio)}>
                <Icon name="sound" size={14} /> {p.params.generate_audio ? "Звук вкл" : "Без звука"}
              </button>
            )}
            <button className="pill" disabled={!p.prompt.trim()} title="Улучшить промпт в чате"
              onClick={() => sendToChat({ text: `Улучши промпт для ${p.model.name} (режим «${p.mode.label}»):\n${p.prompt}` })}>
              <Icon name="sparkle" size={14} /> Улучшить
            </button>
          </div>
        </div>

        <div className="pgrid">{cards.map(cardFor)}</div>
      </div>

      <div className="vfoot">
        {(message || p.mode.hint) && <div className={`small ${message ? "err" : "muted"}`}>{message ?? p.mode.hint}</div>}
        <button className={`vgen ${nudge ? "nudge" : ""}`} onClick={tryGenerate} title={p.validation ?? p.missingKey ?? "Ctrl/Cmd + Enter"}>
          Сгенерировать <span><Icon name="sparkle" size={15} /> {formatUsd(p.cost)}</span>
        </button>
        <div className="muted tiny-text">{p.model.priceNote}</div>
      </div>
      {up.fileInput}
    </aside>
  );
}
