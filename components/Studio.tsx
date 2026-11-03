"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MODELS, defaultParams, estimateCost, formatUsd, getMode, getModel, validateRequest, type Kind } from "@/lib/models";
import { cancelJob, deleteJob, generate, isTerminal, listJobs, waitForJob, type Job } from "@/lib/client";
import { useApp } from "./AppContext";
import { Gallery } from "./Gallery";
import { Composer } from "./Composer";
import { VideoPanel } from "./VideoPanel";
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
  const { registerInsert, setChatContext, config } = useApp();
  const router = useRouter();
  const storeKey = `studio.${kind}.v1`;
  const [form, setForm] = useState<FormState>(() => initialForm(kind));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      // Кадр, переданный из раздела «Фото» кнопкой «Анимировать»
      const hand = localStorage.getItem("handoff.animate");
      if (hand && kind === "video") {
        localStorage.removeItem("handoff.animate");
        setForm((f) => {
          const m = getModel(f.modelId) ?? MODELS.find((x) => x.kind === "video")!;
          const mode = m.modes.find((x) => x.inputs.some((i) => i.key === "image_url")) ?? m.modes[0];
          const kk = k(m.id, mode.id);
          return { ...f, modelId: m.id, modeId: mode.id, inputs: { ...f.inputs, [kk]: { ...(f.inputs[kk] ?? {}), image_url: [hand] } } };
        });
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
  }
  function setParam(pk: string, v: unknown) {
    setForm((f) => ({ ...f, params: { ...f.params, [key]: { ...(f.params[key] ?? params), [pk]: v } } }));
  }
  function setInput(ik: string, v: string[]) {
    setForm((f) => ({ ...f, inputs: { ...f.inputs, [key]: { ...(f.inputs[key] ?? inputs), [ik]: v } } }));
  }

  const request = { modelId: model.id, modeId: mode.id, prompt: form.prompt, params, inputs };
  const validation = validateRequest(request);
  const cost = estimateCost(request);
  const KEY_ENV = { google: "GEMINI_API_KEY", byteplus: "ARK_API_KEY", higgsfield: "HF_API_KEY" } as const;
  const providerReady = !config || config.mock || config.providers[model.provider];
  const missingKey = providerReady ? null : `Не задан ключ ${KEY_ENV[model.provider]} в настройках Vercel`;

  // Можно запускать несколько генераций подряд, не дожидаясь первой
  async function submit() {
    if (validation || !providerReady) return;
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
    if (!imageInput) { setError(`У ${model.name} нет референсов — выберите Nano Banana или Seedream`); return; }
    const cur = inputs[imageInput.key] ?? [];
    if (cur.length >= imageInput.max) { setError(`${imageInput.label}: максимум ${imageInput.max}`); return; }
    setInput(imageInput.key, [...cur, url]);
  }
  async function remove(job: Job) {
    if (!confirm("Удалить генерацию?")) return;
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    try { await deleteJob(job.id); } catch (e) { setError((e as Error).message); }
  }
  function animate(url: string) {
    try { localStorage.setItem("handoff.animate", url); } catch { /* ignore */ }
    router.push("/video");
  }
  async function cancel(job: Job) {
    try { await cancelJob(job); } catch (e) { setError((e as Error).message); }
  }

  const models = MODELS.filter((m) => m.kind === kind);
  const shared = {
    models, model, mode, prompt: form.prompt, params, inputs, cost, validation, error, missingKey,
    onModel: setModel,
    onMode: (id: string) => setForm((f) => ({ ...f, modeId: id })),
    onPrompt: (v: string) => setForm((f) => ({ ...f, prompt: v })),
    onParam: setParam,
    onInput: setInput,
    onSubmit: submit,
  };
  const gallery = (
    <Gallery
      jobs={jobs}
      layout={kind === "image" ? "justified" : "grouped"}
      loading={loading}
      hasMore={Boolean(cursor)}
      onLoadMore={() => load(cursor)}
      onReuse={reuse}
      onUseAsInput={kind === "image" ? useAsInput : undefined}
      onAnimate={kind === "image" ? animate : undefined}
      onDelete={remove}
      onCancel={cancel}
      emptyText={kind === "image" ? "Здесь появятся ваши изображения" : "Здесь появятся ваши видео"}
    />
  );

  if (kind === "image") {
    return (
      <div className="istudio">
        <div className="iscroll">{gallery}</div>
        <div className="composer-dock"><Composer {...shared} /></div>
      </div>
    );
  }
  return (
    <div className="vstudio">
      <VideoPanel {...shared} />
      <section className="vhistory">
        <div className="vh-head"><span className="vh-tab"><Icon name="folder" size={14} /> История</span></div>
        <div className="vh-scroll">{gallery}</div>
      </section>
    </div>
  );
}
