import type { AdminRole } from "@/lib/admin-permissions";

export type AdminChannel = "all" | "retail" | "wholesale";
export function adminChannels(role: AdminRole, combined: boolean): AdminChannel[] {
  return role === "VENDEDOR" ? ["retail"] : combined ? ["all", "retail", "wholesale"] : ["retail", "wholesale"];
}
export function selectedAdminChannel(value: string | string[] | undefined, role: AdminRole, combined: boolean): AdminChannel {
  const allowed = adminChannels(role, combined);
  return allowed.find(channel => channel === value) ?? allowed[0];
}
