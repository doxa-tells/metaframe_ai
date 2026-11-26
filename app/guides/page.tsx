import type { Metadata } from "next";
import { withBase } from "@/lib/base";

export const metadata: Metadata = { title: "Гайды · MetaFrame Studio" };

type Props = { searchParams: Promise<{ lang?: string }> };

// Список гайдов. Новый гайд — новая карточка здесь и папка в app/guides/
export default async function GuidesPage({ searchParams }: Props) {
  const en = (await searchParams).lang === "en";
  const q = en ? "?lang=en" : "";
  return (
    <div className="gd">
      <header className="gd-top">
        <a className="gd-logo" href={withBase("/image")}><img src={withBase("/assets/logo-bright.webp")} alt="" /> MetaFrame Studio</a>
        <nav>
          <a className={en ? "" : "on"} href={withBase("/guides")}>RU</a>
          <a className={en ? "on" : ""} href={withBase("/guides?lang=en")}>EN</a>
        </nav>
      </header>
      <section className="gd-idea">
        <div className="gd-kicker">{en ? "Guides" : "Гайды"}</div>
        <h1>{en ? "How we make our videos" : "Как мы делаем наши ролики"}</h1>
        <p>{en ? "Step by step, with the exact prompts we used." : "Пошагово, с теми промптами, которыми пользовались сами."}</p>
      </section>
      <div className="gd-list">
        <a className="gd-card" href={withBase("/guides/blender") + q}>
          <img src={withBase("/assets/guides/blender/fin_76.jpg")} alt="" />
          <div>
            <div className="gd-kicker">Blender + Claude Code + Seedance</div>
            <h3>{en ? "A winged horse over Baiterek" : "Тулпар над Байтереком"}</h3>
            <p>{en ? "A cinematic shot with yourself as the hero. 7 steps, 25 seconds, one continuous shot." : "Киношная сцена с собой в главной роли. 7 шагов, 25 секунд, один непрерывный кадр."}</p>
          </div>
        </a>
      </div>
      <footer className="gd-foot">MetaFrame Studio · <a href={withBase("/terms")}>{en ? "Terms" : "Правила"}</a></footer>
    </div>
  );
}
