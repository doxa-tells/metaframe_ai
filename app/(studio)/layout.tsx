import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AccountGate } from "@/components/AccountGate";
import type { Me } from "@/components/MeContext";
import { getCtx } from "@/lib/me";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  let me: Me = { role: "admin" };
  if (ctx.user) {
    const u = ctx.user;
    me = { role: "user", id: u.id, name: u.name, email: u.email, status: ctx.status, statusReason: u.statusReason, frozenUntil: u.frozenUntil };
    if (ctx.status === "pending" || ctx.status === "rejected" || ctx.status === "banned") return <AccountGate me={me} />;
  }
  return <AppShell me={me}>{children}</AppShell>;
}
