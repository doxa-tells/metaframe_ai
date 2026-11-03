"use client";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, useReactFlow,
  type Connection, type Edge, type IsValidConnection,
} from "@xyflow/react";
import { nodeTypes, RunContext, type FlowData, type FlowNode } from "./nodeTypes";
import { runGraph } from "./engine";
import { listGraphs, loadGraph, saveGraph, timeAgo, type GraphMeta } from "@/lib/client";
import { useApp } from "../AppContext";
import { Icon } from "../Icon";

const LOCAL_KEY = "nodes.current.v1";

const TEMPLATE: { nodes: FlowNode[]; edges: Edge[] } = {
  nodes: [
    { id: "p1", type: "prompt", position: { x: 0, y: 40 }, data: { text: "Девушка в красном пальто идёт по ночному Алматы, неон, дождь" } },
    { id: "l1", type: "llm", position: { x: 360, y: 0 }, data: { instruction: "Сделай кинематографичный промпт для фото, на английском" } },
    { id: "g1", type: "imageGen", position: { x: 720, y: 0 }, data: { modelId: "nano-banana-2.1", params: { aspect_ratio: "16:9", image_size: "2K" } } },
    { id: "v1", type: "videoGen", position: { x: 1080, y: 40 }, data: { modelId: "kling-4.0", params: { duration: 5, resolution: "1080p" } } },
    { id: "p2", type: "prompt", position: { x: 720, y: 560 }, data: { text: "Slow dolly-in, she turns to the camera and smiles, rain drops in the neon light" } },
  ],
  edges: [
    { id: "e1", source: "p1", sourceHandle: "out-text", target: "l1", targetHandle: "in-text" },
    { id: "e2", source: "l1", sourceHandle: "out-text", target: "g1", targetHandle: "in-text" },
    { id: "e3", source: "g1", sourceHandle: "out-image", target: "v1", targetHandle: "in-image" },
    { id: "e4", source: "p2", sourceHandle: "out-text", target: "v1", targetHandle: "in-text" },
  ],
};

const ADD = [
  { type: "prompt", label: "Промпт", icon: "chat", data: { text: "" } },
  { type: "imageInput", label: "Изображение", icon: "upload", data: {} },
  { type: "llm", label: "LLM", icon: "sparkle", data: { instruction: "" } },
  { type: "imageGen", label: "Фото", icon: "image", data: { modelId: "nano-banana-2.1", params: {} } },
  { type: "videoGen", label: "Видео", icon: "video", data: { modelId: "kling-4.0", params: {} } },
];

// Убираем служебные поля статуса перед сохранением
const clean = (nodes: FlowNode[]) =>
  nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { ...n.data, status: n.data.status === "running" ? "idle" : n.data.status } }));

