import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { getCtx } from "@/lib/me";

export const metadata = { title: "Модерация — MetaFrame" };

// Модерация пользователей — только для владельца
export default async function AdminPage() {
  const ctx = await getCtx();
  if (!ctx?.admin) notFound();
  return <AdminPanel />;
}
