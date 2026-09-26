import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminServerClient } from "@/lib/supabase/server";

export const BUYER_COOKIE = "dcl_buyer_session";
export const BUYER_MAX_AGE = 30 * 24 * 60 * 60;
export const buyerCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
  path: "/", maxAge: BUYER_MAX_AGE,
};
export const hashBuyerToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isOrderNumber = (value: unknown): value is string => typeof value === "string" && /^DCL-[0-9]{6,19}$/.test(value);
export const buyerNotFound = () => Response.json({ ok: false, error: "Pedido no disponible en este navegador." }, { status: 404, headers: { "Cache-Control": "no-store" } });
export function isSameOriginWrite(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
export async function getBuyerSession(): Promise<{ id: string } | null> {
  const token = (await cookies()).get(BUYER_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = hashBuyerToken(token);
  const { data, error } = await createAdminServerClient().from("buyer_sessions" as never)
    .select("id,token_hash,expires_at").eq("token_hash", hash).maybeSingle() as unknown as {
      data: { id: string; token_hash: string; expires_at: string } | null; error: unknown;
    };
  if (error) throw new Error("Buyer session read failed");
  if (!data || !/^[a-f0-9]{64}$/.test(data.token_hash) || !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(data.token_hash, "hex"))
    || !(Date.parse(data.expires_at) > Date.now())) return null;
  return { id: data.id };
}
export async function establishBuyerSession() {
  if (await getBuyerSession()) return;
  const token = randomBytes(32).toString("hex");
  const { error } = await createAdminServerClient().from("buyer_sessions" as never)
    .insert({ token_hash: hashBuyerToken(token) } as never);
  if (error) throw new Error("Buyer session creation failed");
  (await cookies()).set(BUYER_COOKIE, token, buyerCookieOptions);
}
export async function claimBuyerAttempt(sessionId: string, key: string, fingerprint: string) {
  const { data, error } = await createAdminServerClient().rpc("claim_buyer_order_attempt" as never,
    { p_session: sessionId, p_key: key, p_hash: hashBuyerToken(fingerprint) } as never);
  if (error) throw new Error("Buyer attempt claim failed");
  return data === true;
}
export async function recoverBuyerOrder(sessionId: string, key: string): Promise<string | null> {
  const { data, error } = await createAdminServerClient().rpc("recover_buyer_order" as never, { p_session: sessionId, p_key: key } as never);
  if (error) throw new Error("Buyer order recovery failed");
  return isOrderNumber(data) ? data : null;
}
// Returns the internal ID ONLY to server-side callers, never in the public DTO.
export async function authorizedBuyerOrder(number: unknown): Promise<string | null> {
  if (!isOrderNumber(number)) return null;
  const session = await getBuyerSession();
  if (!session) return null;
  const db = createAdminServerClient();
  const { data: order, error } = await db.from("orders").select("id").eq("order_number", number).maybeSingle() as unknown as { data: { id: string } | null; error: unknown };
  if (error) throw new Error("Order authorization failed");
  if (!order) return null;
  const { data: link, error: linkError } = await db.from("buyer_session_orders" as never).select("order_id")
    .eq("session_id", session.id).eq("order_id", order.id).maybeSingle();
  if (linkError) throw new Error("Order authorization failed");
  return link ? order.id : null;
}
