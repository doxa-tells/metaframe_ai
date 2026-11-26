import { redirect } from "next/navigation";

// Этот адрес закрыт входом (его нет в PUBLIC): кнопка «Войти и читать дальше» ведёт сюда,
// proxy.ts показывает здесь форму входа, а после входа человек возвращается в гайд — уже полный.
export default async function GuideBlenderFull({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const en = (await searchParams).lang === "en";
  redirect(`/guides/blender${en ? "?lang=en" : ""}#step-4`);
}
