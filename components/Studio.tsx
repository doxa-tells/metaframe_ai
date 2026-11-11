"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MODELS, defaultParams, estimateCost, firstMode, formatUsd, getModel, validateRequest, visibleMode, type Kind } from "@/lib/models";
import { bulkDelete, cachedJobs, cancelJob, deleteJob, generate, isTerminal, listJobs, rememberJobs, waitForJob, type Job } from "@/lib/client";
import { useApp } from "./AppContext";
import { Gallery, type BulkItem } from "./Gallery";
import { notifySpent } from "./BalanceBar";
import { useMe } from "./MeContext";
import { creditsFor, creditsWord, formatCredits } from "@/lib/credits";
import { humanizeMessage } from "@/lib/errors";
import { Composer } from "./Composer";
import { VideoPanel } from "./VideoPanel";
import { Icon } from "./Icon";

type FormState = {
  modelId: string;
  modeId: string;
  prompt: string;
  params: Record<string, Record<string, unknown>>; // по ключу model:mode
  inputs: Record<string, Record<string, string[]>>;
  pool?: Record<string, string[]>; // все рефы по типам — переживают переход через модель, где мест меньше
};

const k = (m: string, mode: string) => `${m}:${mode}`;

function initialForm(kind: Kind): FormState {
  const model = MODELS.find((m) => m.kind === kind)!;
  return { modelId: model.id, modeId: firstMode(model).id, prompt: "", params: {}, inputs: {} };
}

