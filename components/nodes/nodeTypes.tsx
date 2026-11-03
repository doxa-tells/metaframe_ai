"use client";
import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { useContext, createContext } from "react";
import { getModel, formatUsd, estimateCost, MODELS } from "@/lib/models";
import { MediaInput } from "../MediaInput";
import { Icon } from "../Icon";
import { buildNodeRequest } from "./engine";

export type NodeStatus = "idle" | "running" | "done" | "error";
export type FlowData = {
  text?: string;
  instruction?: string;
  url?: string;
  modelId?: string;
  params?: Record<string, unknown>;
  status?: NodeStatus;
  error?: string;
  output?: string; // текст или URL результата
  outputs?: string[];
  lastHash?: string;
  [k: string]: unknown;
};
export type FlowNode = Node<FlowData>;

// Запуск конкретной ноды пробрасывается из редактора
export const RunContext = createContext<{ runNode: (id: string) => void; running: boolean }>({ runNode: () => {}, running: false });

const PORT_COLORS: Record<string, string> = { text: "#a78bfa", image: "#2dd4bf", video: "#fb923c" };

function Port({ type, kind, id, top, label }: { type: "source" | "target"; kind: string; id: string; top: number; label: string }) {
  return (
    <>
      <Handle type={type} position={type === "source" ? Position.Right : Position.Left} id={id}
        style={{ top, background: PORT_COLORS[kind], width: 11, height: 11, border: "2px solid #111" }} />
      <div className={`port-label ${type}`} style={{ top: top - 8, color: PORT_COLORS[kind] }}>{label}</div>
    </>
  );
}

function StatusLine({ d }: { d: FlowData }) {
  if (d.status === "running") return <div className="node-status"><div className="spinner" /> Выполняется…</div>;
  if (d.status === "error") return <div className="node-status err">{d.error}</div>;
  return null;
}

function Shell({ title, icon, children, accent, id, runnable, selected }: {
  title: string; icon: string; children: React.ReactNode; accent: string; id: string; runnable?: boolean; selected?: boolean;
}) {
  const { runNode, running } = useContext(RunContext);
  const { deleteElements } = useReactFlow();
  return (
    <div className={`fnode ${selected ? "sel" : ""}`} style={{ borderTopColor: accent }}>
      <div className="fnode-head">
        <span className="row gap4"><Icon name={icon} size={14} /> {title}</span>
        <span className="row gap4 nodrag">
          {runnable && (
            <button className="iconbtn" title="Запустить эту ноду" disabled={running} onClick={() => runNode(id)}><Icon name="play" size={12} /></button>
          )}
          <button className="iconbtn" title="Удалить" onClick={() => deleteElements({ nodes: [{ id }] })}><Icon name="x" size={12} /></button>
        </span>
      </div>
      <div className="fnode-body">{children}</div>
    </div>
  );
}

export function PromptNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow();
  return (
    <Shell title="Промпт" icon="chat" accent={PORT_COLORS.text} id={id} selected={selected}>
      <textarea className="nodrag nowheel" rows={5} value={data.text ?? ""} placeholder="Текст промпта…"
        onChange={(e) => updateNodeData(id, { text: e.target.value })} />
      <Port type="source" kind="text" id="out-text" top={52} label="текст" />
    </Shell>
  );
}

export function ImageInputNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow();
  return (
    <Shell title="Изображение" icon="upload" accent={PORT_COLORS.image} id={id} selected={selected}>
      <div className="nodrag">
        <MediaInput spec={{ key: "img", label: "Файл", kind: "image", max: 1 }} value={data.url ? [data.url] : []}
          onChange={(v) => updateNodeData(id, { url: v[0] })} />
      </div>
      <Port type="source" kind="image" id="out-image" top={52} label="фото" />
    </Shell>
  );
}

export function LlmNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow();
  return (
    <Shell title="LLM: промпт" icon="sparkle" accent={PORT_COLORS.text} id={id} runnable selected={selected}>
      <Port type="target" kind="text" id="in-text" top={52} label="текст" />
      <textarea className="nodrag nowheel" rows={3} value={data.instruction ?? ""} placeholder="Инструкция: например, «Сделай промпт для Kling, 10 секунд, с движением камеры»"
        onChange={(e) => updateNodeData(id, { instruction: e.target.value })} />
      <StatusLine d={data} />
      {data.output && <div className="node-out nowheel">{data.output}</div>}
      <Port type="source" kind="text" id="out-text" top={52} label="текст" />
    </Shell>
  );
}

function ParamSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="mini-field nodrag">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

const IMAGE_MODELS = MODELS.filter((m) => m.kind === "image");
const QUALITY_KEYS = ["image_size", "size", "resolution"];

