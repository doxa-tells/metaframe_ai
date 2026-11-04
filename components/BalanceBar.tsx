"use client";
import { useCallback, useEffect, useState } from "react";
import { getBalances, setBalanceApi, timeAgo, type BalanceRow } from "@/lib/client";
import { formatUsd } from "@/lib/models";
import { asset } from "@/lib/brand";
import { PillPopover } from "./Popover";

const META: Record<BalanceRow["provider"], { name: string; models: string; emblem: string; billing: string }> = {
  google: { name: "Google", models: "Nano Banana, Omni Flash", emblem: "emblem-google", billing: "https://aistudio.google.com/usage" },
  byteplus: { name: "BytePlus", models: "Seedream, Seedance", emblem: "emblem-seed", billing: "https://console.byteplus.com/billing/" },
  higgsfield: { name: "Higgsfield", models: "Soul, Kling, Genjutsu", emblem: "emblem-higgsfield", billing: "https://cloud.higgsfield.ai/" },
};
const LOW = 3; // меньше $3 — жёлтым

const money = (n: number) => `$${n.toFixed(n < 1000 ? 2 : 0)}`;
const tone = (r: BalanceRow) => (r.left === null ? "unset" : r.left <= 0 ? "out" : r.left < LOW ? "low" : "ok");

// Событие «траты изменились» — шлёт студия после генерации
export const notifySpent = () => { try { window.dispatchEvent(new Event("mf:spent")); } catch { /* ignore */ } };

export function BalanceBar() {
  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    try { setRows(await getBalances(fresh)); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000);
    let delay: ReturnType<typeof setTimeout>;
    const onSpent = () => { clearTimeout(delay); delay = setTimeout(() => load(true), 1500); };
    const onFocus = () => load();
    window.addEventListener("mf:spent", onSpent);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); clearTimeout(delay); window.removeEventListener("mf:spent", onSpent); window.removeEventListener("focus", onFocus); };
  }, [load]);

  async function save(p: BalanceRow["provider"], value: string | null) {
    const amount = value === null ? null : Number(value.replace(",", "."));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { setError("Введите сумму в долларах"); return; }
    setSaving(p);
    try { setRows(await setBalanceApi(p, amount)); setDraft((d) => ({ ...d, [p]: "" })); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }

  const set = rows?.filter((r) => r.amount !== null) ?? [];
  const total = set.reduce((s, r) => s + (r.left ?? 0), 0);
  const worst = set.some((r) => tone(r) === "out") ? "out" : set.some((r) => tone(r) === "low") ? "low" : "ok";

  return (
    <PillPopover placement="down" align="right" width={360} title="Баланс по провайдерам" className={`balance-wrap ${worst}`}
      label={
        <span className="bal-chips">
          {rows === null ? <span className="bal-chip muted">…</span> : set.length === 0 ? (
            <span className="bal-chip unset">$ Баланс</span>
          ) : (
            <>
              {rows.map((r) => r.amount !== null && (
                <span key={r.provider} className={`bal-chip ${tone(r)}`} title={`${META[r.provider].name}: осталось ${formatUsd(r.left ?? 0)}`}>
                  <img src={asset(META[r.provider].emblem)} alt="" draggable={false} />{money(Math.max(0, r.left ?? 0))}
                </span>
              ))}
              <span className={`bal-chip total ${worst}`}>{money(Math.max(0, total))}</span>
            </>
          )}
        </span>
      }>
      {() => (
        <div className="bal-pop">
          <div className="pop-title">Баланс</div>
          <p className="bal-note">Введите остаток с сайта провайдера — дальше студия сама вычитает стоимость каждой генерации. Время от времени сверяйте и обновляйте.</p>
          {(rows ?? []).map((r) => {
            const m = META[r.provider];
            const pct = r.amount ? Math.max(0, Math.min(100, ((r.left ?? 0) / r.amount) * 100)) : 0;
            return (
              <div key={r.provider} className={`bal-row ${tone(r)}`}>
                <div className="bal-head">
                  <img src={asset(m.emblem)} alt="" draggable={false} />
                  <div className="bal-name"><b>{m.name}</b><span>{m.models}</span></div>
                  <div className="bal-left">{r.left === null ? "—" : money(r.left)}</div>
                </div>
                {r.amount !== null && (
                  <>
                    <div className="bal-bar"><i style={{ width: `${pct}%` }} /></div>
                    <div className="bal-meta">потрачено {formatUsd(r.spent)} · {r.count} ген. из {money(r.amount)} · сверено {r.since ? timeAgo(r.since) : "—"}</div>
                  </>
                )}
                <div className="bal-edit">
                  <span className="bal-cur">$</span>
                  <input type="text" inputMode="decimal" placeholder={r.amount === null ? "Текущий остаток" : "Новый остаток"} value={draft[r.provider] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.provider]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && draft[r.provider]) save(r.provider, draft[r.provider]); }} />
                  <button type="button" className="btn tiny accent" disabled={!draft[r.provider] || saving === r.provider} onClick={() => save(r.provider, draft[r.provider])}>
                    {saving === r.provider ? "…" : "Сохранить"}
                  </button>
                  <a className="btn tiny" href={m.billing} target="_blank" rel="noreferrer" title="Открыть баланс у провайдера">↗</a>
                </div>
              </div>
            );
          })}
          {error && <div className="err small">{error}</div>}
        </div>
      )}
    </PillPopover>
  );
}
