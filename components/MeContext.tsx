"use client";
import { createContext, useContext, type ReactNode } from "react";

// Кто вошёл: владелец или пользователь (данные приходят с сервера в макете студии)
export type Me =
  | { role: "admin" }
  | { role: "user"; id: string; name: string; email: string; status: "pending" | "active" | "frozen" | "banned" | "rejected"; statusReason?: string; frozenUntil?: number };

const MeCtx = createContext<Me>({ role: "admin" });
export const MeProvider = ({ me, children }: { me: Me; children: ReactNode }) => <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
export const useMe = () => useContext(MeCtx);
export const isAdmin = (me: Me) => me.role === "admin";
