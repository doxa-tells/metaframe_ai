"use client";
import { useEffect, useRef, useState } from "react";
import type { InputSpec, ModeSpec, ModelSpec, ParamSpec } from "@/lib/models";
import { formatUsd } from "@/lib/models";
import { useApp } from "./AppContext";
import { Icon } from "./Icon";
import { OptionList, PillPopover } from "./Popover";
import { ParamControls } from "./ParamControls";
import { SoulIdPicker } from "./SoulIdPicker";
import { MediaThumb } from "./MediaInput";
import { useRefViewer } from "./RefViewer";
import { useUploader } from "./useUploader";
import { emblemFor } from "@/lib/brand";

const COUNT_KEYS = ["count", "batch_size"];
const PARAM_ICON: Record<string, string> = {
  aspect_ratio: "ratio", image_size: "gem", size: "gem", resolution: "gem", duration: "clock",
  generate_audio: "sound", enhance_prompt: "sparkle",
};
// Короткие подписи для таблеток-переключателей
const TOGGLE_LABEL: Record<string, string> = { generate_audio: "Звук", enhance_prompt: "Улучшение" };

type Props = {
  models: ModelSpec[];
  model: ModelSpec;
  mode: ModeSpec;
  prompt: string;
  params: Record<string, unknown>;
  inputs: Record<string, string[]>;
  cost: number;
  priceText?: string;
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

export function Composer(p: Props) {
  const { sendToChat } = useApp();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [drag, setDrag] = useState(false);
  const up = useUploader(p.mode, p.inputs, p.onInput);
  const refViewer = useRefViewer();
  const refList = () => p.mode.inputs.flatMap((s) => valueOf(s).map((u, i) => ({
    key: s.key, url: u, kind: s.kind, label: s.max === 1 ? s.label : `${s.label} ${i + 1}`,
  })));
  const { valueOf, uploading, pick } = up;

  // Автовысота поля промпта
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [p.prompt]);

  const mainParams = p.mode.params.filter((x) => !x.advanced && x.key !== "custom_reference_strength");
  const extraParams = p.mode.params.filter((x) => x.advanced || (x.key === "custom_reference_strength" && p.params.custom_reference_id));
  const hasThumbs = p.mode.inputs.some((s) => valueOf(s).length) || uploading > 0;
  const [tried, setTried] = useState(false);
  const [nudge, setNudge] = useState(false);
  const message = up.error ?? p.error ?? p.missingKey ?? (p.prompt.trim() || hasThumbs || tried ? p.validation : null);
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

  function renderParam(spec: ParamSpec) {
    const v = p.params[spec.key];
    const icon = PARAM_ICON[spec.key];
    if (spec.type === "select" && COUNT_KEYS.includes(spec.key)) {
      const idx = Math.max(0, spec.options.findIndex((o) => o.value === String(v ?? spec.default)));
      const max = spec.options[spec.options.length - 1].value;
      return (
        <div key={spec.key} className="stepper" title={spec.label}>
          <button type="button" disabled={idx === 0} onClick={() => p.onParam(spec.key, spec.options[idx - 1].value)}>−</button>
          <span>{spec.options[idx].value}/{max}</span>
          <button type="button" disabled={idx === spec.options.length - 1} onClick={() => p.onParam(spec.key, spec.options[idx + 1].value)}>+</button>
        </div>
      );
    }
    if (spec.type === "select") {
      const cur = spec.options.find((o) => o.value === String(v ?? spec.default));
      return (
        <PillPopover key={spec.key} title={spec.label} width={spec.options.every((o) => o.label.length <= 6) ? 250 : 210}
          label={<>{icon && <Icon name={icon} size={15} />}{cur?.label ?? String(v)}</>}>
          {(close) => (
            <>
              <div className="pop-title">{spec.label}</div>
              <OptionList grid={spec.options.every((o) => o.label.length <= 6)} options={spec.options} value={String(v ?? spec.default)} onPick={(x) => { p.onParam(spec.key, x); close(); }} />
            </>
          )}
        </PillPopover>
      );
    }
    if (spec.type === "slider") {
      const n = Number(v ?? spec.default);
      return (
        <PillPopover key={spec.key} title={spec.label} width={260}
          label={<><Icon name={icon ?? "sliders"} size={15} />{n}{spec.unit ? ` ${spec.unit}` : ""}</>}>
          {() => (
            <>
              <div className="pop-title">{spec.label}: <b>{n}{spec.unit ? ` ${spec.unit}` : ""}</b></div>
              <input type="range" className="pop-range" min={spec.min} max={spec.max} step={spec.step} value={n}
                onChange={(e) => p.onParam(spec.key, Number(e.target.value))} />
              <div className="row between muted tiny-text"><span>{spec.min}{spec.unit}</span><span>{spec.max}{spec.unit}</span></div>
            </>
          )}
        </PillPopover>
      );
    }
    if (spec.type === "toggle") {
      const on = Boolean(v);
      return (
        <button key={spec.key} type="button" className={`pill ${on ? "on" : "off"}`} onClick={() => p.onParam(spec.key, !on)} title={spec.label}>
          <Icon name={icon ?? "sparkle"} size={15} />{TOGGLE_LABEL[spec.key] ?? spec.label}
        </button>
      );
    }
    if (spec.type === "soulid") {
      return (
        <PillPopover key={spec.key} title="Soul ID — свой персонаж" width={320} active={Boolean(v)}
          label={<><Icon name="user" size={15} />{v ? "Персонаж" : "Soul ID"}</>}>
          {() => (
            <>
              <div className="pop-title">Персонаж (Soul ID)</div>
              <SoulIdPicker value={(v as string) || null} onChange={(x) => p.onParam(spec.key, x)} />
            </>
          )}
        </PillPopover>
      );
    }
    return null;
  }

  return (
    <div className={`composer ${drag ? "drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (p.mode.inputs.length && !up.isRefDrag(e)) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { setDrag(false); up.onDrop(e); }}>
      {hasThumbs && (
        <div className="comp-thumbs">
          {p.mode.inputs.map((s) => valueOf(s).map((u, i) => (
            <div key={s.key + u + i} className="comp-thumb" title={`${s.label} — нажмите, чтобы открыть; перетащите, чтобы поменять порядок`} {...up.dragProps(s, i)}
              onClick={() => { const all = refList(); refViewer.show(all, Math.max(0, all.findIndex((r) => r.url === u && r.key === s.key))); }}>
              <MediaThumb url={u} kind={s.kind} />
              <span className="tag">{s.max === 1 ? s.label : `${s.kind === "image" ? "" : s.kind === "video" ? "▶ " : "♪ "}${i + 1}`}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); p.onInput(s.key, valueOf(s).filter((_, j) => j !== i)); }} aria-label="Убрать"><Icon name="x" size={11} /></button>
            </div>
          )))}
          {refViewer.viewer}
          {up.pending.map((f) => (
            <div key={f.id} className="comp-thumb loading">
              {f.kind === "image" && <img src={f.preview} alt="" draggable={false} />}
              {f.kind === "video" && <video src={f.preview} muted draggable={false} />}
              <div className="spinner" />
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        className="comp-prompt"
        rows={2}
        value={p.prompt}
        placeholder={p.model.kind === "image" ? "Опишите изображение, которое хотите получить…" : "Опишите сцену, действие и движение камеры…"}
        onChange={(e) => p.onPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) p.onSubmit(); }}
      />

      <div className="comp-bottom">
        <div className="comp-pills">
          {p.mode.inputs.length === 0 ? (
            <button type="button" className="pill icon" disabled title="Эта модель работает без референсов"><Icon name="plus" size={16} /></button>
          ) : p.mode.inputs.length === 1 ? (
            <button type="button" className="pill icon" onClick={() => pick(p.mode.inputs[0])} title={`Добавить: ${p.mode.inputs[0].label}`}><Icon name="plus" size={16} /></button>
          ) : (
            <PillPopover label={<Icon name="plus" size={16} />} title="Добавить файл" width={230} className="icon">
              {(close) => (
                <div className="opt-list">
                  {p.mode.inputs.map((s) => (
                    <button key={s.key} type="button" className="opt" disabled={valueOf(s).length >= s.max} onClick={() => { close(); pick(s); }}>
                      <span>{s.label}{s.required ? " *" : ""}</span><span className="opt-hint">{valueOf(s).length}/{s.max}</span>
                    </button>
                  ))}
                </div>
              )}
            </PillPopover>
          )}

          {p.mode.inputs.length > 0 && up.canLibrary() && (
            <button type="button" className="pill icon" onClick={() => up.pickLibrary(p.mode.inputs.length === 1 ? p.mode.inputs[0] : undefined)} title="Добавить из своих генераций">
              <Icon name="library" size={16} />
            </button>
          )}

          <PillPopover width={330} title="Модель"
            label={<><img className="pill-emblem" src={emblemFor(p.model.id)} alt="" draggable={false} /><span className="pill-model">{p.model.name}</span><Icon name="chevron" size={13} /></>}>
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

          {p.model.modes.length > 1 && (
            <PillPopover width={220} title="Режим" label={<>{p.mode.label}<Icon name="chevron" size={13} /></>}>
              {(close) => (
                <OptionList options={p.model.modes.map((m) => ({ value: m.id, label: m.label }))} value={p.mode.id}
                  onPick={(x) => { p.onMode(x); close(); }} />
              )}
            </PillPopover>
          )}

          {mainParams.map(renderParam)}

          {extraParams.length > 0 && (
            <PillPopover width={300} title="Дополнительно" label={<Icon name="sliders" size={15} />} className="icon">
              {() => (
                <div className="pop-params">
                  <ParamControls specs={extraParams} values={p.params} onChange={p.onParam} showAll />
                </div>
              )}
            </PillPopover>
          )}

          <button type="button" className="pill icon" title="Улучшить промпт в чате" disabled={!p.prompt.trim()}
            onClick={() => sendToChat({ text: `Улучши промпт для ${p.model.name}${p.model.modes.length > 1 ? ` (режим «${p.mode.label}»)` : ""}:\n${p.prompt}` })}>
            <Icon name="sparkle" size={15} />
          </button>
        </div>

        <button type="button" className={`gen-btn ${nudge ? "nudge" : ""}`} onClick={tryGenerate}
          title={p.validation ?? p.missingKey ?? "Ctrl/Cmd + Enter"}>
          <span>СГЕНЕРИРОВАТЬ</span>
          <small>{p.priceText ?? `~${formatUsd(p.cost)}`}</small>
        </button>
      </div>

      {(message || p.mode.hint) && (
        <div className={`comp-msg ${message ? "err" : "muted"}`}>{message ?? p.mode.hint}</div>
      )}

      {up.fileInput}
    </div>
  );
}