function Editor() {
  const { registerInsert, setChatContext } = useApp();
  const rf = useReactFlow<FlowNode, Edge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [graphId, setGraphId] = useState<string | undefined>();
  const [name, setName] = useState("Моя схема");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [openList, setOpenList] = useState<GraphMeta[] | null>(null);
  const signal = useRef({ cancelled: false });
  const ready = useRef(false);

  useEffect(() => {
    let state = TEMPLATE as { nodes: FlowNode[]; edges: Edge[]; id?: string; name?: string };
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) state = JSON.parse(raw);
    } catch { /* ignore */ }
    setNodes(state.nodes);
    setEdges(state.edges);
    if (state.id) setGraphId(state.id);
    if (state.name) setName(state.name);
    ready.current = true;
    setChatContext({});
  }, [setNodes, setEdges, setChatContext]);

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ nodes: clean(nodes), edges, id: graphId, name })); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges, graphId, name]);

  // Промпт из чата: в выделенную ноду промпта или в новую
  useEffect(() => {
    registerInsert((text) => {
      const sel = rf.getNodes().find((n) => n.selected && n.type === "prompt");
      if (sel) { rf.updateNodeData(sel.id, { text }); return; }
      const vp = rf.getViewport();
      const id = `n${Date.now()}`;
      setNodes((ns) => [...ns, { id, type: "prompt", position: { x: -vp.x / vp.zoom + 60, y: -vp.y / vp.zoom + 60 }, data: { text } }]);
    });
    return () => registerInsert(null);
  }, [registerInsert, rf, setNodes]);

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, animated: false }, es)), [setEdges]);
  const isValidConnection: IsValidConnection = useCallback((c) => {
    const s = (c.sourceHandle ?? "").split("-")[1];
    const t = (c.targetHandle ?? "").split("-")[1];
    return Boolean(s && t && s === t && c.source !== c.target);
  }, []);

  function addNode(type: string, data: FlowData) {
    const vp = rf.getViewport();
    const el = document.querySelector(".flow-wrap");
    const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
    const id = `n${Date.now()}`;
    setNodes((ns) => [...ns, {
      id, type,
      position: { x: (w / 2 - vp.x) / vp.zoom - 130 + Math.random() * 40, y: (h / 2 - vp.y) / vp.zoom - 80 + Math.random() * 40 },
      data: structuredClone(data),
    }]);
  }

  const run = useCallback(async (target: string | null) => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    signal.current = { cancelled: false };
    try {
      await runGraph(
        { getNodes: rf.getNodes, getEdges: rf.getEdges, update: (id, patch) => rf.updateNodeData(id, patch) },
        target ? [target] : null,
        signal.current,
        new Set(target ? [target] : []),
      );
      setMessage({ text: "Готово" });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setRunning(false);
    }
  }, [running, rf]);

  function stop() {
    signal.current.cancelled = true;
    setMessage({ text: "Остановка: уже запущенные генерации продолжат выполняться у провайдера и попадут в историю" });
  }

  async function save() {
    try {
      const id = await saveGraph({ id: graphId, name, nodes: clean(rf.getNodes()), edges: rf.getEdges() });
      setGraphId(id);
      setMessage({ text: "Схема сохранена" });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  }
  async function showList() {
    try { setOpenList(await listGraphs()); } catch (e) { setMessage({ text: (e as Error).message, error: true }); }
  }
  async function open(id: string) {
    const g = await loadGraph(id);
    if (!g) return;
    setNodes(g.nodes as FlowNode[]);
    setEdges(g.edges as Edge[]);
    setGraphId(g.id);
    setName(g.name);
    setOpenList(null);
    setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
  }
  function newGraph() {
    if (!confirm("Создать новую схему? Несохранённые изменения пропадут.")) return;
    setNodes([]);
    setEdges([]);
    setGraphId(undefined);
    setName("Новая схема");
  }

  const runCtx = useMemo(() => ({ runNode: (id: string) => run(id), running }), [run, running]);

  return (
    <RunContext.Provider value={runCtx}>
      <div className="nodes-page">
        <div className="nodes-toolbar">
          <input className="graph-name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grow" />
          {message && <span className={`small ${message.error ? "err" : "muted"}`}>{message.text}</span>}
          <button className="btn small" onClick={newGraph} title="Новая схема"><Icon name="plus" size={14} /></button>
          <button className="btn small" onClick={showList} title="Открыть"><Icon name="folder" size={14} /></button>
          <button className="btn small" onClick={save} title="Сохранить"><Icon name="save" size={14} /></button>
          {running ? (
            <button className="btn small danger" onClick={stop}><Icon name="stop" size={14} /> Стоп</button>
          ) : (
            <button className="btn small accent" onClick={() => run(null)} title="Запускает всю схему. Ноды без изменений берут прошлый результат">
              <Icon name="play" size={14} /> Запустить всё
            </button>
          )}
        </div>
        <div className="flow-wrap">
          <div className="palette">
            <div className="palette-title">Добавить</div>
            {ADD.map((a) => (
              <button key={a.type} className="btn small" onClick={() => addNode(a.type, a.data)} title={`Добавить ноду: ${a.label}`}>
                <Icon name={a.icon} size={14} /> {a.label}
              </button>
            ))}
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            deleteKeyCode={["Delete", "Backspace"]}
            defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
          >
            <Background gap={22} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {openList && (
          <div className="modal-bg" onClick={() => setOpenList(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><b>Сохранённые схемы</b><button className="iconbtn" onClick={() => setOpenList(null)}><Icon name="x" size={16} /></button></div>
              {openList.length === 0 && <div className="muted small">Пока нет сохранённых схем</div>}
              <div className="col gap4">
                {openList.map((g) => (
                  <button key={g.id} className="list-item" onClick={() => open(g.id)}>
                    <span>{g.name}</span><span className="muted small">{timeAgo(g.savedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </RunContext.Provider>
  );
}

export function NodesEditor() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
