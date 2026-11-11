"use client";
import Link from "next/link";
import { creditsWord, formatCredits } from "@/lib/credits";
import { Icon } from "./Icon";
import { useCredits } from "./useCredits";

// Баланс кредитов в шапке — ведёт на страницу пополнения
export function CreditsChip() {
  const { credits } = useCredits(true);
  const low = credits !== null && credits < 10;
  return (
    <Link href="/credits" className={`credits-chip ${low ? "low" : ""}`} title="Кредиты — пополнить баланс">
      <Icon name="sparkle" size={15} />
      <b>{credits === null ? "…" : formatCredits(credits)}</b>
      <span className="credits-chip-word">{credits === null ? "кредитов" : creditsWord(credits)}</span>
      {low && <span className="credits-chip-add">Пополнить</span>}
    </Link>
  );
}