export function ImageGenNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData, getEdges } = useReactFlow();
  const modelId = data.modelId ?? "nano-banana-2.1";
  const model = getModel(modelId) ?? IMAGE_MODELS[0];
  const mode = model.modes[0];
  const p = data.params ?? {};
  const set = (k: string, v: unknown) => updateNodeData(id, { params: { ...p, [k]: v } });
  const acceptsRefs = mode.inputs.some((i) => i.key === "refs");
  const ar = mode.params.find((x) => x.key === "aspect_ratio");
  const q = mode.params.find((x) => QUALITY_KEYS.includes(x.key));
  const refs = getEdges().filter((e) => e.target === id && e.targetHandle === "in-image").length;
  const est = estimateCost(buildNodeRequest({ id, type: "imageGen", data, position: { x: 0, y: 0 } }, "", refs ? ["x"] : []));
  return (
    <Shell title="Генерация фото" icon="image" accent={PORT_COLORS.image} id={id} runnable selected={selected}>
      <Port type="target" kind="text" id="in-text" top={52} label="промпт" />
      {acceptsRefs && <Port type="target" kind="image" id="in-image" top={80} label="реф." />}
      <label className="mini-field nodrag">
        <span>Модель</span>
        <select value={model.id} onChange={(e) => updateNodeData(id, { modelId: e.target.value, params: {} })}>
          {IMAGE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <div className="mini-grid">
        {ar?.type === "select" && (
          <ParamSelect label="Формат" value={String(p.aspect_ratio ?? ar.default)} options={ar.options.map((o) => o.value)} onChange={(v) => set("aspect_ratio", v)} />
        )}
        {q?.type === "select" && (
          <ParamSelect label="Качество" value={String(p[q.key] ?? q.default)} options={q.options.map((o) => o.value)} onChange={(v) => set(q.key, v)} />
        )}
      </div>
      <StatusLine d={data} />
      {data.output && <img className="node-media" src={data.output} alt="" />}
      <div className="node-foot muted">≈{formatUsd(est)} · {model.vendor}</div>
      <Port type="source" kind="image" id="out-image" top={52} label="фото" />
    </Shell>
  );
}

export function VideoGenNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData, getEdges } = useReactFlow();
  const modelId = data.modelId ?? "kling-4.0";
  const p = data.params ?? {};
  const set = (k: string, v: unknown) => updateNodeData(id, { params: { ...p, [k]: v } });
  const isKling = modelId === "kling-4.0";
  const frames = getEdges().filter((e) => e.target === id && e.targetHandle === "in-image").length;
  const est = estimateCost(buildNodeRequest({ id, type: "videoGen", data, position: { x: 0, y: 0 } }, "x", Array(frames).fill("x")));
  return (
    <Shell title="Генерация видео" icon="video" accent={PORT_COLORS.video} id={id} runnable selected={selected}>
      <Port type="target" kind="text" id="in-text" top={52} label="промпт" />
      <Port type="target" kind="image" id="in-image" top={80} label="кадры" />
      <label className="mini-field nodrag">
        <span>Модель</span>
        <select value={modelId} onChange={(e) => updateNodeData(id, { modelId: e.target.value, params: {} })}>
          {MODELS.filter((m) => m.kind === "video").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <div className="mini-grid">
        <ParamSelect label="Длительность" value={String(p.duration ?? (isKling ? 10 : 5))}
          options={Array.from({ length: isKling ? 28 : 27 }, (_, i) => String(i + (isKling ? 3 : 4)))} onChange={(v) => set("duration", Number(v))} />
        <ParamSelect label="Разрешение" value={String(p.resolution ?? (isKling ? "1080p" : "720p"))}
          options={isKling ? ["720p", "1080p"] : ["480p", "720p", "1080p"]} onChange={(v) => set("resolution", v)} />
        {frames === 0 && (
          <ParamSelect label="Формат" value={String(p.aspect_ratio ?? "16:9")}
            options={isKling ? ["16:9", "9:16", "1:1", "21:9"] : ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]} onChange={(v) => set("aspect_ratio", v)} />
        )}
      </div>
      <div className="muted tiny-text">{frames === 0 ? "Текст → видео" : frames === 1 ? "Первый кадр → видео" : `${frames} кадра: первый, ${frames > 2 && isKling ? "промежуточные, " : ""}последний`}</div>
      <StatusLine d={data} />
      {data.output && <video className="node-media" src={data.output} controls loop playsInline />}
      <div className="node-foot muted">≈{formatUsd(est)} · {getModel(modelId)?.vendor}</div>
      <Port type="source" kind="video" id="out-video" top={52} label="видео" />
    </Shell>
  );
}

export const nodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  llm: LlmNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
};
