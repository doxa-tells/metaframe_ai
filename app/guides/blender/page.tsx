import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GuideBlender } from "@/components/guides/GuideBlender";
import { AUTH_COOKIE, readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const en = (await searchParams).lang === "en";
  return {
    title: en ? "A winged horse over Baiterek — guide · MetaFrame Studio" : "Тулпар над Байтереком — гайд · MetaFrame Studio",
    description: en
      ? "Blender + Claude Code + Seedance: how to build a cinematic shot with yourself as the hero, in 7 steps with our prompts."
      : "Blender + Claude Code + Seedance: как собрать киношную сцену с собой в главной роли. 7 шагов и наши промпты.",
  };
}

// Гайд открыт всем; шаги 4–7 отдаются только при действующей сессии
export default async function GuideBlenderPage({ searchParams }: Props) {
  const lang = (await searchParams).lang === "en" ? "en" : "ru";
  const jar = await cookies();
  const full = Boolean(await readSession(jar.get(AUTH_COOKIE)?.value));
  return <GuideBlender lang={lang} full={full} />;
}
