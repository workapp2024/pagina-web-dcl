import "server-only";
import { cookies } from "next/headers";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { hashWholesaleCode, hashWholesaleSessionToken, verifyWholesaleHash } from "@/lib/wholesale-access";

export const WHOLESALE_SESSION_COOKIE = "dcl_wholesale_session";
export const WHOLESALE_SESSION_MAX_AGE = 8 * 60 * 60;
export const wholesaleSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: WHOLESALE_SESSION_MAX_AGE,
};

type WholesaleCustomer = {
  id: string;
  wholesale_code_hash: string;
  wholesale_enabled: boolean;
  wholesale_access_active: boolean;
  archived_at: string | null;
  wholesale_code_updated_at: string | null;
};

export async function findActiveWholesaleCustomerByCode(code: string) {
  if (!isServiceRoleConfigured()) return { customer: null, unavailable: true };
  const hash = hashWholesaleCode(code);
  const { data, error } = await createAdminServerClient().from("customers")
    .select("id,wholesale_code_hash,wholesale_enabled,wholesale_access_active,archived_at,wholesale_code_updated_at")
    .eq("wholesale_code_hash", hash).maybeSingle() as unknown as { data: WholesaleCustomer | null; error: unknown };
  if (error) return { customer: null, unavailable: true };
  if (!data || !data.wholesale_enabled || !data.wholesale_access_active || data.archived_at || !data.wholesale_code_updated_at) {
    return { customer: null, unavailable: false };
  }
  return { customer: data, unavailable: false };
}

export async function createWholesaleSession(customerId: string, codeUpdatedAt: string, token: string) {
  if (!isServiceRoleConfigured()) return false;
  const expiresAt = new Date(Date.now() + WHOLESALE_SESSION_MAX_AGE * 1000).toISOString();
  const { error } = await createAdminServerClient().from("wholesale_access_sessions" as never).insert({
    token_hash: hashWholesaleSessionToken(token), customer_id: customerId,
    wholesale_code_updated_at: codeUpdatedAt, expires_at: expiresAt,
  } as never);
  return !error;
}

export async function deleteWholesaleSession(token: string) {
  if (!isServiceRoleConfigured() || !/^[a-f0-9]{64}$/.test(token)) return false;
  const { error } = await createAdminServerClient().from("wholesale_access_sessions" as never)
    .delete().eq("token_hash", hashWholesaleSessionToken(token));
  return !error;
}

export async function isWholesaleSessionValid(token?: string | null) {
  const sessionToken = token ?? (await cookies()).get(WHOLESALE_SESSION_COOKIE)?.value;
  if (!sessionToken || !/^[a-f0-9]{64}$/.test(sessionToken) || !isServiceRoleConfigured()) return false;
  const tokenHash = hashWholesaleSessionToken(sessionToken);
  const db = createAdminServerClient();
  const { data: session, error: sessionError } = await db.from("wholesale_access_sessions" as never)
    .select("token_hash,customer_id,wholesale_code_updated_at,expires_at")
    .eq("token_hash", tokenHash).maybeSingle() as unknown as { data: { token_hash: string; customer_id: string; wholesale_code_updated_at: string; expires_at: string } | null; error: unknown };
  if (sessionError || !session) return false;
  if (!verifyWholesaleHash(tokenHash, session.token_hash) || Date.parse(session.expires_at) <= Date.now()) return false;
  const { data: customer, error: customerError } = await db.from("customers")
    .select("wholesale_enabled,wholesale_access_active,archived_at,wholesale_code_updated_at")
    .eq("id", session.customer_id).maybeSingle() as unknown as { data: { wholesale_enabled: boolean; wholesale_access_active: boolean; archived_at: string | null; wholesale_code_updated_at: string | null } | null; error: unknown };
  return !customerError && Boolean(customer && customer.wholesale_enabled && customer.wholesale_access_active
    && !customer.archived_at && customer.wholesale_code_updated_at === session.wholesale_code_updated_at);
}

export type WholesaleCatalogItem = {
  id: string; name: string; description: string; imageUrl: string; category: string;
  connectorType: string | null; vehicleTypes: string[]; wholesalePrice: number;
};

export async function loadWholesaleCatalog(): Promise<WholesaleCatalogItem[]> {
  if (!isServiceRoleConfigured()) throw new Error("Wholesale catalog unavailable");
  const { data, error } = await createAdminServerClient().from("products")
    .select("id,name,description,image_url,category,connector_type,vehicle_types,wholesale_price")
    .eq("active", true).eq("show_in_catalog", true).not("wholesale_price", "is", null)
    .gt("wholesale_price", 0).order("sort_order", { ascending: true });
  if (error) throw new Error("Wholesale catalog unavailable");
  const rows = (data || []) as unknown as { id: string; name: string; description: string | null; image_url: string | null; category: string | null; connector_type: string | null; vehicle_types: string[] | null; wholesale_price: number | null }[];
  return rows.filter(row => Number.isFinite(Number(row.wholesale_price)) && Number(row.wholesale_price) > 0)
    .map(row => ({
      id: row.id, name: row.name, description: row.description || "", imageUrl: row.image_url || "",
      category: row.category || "", connectorType: row.connector_type || null,
      vehicleTypes: Array.isArray(row.vehicle_types) ? row.vehicle_types : [], wholesalePrice: Number(row.wholesale_price),
    }));
}