export function Studio({ kind }: { kind: Kind }) {
  const { registerInsert, setChatContext, config } = useApp();
  const router = useRouter();
  const storeKey = `studio.${kind}.v1`;
  const [form, setForm] = useState<FormState>(() => initialForm(kind));
  // История из кэша показывается сразу при возврате на страницу, а свежая подгружается в фоне
  const [jobs, setJobs] = useState<Job[]>(() => cachedJobs(kind)?.jobs ?? []);
  const [cursor, setCursor] = useState<string | undefined>(() => cachedJobs(kind)?.cursor);
  const [loading, setLoading] = useState(() => !cachedJobs(kind));
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const polling = useRef(new Set<string>());
  const alive = useRef({ cancelled: false });

  const model = getModel(form.modelId) ?? MODELS.find((m) => m.kind === kind)!;
  const mode = visibleMode(model, form.modeId);
  const key = k(model.id, mode.id);
  const params = useMemo(() => ({ ...defaultParams(mode), ...(form.params[key] ?? {}) }), [mode, form.params, key]);
  const inputs = form.inputs[key] ?? {};

    // Набор рефов по типам: что видно в текущем режиме, плюс то, что в него не влезло.
  // Удалённые пользователем рефы из набора уходят.
  function poolOf(prev: Record<string, string[]> | undefined, md: typeof mode, before: Record<string, string[]>, after = before) {
    const byKind = (vals: Record<string, string[]>) => {
      const r: Record<string, string[]> = {};
      for (const inp of md.inputs) for (const u of vals[inp.key] ?? []) if (u && !(r[inp.kind] ??= []).includes(u)) r[inp.kind].push(u);
      return r;
    };
    const was = byKind(before), now = byKind(after);
    const out: Record<string, string[]> = { ...(prev ?? {}) };
    for (const kind of new Set(md.inputs.map((x) => x.kind))) {
      const shown = now[kind] ?? [];
      const removed = (was[kind] ?? []).filter((u) => !shown.includes(u));
      out[kind] = [...shown, ...(prev?.[kind] ?? []).filter((u) => !shown.includes(u) && !removed.includes(u))];
    }
    return out;
  }

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
    if (c || !cachedJobs(kind)) setLoading(true);
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
  useEffect(() => { rememberJobs(kind, jobs, cursor); }, [kind, jobs, cursor]);
  // Одна и та же страница не запрашивается дважды (прокрутка может звать подгрузку несколько раз)
  const inFlight = useRef<string | null>(null);
  const loadMore = useCallback(() => {
    if (!cursor || inFlight.current === cursor) return;
    inFlight.current = cursor;
    load(cursor).finally(() => { inFlight.current = null; });
  }, [cursor, load]);
  const mergeJobs = useCallback((upd: Job[]) => {
    const map = new Map(upd.map((j) => [j.id, j]));
    setJobs((prev) => prev.map((j) => map.get(j.id) ?? j));
  }, []);
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

  // При смене модели или режима референсы переезжают в новую: раскладываем их по входам того же типа
  // (картинки к картинкам, видео к видео), сколько влезет
  function carry(f: FormState, toModelId: string, toModeId: string): FormState {
    const fromModel = getModel(f.modelId);
    const toModel = getModel(toModelId);
    if (!fromModel || !toModel) return { ...f, modelId: toModelId, modeId: toModeId };
    const fromMode = visibleMode(fromModel, f.modeId);
    const toMode = visibleMode(toModel, toModeId);
    const pool = poolOf(f.pool, fromMode, f.inputs[k(fromModel.id, fromMode.id)] ?? {});
    const next = { ...f, modelId: toModel.id, modeId: toMode.id, pool };
    if (!Object.values(pool).some((l) => l.length)) return next; // переносить нечего — у новой модели остаются её рефы
    const left: Record<string, string[]> = Object.fromEntries(Object.entries(pool).map(([kk, v]) => [kk, [...v]]));
    const dst: Record<string, string[]> = {};
    for (const inp of toMode.inputs) dst[inp.key] = (left[inp.kind] ?? []).splice(0, inp.max);
    return { ...next, inputs: { ...f.inputs, [k(toModel.id, toMode.id)]: dst } };
  }
  function setModel(id: string) {
    const m = getModel(id)!;
    setForm((f) => carry(f, id, m.modes.some((x) => x.id === f.modeId) ? visibleMode(m, f.modeId).id : firstMode(m).id));
  }
  function setParam(pk: string, v: unknown) {
    setForm((f) => ({ ...f, params: { ...f.params, [key]: { ...(f.params[key] ?? params), [pk]: v } } }));
  }
  function setInput(ik: string, v: string[]) {
    setForm((f) => {
      const cur = { ...(f.inputs[key] ?? inputs), [ik]: v };
      // Правки пользователя обновляют общий набор рефов для тех типов, что есть в текущем режиме
      return { ...f, inputs: { ...f.inputs, [key]: cur }, pool: poolOf(f.pool, mode, f.inputs[key] ?? inputs, cur) };
    });
  }

  const request = { modelId: model.id, modeId: mode.id, prompt: form.prompt, params, inputs };
  const validation = validateRequest(request);
  const cost = estimateCost(request);
  // Пользователи видят цену в кредитах, владелец — себестоимость в долларах
  const me = useMe();
  const credits = creditsFor(request);
  const priceText = me.role === "user" ? `${formatCredits(credits)} ${creditsWord(credits)}` : undefined;
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
      cost, credits, provider: model.provider, status: "in_progress", outputs: [], createdAt: Date.now(),
    };
    setJobs((prev) => [temp, ...prev]);
    try {
      const job = await generate(request);
      setJobs((prev) => prev.map((j) => (j.id === tempId ? job : j)));
      notifySpent();
      if (job.status === "failed") setError(humanizeMessage(job.error ?? "Ошибка генерации"));
    } catch (e) {
      setJobs((prev) => prev.filter((j) => j.id !== tempId));
      setError(humanizeMessage((e as Error).message));
    }
  }

  function reuse(job: Job) {
    const jm = getModel(job.modelId);
    const modeId = jm ? visibleMode(jm, job.modeId).id : job.modeId;
    const kk = k(job.modelId, modeId);
    setForm((f) => ({
      ...f, modelId: job.modelId, modeId, prompt: job.prompt, pool: undefined,
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
  // Пакетное удаление: сразу убираем из списка, при ошибке — перезагружаем историю
  async function removeMany(items: BulkItem[]) {
    const map = new Map(items.map((i) => [i.id, i]));
    setJobs((prev) => prev.flatMap((j) => {
      const it = map.get(j.id);
      if (!it) return [j];
      if (!it.indexes) return [];
      const outputs = j.outputs.filter((_, i) => !it.indexes!.includes(i));
      return outputs.length ? [{ ...j, outputs }] : [];
    }));
    try {
      const res = await bulkDelete(items);
      const failed = Object.values(res).filter((r) => r.startsWith("error")).length;
      if (failed) { setError(`Не удалось удалить ${failed} из ${items.length}`); load(); }
    } catch (e) {
      setError((e as Error).message);
      load();
    }
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
    models, model, mode, prompt: form.prompt, params, inputs, cost, priceText, validation, error, missingKey,
    onModel: setModel,
    onMode: (id: string) => setForm((f) => carry(f, f.modelId, id)),
    onPrompt: (v: string) => setForm((f) => ({ ...f, prompt: v })),
    onParam: setParam,
    onInput: setInput,
    onSubmit: submit,
  };
  const gallery = (
    <Gallery
      jobs={jobs}
      viewKey={`gallery.view.v2.${kind}`}
      defaultView={kind === "image"
        ? { layout: "masonry", split: false, size: 0 }
        : { layout: "square", split: true, size: 0 }}
      loading={loading}
      hasMore={Boolean(cursor)}
      onLoadMore={loadMore}
      onReuse={reuse}
      onJobsUpdated={mergeJobs}
      onUseAsInput={kind === "image" ? useAsInput : undefined}
      onAnimate={kind === "image" ? animate : undefined}
      onDelete={remove}
      onBulkDelete={removeMany}
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
