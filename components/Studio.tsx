"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MODELS, defaultParams, estimateCost, formatUsd, getMode, getModel, validateRequest, type Kind } from "@/lib/models";
import { cancelJob, deleteJob, generate, isTerminal, listJobs, waitForJob, type Job } from "@/lib/client";
import { useApp } from "./AppContext";
import { History } from "./History";
import { MediaInput } from "./MediaInput";
import { ParamControls } from "./ParamControls";
import { Icon } from "./Icon";

type FormState = {
  modelId: string;
  modeId: string;
  prompt: string;
  params: Record<string, Record<string, unknown>>; // по ключу model:mode
  inputs: Record<string, Record<string, string[]>>;
};

const k = (m: string, mode: string) => `${m}:${mode}`;

function initialForm(kind: Kind): FormState {
  const model = MODELS.find((m) => m.kind === kind)!;
  return { modelId: model.id, modeId: model.modes[0].id, prompt: "", params: {}, inputs: {} };
}

export function Studio({ kind }: { kind: Kind }) {
  const { registerInsert, setChatContext, sendToChat, config } = useApp();
  const storeKey = `studio.${kind}.v1`;
  const [form, setForm] = useState<FormState>(() => initialForm(kind));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelMenu, setModelMenu] = useState(false);
  const loaded = useRef(false);
  const polling = useRef(new Set<string>());
  const alive = useRef({ cancelled: false });

  const model = getModel(form.modelId) ?? MODELS.find((m) => m.kind === kind)!;
  const mode = getMode(model, form.modeId);
  const key = k(model.id, mode.id);
  const params = useMemo(() => ({ ...defaultParams(mode), ...(form.params[key] ?? {}) }), [mode, form.params, key]);
  const inputs = form.inputs[key] ?? {};

  // Восстановление формы
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw) as FormState;
        if (getModel(saved.modelId)?.kind === kind) setForm(saved);
      }
    } catch { /* ignore */ }
    loaded.current = true;
  }, [storeKey, kind]);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(storeKey, JSON.stringify(form)); } catch { /* ignore */ }
  }, [form, storeKey]);

  useEffect(() => { setChatContext({ modelId: model.id, modeId: mode.id }); }, [model.id, mode.id, setChatContext]);
  useEffect(() => {
    registerInsert((text) => setForm((f) => ({ ...f, prompt: text })));
    return () => registerInsert(null);
  }, [registerInsert]);

  // История
  const load = useCallback(async (c?: string) => {
    setLoading(true);
    try {
      const r = await listJobs(kind, c);
      setJobs((prev) => {
        const map = new Map((c ? prev : []).map((j) => [j.id, j]));
        for (const j of r.jobs) if (!map.has(j.id)) map.set(j.id, j);
        // сохраняем только что созданные задачи, которых ещё нет в списке
        for (const j of prev) if (!map.has(j.id) && Date.now() - j.createdAt < 120000) map.set(j.id, j);
        return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
      });
      setCursor(r.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => {
    alive.current = { cancelled: false };
    load();
    return () => { alive.current.cancelled = true; };
  }, [load]);

  // Опрос незавершённых задач
  const updateJob = useCallback((j: Job) => setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, ...j } : x))), []);
  useEffect(() => {
    for (const j of jobs) {
      if (isTerminal(j.status) || !j.providerRequestId || polling.current.has(j.id)) continue;
      polling.current.add(j.id);
      const signal = alive.current;
      waitForJob(j, updateJob, signal).finally(() => polling.current.delete(j.id));
    }
  }, [jobs, updateJob]);

  function setModel(id: string) {
    const m = getModel(id)!;
    setForm((f) => ({ ...f, modelId: id, modeId: m.modes.some((x) => x.id === f.modeId) ? f.modeId : m.modes[0].id }));
    setModelMenu(false);
  }
  function setParam(pk: string, v: unknown) {
    setForm((f) => ({ ...f, params: { ...f.params, [key]: { ...params, [pk]: v } } }));
  }
  function setInput(ik: string, v: string[]) {
    setForm((f) => ({ ...f, inputs: { ...f.inputs, [key]: { ...inputs, [ik]: v } } }));
  }

  const request = { modelId: model.id, modeId: mode.id, prompt: form.prompt, params, inputs };
  const validation = validateRequest(request);
  const cost = estimateCost(request);
  const KEY_ENV = { google: "GEMINI_API_KEY", byteplus: "ARK_API_KEY", higgsfield: "HF_API_KEY" } as const;
  const providerReady = !config || config.mock || config.providers[model.provider];

  async function submit() {
    if (validation || submitting) return;
    setSubmitting(true);
    setError(null);
    const tempId = `temp-${Date.now()}`;
    const temp: Job = {
      id: tempId, kind, modelId: model.id, modeId: mode.id, prompt: form.prompt, params, inputs,
      cost, provider: model.provider, status: "in_progress", outputs: [], createdAt: Date.now(),
    };
    setJobs((prev) => [temp, ...prev]);
    try {
      const job = await generate(request);
      setJobs((prev) => prev.map((j) => (j.id === tempId ? job : j)));
      if (job.status === "failed") setError(job.error ?? "Ошибка генерации");
    } catch (e) {
      setJobs((prev) => prev.filter((j) => j.id !== tempId));
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function reuse(job: Job) {
    const kk = k(job.modelId, job.modeId);
    setForm((f) => ({
      ...f, modelId: job.modelId, modeId: job.modeId, prompt: job.prompt,
      params: { ...f.params, [kk]: job.params }, inputs: { ...f.inputs, [kk]: job.inputs },
    }));
  }
  const imageInput = mode.inputs.find((i) => i.kind === "image");
  function useAsInput(url: string) {
    if (!imageInput) return;
    const cur = inputs[imageInput.key] ?? [];
    if (cur.length >= imageInput.max) { setError(`${imageInput.label}: максимум ${imageInput.max}`); return; }
    setInput(imageInput.key, [...cur, url]);
  }
  async function remove(job: Job) {
    if (!confirm("Удалить генерацию?")) return;
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    try { await deleteJob(job.id); } catch (e) { setError((e as Error).message); }
  }
  async function cancel(job: Job) {
    try { await cancelJob(job); } catch (e) { setError((e as Error).message); }
  }

  const models = MODELS.filter((m) => m.kind === kind);

  return (
    <div className="studio">
      <section className="panel">
        <div className="model-picker">
          <button className="model-current" onClick={() => setModelMenu(!modelMenu)}>
            <div>
              <div className="model-name">{model.name} {model.badge && <span className="badge">{model.badge}</span>}</div>
              <div className="muted small">{model.vendor} · {model.description}</div>
            </div>
            <Icon name="chevron" size={16} className={modelMenu ? "rot" : ""} />
          </button>
          {modelMenu && (
            <div className="model-menu">
              {models.map((m) => (
                <button key={m.id} className={`model-opt ${m.id === model.id ? "on" : ""}`} onClick={() => setModel(m.id)}>
                  <div className="model-name">{m.name} {m.badge && <span className="badge">{m.badge}</span>}</div>
                  <div className="muted small">{m.vendor} · {m.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {model.modes.length > 1 && (
          <div className="tabs">
            {model.modes.map((m) => (
              <button key={m.id} className={m.id === mode.id ? "on" : ""} onClick={() => setForm((f) => ({ ...f, modeId: m.id }))}>{m.label}</button>
            ))}
          </div>
        )}
        {mode.hint && <div className="hint small">{mode.hint}</div>}

        {mode.inputs.map((spec) => (
          <MediaInput key={key + spec.key} spec={spec} value={inputs[spec.key] ?? []} onChange={(v) => setInput(spec.key, v)} />
        ))}

        <div className="field">
          <div className="field-label row between">
            <span>Промпт{mode.promptRequired && <span className="req">*</span>}</span>
            <button className="linkbtn" disabled={!form.prompt.trim()} onClick={() => sendToChat({ text: `Улучши промпт для ${model.name}:\n${form.prompt}` })}>
              <Icon name="sparkle" size={14} /> Улучшить в чате
            </button>
          </div>
          <textarea
            className="prompt"
            value={form.prompt}
            placeholder={kind === "image" ? "Опишите изображение…" : "Опишите сцену, действие и движение камеры…"}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            rows={5}
          />
        </div>

        <ParamControls specs={mode.params} values={params} onChange={setParam} />

        <div className="generate-bar">
          {error && <div className="err small">{error}</div>}
          {!providerReady && <div className="err small">Ключ {KEY_ENV[model.provider]} не задан</div>}
          <button className="btn accent wide big" disabled={Boolean(validation) || submitting || !providerReady} onClick={submit}
            title={validation ?? "Ctrl/Cmd + Enter"}>
            {submitting && model.kind === "image" && model.provider !== "higgsfield" ? <><div className="spinner" /> Генерирую…</> : <><Icon name="sparkle" size={16} /> Сгенерировать · ≈{formatUsd(cost)}</>}
          </button>
          <div className="muted tiny-text">{validation ?? model.priceNote}</div>
        </div>
      </section>

      <History
        jobs={jobs}
        loading={loading}
        hasMore={Boolean(cursor)}
        onLoadMore={() => load(cursor)}
        onReuse={reuse}
        onUseAsInput={imageInput ? useAsInput : undefined}
        onDelete={remove}
        onCancel={cancel}
      />
    </div>
  );
}
