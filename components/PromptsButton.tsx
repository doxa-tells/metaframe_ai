"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { deletePromptApi, listPromptsApi, savePromptApi, type SavedPrompt } from "@/lib/client";
import { Icon } from "./Icon";

// Кнопка «Промпты» в поле генерации: свои сохранённые промпты аккаунта.
// Открывает окно, где их можно создать, поправить, удалить и вставить в поле
export function PromptsButton({ prompt, onPrompt, className = "pill" }: { prompt: string; onPrompt: (v: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Свои сохранённые промпты">
        <Icon name="layers" size={14} /> Промпты
      </button>
      {open && <PromptsModal current={prompt} onUse={onPrompt} onClose={() => setOpen(false)} />}
    </>
  );
}

type Draft = { id?: string; title: string; text: string };

function PromptsModal({ current, onUse, onClose }: { current: string; onUse: (v: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<SavedPrompt[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    listPromptsApi().then(setItems).catch((e: Error) => { setError(e.message); setItems([]); });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (draft) setDraft(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onClose]);

  async function run(fn: () => Promise<SavedPrompt[]>, after?: () => void) {
    setBusy(true);
    setError(null);
    try { setItems(await fn()); after?.(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  const save = () => draft && run(() => savePromptApi(draft), () => setDraft(null));
  const remove = (id: string) => run(() => deletePromptApi(id), () => setConfirmId(null));
  function use(p: SavedPrompt, append: boolean) {
    onUse(append && current.trim() ? `${current.trimEnd()}\n\n${p.text}` : p.text);
    onClose();
  }

  const hasCurrent = Boolean(current.trim());

  return createPortal(
    <div className="modal-bg lib-bg" onClick={onClose}>
      <div className="lib pr" onClick={(e) => e.stopPropagation()}>
        <div className="lib-head">
          <b>Промпты</b>
          <span className="muted small pr-count">{items ? `${items.length} сохранено` : ""}</span>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={16} /></button>
        </div>

        {draft ? (
          <div className="pr-form">
            <input type="text" autoFocus placeholder="Название — например, «Лист персонажа»" maxLength={80}
              value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea placeholder="Текст промпта" value={draft.text} maxLength={20000}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            {error && <div className="err small">{error}</div>}
            <div className="pr-form-foot">
              <span className="muted small">{draft.text.length.toLocaleString("ru-RU")} / 20 000</span>
              <button className="btn" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>Отмена</button>
              <button className="btn accent" disabled={busy || !draft.text.trim()} onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="pr-actions">
              <button className="btn accent" onClick={() => { setError(null); setDraft({ title: "", text: "" }); }}><Icon name="plus" size={14} />Новый промпт</button>
              <button className="btn" disabled={!hasCurrent} title={hasCurrent ? "Сохранить то, что сейчас в поле генерации" : "Поле промпта пустое"}
                onClick={() => { setError(null); setDraft({ title: "", text: current.trim() }); }}>
                <Icon name="save" size={14} />Сохранить текущий
              </button>
            </div>
            <div className="pr-list">
              {items === null && <div className="lib-empty"><div className="spinner" /></div>}
              {items?.length === 0 && (
                <div className="lib-empty muted">Здесь будут ваши промпты. Создайте новый или сохраните тот, что сейчас в поле генерации, — они хранятся в вашем аккаунте.</div>
              )}
              {items?.map((p) => (
                <div key={p.id} className="pr-item">
                  <button type="button" className="pr-body" onClick={() => use(p, false)} title="Вставить в поле генерации">
                    <b>{p.title}</b>
                    <span className="muted">{p.text}</span>
                  </button>
                  {confirmId === p.id ? (
                    <div className="pr-tools">
                      <button className="btn small" disabled={busy} onClick={() => setConfirmId(null)}>Оставить</button>
                      <button className="btn small pr-danger" disabled={busy} onClick={() => remove(p.id)}>Удалить</button>
                    </div>
                  ) : (
                    <div className="pr-tools">
                      <button className="btn small accent" onClick={() => use(p, false)}>Вставить</button>
                      {hasCurrent && <button className="btn small" onClick={() => use(p, true)} title="Добавить в конец текущего промпта">Дописать</button>}
                      <button className="iconbtn" onClick={() => { setError(null); setDraft({ id: p.id, title: p.title, text: p.text }); }} aria-label="Изменить" title="Изменить"><Icon name="pencil" size={15} /></button>
                      <button className="iconbtn" onClick={() => setConfirmId(p.id)} aria-label="Удалить" title="Удалить"><Icon name="trash" size={15} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {error && <div className="err small pr-err">{error}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
