"use client";
import { useEffect, useState } from "react";
import { createSoulId, listSoulIds, type SoulId } from "@/lib/client";
import { MediaInput } from "./MediaInput";
import { Icon } from "./Icon";

// Выбор и создание Soul ID — своего персонажа для Soul 2 (обучение на 20–80 фото одного лица)
export function SoulIdPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [items, setItems] = useState<SoulId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setItems(await listSoulIds()); setError(null); } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); }, []);
  // Пока персонаж обучается, обновляем список
  useEffect(() => {
    if (!items.some((s) => !["completed", "failed", "ready"].includes(s.status))) return;
    const t = setTimeout(refresh, 15000);
    return () => clearTimeout(t);
  }, [items]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const item = await createSoulId(name, photos);
      setItems([item, ...items]);
      setCreating(false);
      setName("");
      setPhotos([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = (s: SoulId) => ["completed", "ready"].includes(s.status);

  return (
    <div className="soul">
      <div className="soul-list">
        <button className={`soul-item ${!value ? "on" : ""}`} onClick={() => onChange(null)}>
          <div className="soul-ava none"><Icon name="x" size={14} /></div>
          <span>Без персонажа</span>
        </button>
        {items.map((s) => (
          <button key={s.id} className={`soul-item ${value === s.id ? "on" : ""}`} disabled={!ready(s)} onClick={() => onChange(s.id)}
            title={ready(s) ? s.name : `Статус: ${s.status}`}>
            <div className="soul-ava">{s.thumbnail ? <img src={s.thumbnail} alt="" /> : <Icon name="user" size={14} />}</div>
            <span>{s.name}{!ready(s) && <em> · {s.status === "failed" ? "ошибка" : "обучается"}</em>}</span>
          </button>
        ))}
        <button className="soul-item add" onClick={() => setCreating(true)}>
          <div className="soul-ava"><Icon name="plus" size={14} /></div>
          <span>Создать Soul ID</span>
        </button>
      </div>
      {error && <div className="err small">{error}</div>}
      {creating && (
        <div className="modal-bg" onClick={() => !busy && setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>Новый Soul ID</b>
              <button className="iconbtn" onClick={() => setCreating(false)}><Icon name="x" size={16} /></button>
            </div>
            <p className="muted small">Загрузите 20–80 фото <b>одного</b> человека: разные ракурсы, свет и выражения лица. Используйте только свои фото или фото людей, которые дали согласие.</p>
            <div className="field">
              <div className="field-label">Имя персонажа</div>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Алия" />
            </div>
            <MediaInput spec={{ key: "photos", label: "Фото", kind: "image", max: 100 }} value={photos} onChange={setPhotos} />
            <button className="btn accent wide" disabled={busy || !name.trim() || photos.length < 1} onClick={create}>
              {busy ? "Отправляю…" : `Обучить (${photos.length} фото)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
