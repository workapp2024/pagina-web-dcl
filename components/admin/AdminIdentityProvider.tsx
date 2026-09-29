"use client";
import { createContext, useContext } from "react";
import type { AdminIdentity } from "@/lib/admin-permissions";

const Context = createContext<AdminIdentity | null>(null);
export const AdminIdentityProvider = Context.Provider;
export function useAdminIdentity() { return useContext(Context); }
export function useIsOwner() { return useAdminIdentity()?.role === "ADMIN"; }
