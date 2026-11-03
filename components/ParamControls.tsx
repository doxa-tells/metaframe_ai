"use client";
import { useState } from "react";
import type { ParamSpec } from "@/lib/models";
import { SoulIdPicker } from "./SoulIdPicker";
import { Icon } from "./Icon";

type Props = {
  specs: ParamSpec[];
  values: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
};

function Control({ p, value, onChange }: { p: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (p.type) {
    case "select":
      if (p.options.length <= 4) {
        return (
          <div className="seg">
            {p.options.map((o) => (
              <button key={o.value} className={String(value) === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
            ))}
          </div>
        );
      }
      return (
        <select value={String(value ?? p.default)} onChange={(e) => onChange(e.target.value)}>
          {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case "slider":
      return (
        <div className="slider-row">
          <input type="range" min={p.min} max={p.max} step={p.step} value={Number(value ?? p.default)} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="slider-val">{Number(value ?? p.default)}{p.unit ? ` ${p.unit}` : ""}</span>
        </div>
      );
    case "toggle":
      return (
        <button className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)} aria-pressed={Boolean(value)}>
          <span />
        </button>
      );
    case "text":
      return <input type="text" value={String(value ?? "")} placeholder={p.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "seed":
      return (
        <div className="row gap4">
          <input type="number" min={1} max={1000000} placeholder="случайный" value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} />
          <button className="iconbtn" title="Случайный seed" onClick={() => onChange(1 + Math.floor(Math.random() * 999999))}><Icon name="refresh" size={14} /></button>
        </div>
      );
    case "soulid":
      return <SoulIdPicker value={(value as string) || null} onChange={onChange} />;
  }
}

export function ParamControls({ specs, values, onChange }: Props) {
  const [adv, setAdv] = useState(false);
  const basic = specs.filter((p) => !p.advanced);
  const advanced = specs.filter((p) => p.advanced);
  const hideStrength = !values.custom_reference_id;
  const render = (p: ParamSpec) => {
    if (p.key === "custom_reference_strength" && hideStrength) return null;
    return (
      <div key={p.key} className={`field ${p.type === "toggle" ? "inline" : ""}`}>
        <div className="field-label">{p.label}</div>
        <Control p={p} value={values[p.key]} onChange={(v) => onChange(p.key, v)} />
      </div>
    );
  };
  return (
    <>
      {basic.map(render)}
      {advanced.length > 0 && (
        <>
          <button className="linkbtn" onClick={() => setAdv(!adv)}>
            <Icon name="chevron" size={14} className={adv ? "rot" : ""} /> Дополнительно
          </button>
          {adv && advanced.map(render)}
        </>
      )}
    </>
  );
}
