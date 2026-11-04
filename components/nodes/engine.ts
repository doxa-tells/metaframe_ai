"use client";
import type { Edge } from "@xyflow/react";
import { defaultParams, getMode, getModel, validateRequest, type GenRequest } from "@/lib/models";
import { generate, waitForJob } from "@/lib/client";
import type { FlowData, FlowNode } from "./nodeTypes";
import { withBase } from "@/lib/base";

type Value = { text: string[]; image: string[]; video: string[] };
const empty = (): Value => ({ text: [], image: [], video: [] });

// Сборка запроса генерации из ноды и её входов
export function buildNodeRequest(node: FlowNode, prompt: string, images: string[]): GenRequest {
  const d = node.data;
  const modelId = d.modelId ?? (node.type === "videoGen" ? "kling-4.0" : "nano-banana-2.1");
  const model = getModel(modelId)!;
  let modeId = model.modes[0].id;
  const inputs: Record<string, string[]> = {};
  if (node.type === "imageGen") {
    const refSpec = model.modes[0].inputs.find((i) => i.key === "refs");
    if (refSpec && images.length) inputs.refs = images.slice(0, refSpec.max);
  } else if (node.type === "videoGen") {
    if (images.length === 0) modeId = "text";
    else {
      modeId = "image";
      inputs.image_url = [images[0]];
      if (images.length > 1) inputs.end_image_url = [images[images.length - 1]];
      if (modelId === "kling-4.0" && images.length > 2) inputs.image_urls = images.slice(1, -1).slice(0, 8);
    }
  }
  const mode = getMode(model, modeId);
  const params: Record<string, unknown> = { ...defaultParams(mode) };
  for (const [k, v] of Object.entries(d.params ?? {})) if (mode.params.some((p) => p.key === k)) params[k] = v;
  if ("count" in params) params.count = "1";
  if ("batch_size" in params) params.batch_size = "1";
  return { modelId, modeId, prompt, params, inputs };
}

async function runLlm(instruction: string, input: string, signal: { cancelled: boolean }): Promise<string> {
  const content = [instruction || "Сделай из этого готовый промпт.", input].filter(Boolean).join("\n\n");
  const res = await fetch(withBase("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: content + "\n\nВерни ровно один готовый промпт в блоке кода." }] }),
  });
  if (!res.ok) throw new Error(`Чат: ошибка ${res.status}`);
  const text = await res.text();
  if (signal.cancelled) throw new Error("Остановлено");
  if (text.includes("⚠️")) throw new Error(text.split("⚠️")[1].trim().slice(0, 200));
  const m = /```[a-zA-Z]*\n?([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}

const hashOf = (x: unknown) => JSON.stringify(x);

export type EngineApi = {
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  update: (id: string, patch: Partial<FlowData>) => void;
};

// Выполнение графа: каждая нода считается один раз, ветки идут параллельно.
// Генерации с теми же входами и параметрами берут прошлый результат, чтобы не тратить деньги повторно.
export async function runGraph(api: EngineApi, targets: string[] | null, signal: { cancelled: boolean }, force: Set<string>) {
  const nodes = new Map(api.getNodes().map((n) => [n.id, n]));
  const edges = api.getEdges();
  const memo = new Map<string, Promise<Value>>();

  const evaluate = (id: string, stack: string[]): Promise<Value> => {
    if (stack.includes(id)) return Promise.reject(new Error("Цикл в схеме"));
    if (!memo.has(id)) memo.set(id, compute(id, [...stack, id]));
    return memo.get(id)!;
  };

  async function gather(id: string, stack: string[]) {
    const ins = edges.filter((e) => e.target === id);
    // Порядок входов — по вертикали источников, чтобы «первый кадр» был сверху
    ins.sort((a, b) => (nodes.get(a.source)?.position.y ?? 0) - (nodes.get(b.source)?.position.y ?? 0));
    const out = empty();
    for (const e of ins) {
      const v = await evaluate(e.source, stack);
      const kind = (e.targetHandle ?? "in-text").split("-")[1] as keyof Value;
      const srcKind = (e.sourceHandle ?? "out-text").split("-")[1] as keyof Value;
      out[kind].push(...v[srcKind]);
    }
    return out;
  }

  async function compute(id: string, stack: string[]): Promise<Value> {
    const node = nodes.get(id);
    if (!node) return empty();
    const d = node.data;
    const v = empty();
    if (signal.cancelled) throw new Error("Остановлено");
    switch (node.type) {
      case "prompt":
        if (d.text?.trim()) v.text.push(d.text.trim());
        return v;
      case "imageInput":
        if (d.url) v.image.push(d.url);
        return v;
      case "llm": {
        const inp = await gather(id, stack);
        const key = hashOf([d.instruction, inp.text]);
        if (!force.has(id) && d.output && d.lastHash === key) { v.text.push(d.output); return v; }
        api.update(id, { status: "running", error: undefined });
        try {
          const out = await runLlm(d.instruction ?? "", inp.text.join("\n\n"), signal);
          api.update(id, { status: "done", output: out, lastHash: key });
          v.text.push(out);
          return v;
        } catch (e) {
          api.update(id, { status: "error", error: (e as Error).message });
          throw e;
        }
      }
      case "imageGen":
      case "videoGen": {
        const inp = await gather(id, stack);
        const req = buildNodeRequest(node, inp.text.join("\n\n"), inp.image);
        const key = hashOf(req);
        const kind = node.type === "imageGen" ? "image" : "video";
        if (!force.has(id) && d.output && d.lastHash === key) { v[kind].push(d.output); return v; }
        const err = validateRequest(req);
        if (err) { api.update(id, { status: "error", error: err }); throw new Error(err); }
        api.update(id, { status: "running", error: undefined });
        try {
          let job = await generate(req);
          job = await waitForJob(job, undefined, signal);
          if (job.status !== "completed" || !job.outputs.length) throw new Error(job.error || `Статус: ${job.status}`);
          const url = job.outputs[0].url;
          api.update(id, { status: "done", output: url, lastHash: key });
          v[kind].push(url);
          return v;
        } catch (e) {
          api.update(id, { status: "error", error: (e as Error).message });
          throw e;
        }
      }
    }
    return v;
  }

  // Без явных целей запускаем все «листья» (ноды без исходящих связей)
  const ids = targets ?? [...nodes.keys()].filter((id) => !edges.some((e) => e.source === id));
  const results = await Promise.allSettled(ids.map((id) => evaluate(id, [])));
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) throw new Error(failed.map((f) => (f.reason as Error).message).filter((x, i, a) => a.indexOf(x) === i).join("; "));
}
