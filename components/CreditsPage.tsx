"use client";
import { useState } from "react";
import { withBase } from "@/lib/base";
import { creditsFor, creditsWord, formatCredits } from "@/lib/credits";
import { formatTenge, getPackage, KASPI_PHONE_COPY, KASPI_PHONE_DISPLAY, PACKAGES, WHATSAPP_NUMBER, type CreditPackage } from "@/lib/packages";
import { Icon } from "./Icon";
import { useMe } from "./MeContext";
import { useCredits } from "./useCredits";

// Сколько стоят популярные генерации — считается той же функцией, что и списание
const SAMPLES: { label: string; modelId: string; modeId: string; params: Record<string, unknown> }[] = [
  { label: "Фото Nano Banana 2.1, 2K", modelId: "nano-banana-2.1", modeId: "generate", params: { image_size: "2K", count: 1 } },
  { label: "Фото Seedream 5.0 Lite", modelId: "seedream-5.0-lite", modeId: "generate", params: { count: 1 } },
  { label: "Фото Soul 2", modelId: "soul-2", modeId: "generate", params: { batch_size: 1 } },
  { label: "Видео Seedance 2.5, 5 с, 720p", modelId: "seedance-2.5", modeId: "image", params: { resolution: "720p", duration: 5 } },
  { label: "Видео Seedance 2.5, 5 с, 1080p", modelId: "seedance-2.5", modeId: "image", params: { resolution: "1080p", duration: 5 } },
  { label: "Видео Kling 4.0, 5 с, 1080p", modelId: "kling-4.0", modeId: "image", params: { resolution: "1080p", duration: 5 } },
  { label: "Видео Gemini Omni Flash, 8 с, 720p", modelId: "gemini-omni-flash", modeId: "text", params: { resolution: "720p", duration: 8 } },
];

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* старый браузер */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

const fmtDate = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function CreditsPage() {
  const me = useMe();
  const user = me.role === "user" ? me : null;
  const { credits, payClaim, setClaim } = useCredits(Boolean(user));
  const [sel, setSel] = useState<CreditPackage>(PACKAGES[1]);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(what: "phone" | "sum") {
    const ok = await copyText(what === "phone" ? KASPI_PHONE_COPY : String(sel.price));
    setCopied(ok ? what : "fail");
    setTimeout(() => setCopied(null), 2000);
  }

  const waText = [
    "Здравствуйте! Оплатил(а) кредиты MetaFrame через Kaspi.",
    `Пакет ${sel.name}: ${sel.credits.toLocaleString("ru-RU")} кредитов за ${formatTenge(sel.price)}.`,
    user ? `Аккаунт: ${user.email}` : "",
    "Чек прикладываю.",
  ].filter(Boolean).join("\n");
  const waHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waText)}`;

  // Заявку сохраняем, чтобы владелец видел, кому начислить; ссылка в WhatsApp открывается сразу
  function claim() {
    if (!user) return;
    fetch(withBase("/api/me"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim: sel.id }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.payClaim) setClaim(d.payClaim); })
      .catch(() => {});
  }

  const claimPkg = payClaim ? getPackage(payClaim.pkg) : null;

  return (
    <div className="credits-page">
      <div className="cp-head">
        <div>
          <h1>Кредиты</h1>
          <p className="muted">Покупка разовая, без подписки. Кредиты не сгорают, а за неудачную или заблокированную генерацию возвращаются автоматически.</p>
        </div>
        {user ? (
          <div className="cp-balance">
            <span className="muted small">На балансе</span>
            <b>{credits === null ? "…" : formatCredits(credits)}</b>
            <span className="muted small">{credits === null ? "" : creditsWord(credits)}</span>
          </div>
        ) : (
          <div className="cp-balance muted small">Так страницу видят пользователи.<br />Начислять кредиты — в разделе «Админ».</div>
        )}
      </div>

      {payClaim && (
        <div className="banner cp-claim">
          Ждём подтверждения оплаты: пакет {claimPkg?.name ?? payClaim.pkg} — {formatCredits(payClaim.credits)} кредитов за {formatTenge(payClaim.price)} (заявка от {fmtDate(payClaim.at)}). Кредиты появятся после проверки перевода.
        </div>
      )}

      <div className="cp-packs">
        {PACKAGES.map((p) => (
          <button key={p.id} type="button" className={`cp-pack ${sel.id === p.id ? "on" : ""}`} onClick={() => setSel(p)}>
            <div className="cp-pack-name">{p.name}{p.id === "plus" && <span className="badge">популярный</span>}</div>
            <div className="cp-pack-credits">{p.credits.toLocaleString("ru-RU")} <span>кредитов</span></div>
            <div className="cp-pack-price">{formatTenge(p.price)}</div>
            <div className="muted small">{(p.price / p.credits).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ₸ за кредит</div>
            <div className="cp-pack-hint small">{p.hint}</div>
            <ul className="small muted">{p.examples.map((e) => <li key={e}>{e}</li>)}</ul>
          </button>
        ))}
      </div>

      <div className="cp-pay">
        <h2>Оплата пакета {sel.name} — {formatTenge(sel.price)}</h2>
        <ol>
          <li>
            <div>Переведите <b>{formatTenge(sel.price)}</b> на Kaspi по номеру телефона:</div>
            <div className="cp-phone">{KASPI_PHONE_DISPLAY}</div>
            <div className="cp-btns">
              <button type="button" className="btn accent" onClick={() => copy("phone")}>
                <Icon name={copied === "phone" ? "check" : "copy"} size={15} /> {copied === "phone" ? "Номер скопирован" : "Скопировать номер"}
              </button>
              <button type="button" className="btn" onClick={() => copy("sum")}>
                <Icon name={copied === "sum" ? "check" : "copy"} size={15} /> {copied === "sum" ? "Сумма скопирована" : `Скопировать сумму ${sel.price}`}
              </button>
            </div>
            {copied === "fail" && <div className="err small">Не удалось скопировать — наберите номер вручную.</div>}
            <div className="muted small">В Kaspi: Переводы → Клиенту Kaspi → по номеру телефона. Номер копируется без «+7» — так он сразу встаёт в поле.</div>
          </li>
          <li>
            <div>Отправьте чек об оплате в WhatsApp на тот же номер:</div>
            <div className="cp-btns">
              <a className="btn wa" href={waHref} target="_blank" rel="noreferrer" onClick={claim}>
                <Icon name="chat" size={15} /> Отправить чек в WhatsApp
              </a>
            </div>
            <div className="muted small">Откроется чат с готовым текстом: пакет, сумма {formatTenge(sel.price)}{user ? " и ваша почта" : ""}. Прикрепите к сообщению скриншот или PDF чека из Kaspi.</div>
          </li>
          <li>
            <div>Мы проверим перевод и начислим {sel.credits.toLocaleString("ru-RU")} кредитов на ваш аккаунт.</div>
          </li>
        </ol>
      </div>

      <div className="cp-costs">
        <h2>Сколько стоят генерации</h2>
        <table>
          <tbody>
            {SAMPLES.map((s) => {
              const c = creditsFor({ modelId: s.modelId, modeId: s.modeId, prompt: "", params: s.params, inputs: {} });
              return c ? <tr key={s.label}><td>{s.label}</td><td>{formatCredits(c)} {creditsWord(c)}</td></tr> : null;
            })}
          </tbody>
        </table>
        <p className="muted small">Точная цена показывается на кнопке «Сгенерировать» и зависит от качества, длительности и количества.</p>
      </div>
    </div>
  );
}
