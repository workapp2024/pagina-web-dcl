import { createClientUuid } from "@/lib/client-uuid";
import { checkoutFingerprint, normalizeOrderItems, type OrderItemInput } from "@/lib/store/order-input";

export const ATTEMPT_KEY = "dcl-checkout-attempt-v1";
export const LAST_ORDER_KEY = "dcl-last-order-v1";
export type CheckoutAttempt = { key: string; fingerprint: string; items: OrderItemInput[]; createdAt: number };
export function readCheckoutAttempt(storage: Storage): CheckoutAttempt | null {
  const raw = storage.getItem(ATTEMPT_KEY);
  if (!raw) return null;
  // Malformed persistence fails closed, rather than silently choosing a new key.
  const value = JSON.parse(raw) as CheckoutAttempt;
  if (!/^[a-f0-9-]{36}$/i.test(value.key) || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Number.isFinite(value.createdAt)) throw new Error("No pudimos recuperar el intento guardado. Contactá a DCL antes de repetir la compra.");
  return { ...value, items: normalizeOrderItems(value.items) };
}
export async function prepareCheckoutAttempt(storage: Storage, items: OrderItemInput[], method: string, form: Record<string, string>): Promise<CheckoutAttempt> {
  const normalizedForm = { ...form, address: form.fulfillment === "delivery" ? form.address : "" };
  // Only the digest is persisted, never the name, phone, email, address or notes.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(checkoutFingerprint(items, method, normalizedForm)));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const previous = readCheckoutAttempt(storage);
  if (previous?.fingerprint === fingerprint) return previous;
  const attempt = { key: createClientUuid(), fingerprint, items: normalizeOrderItems(items), createdAt: Date.now() };
  storage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  return attempt;
}
export function finishCheckoutAttempt(storage: Storage, key: string, orderNumber: string) {
  if (!/^DCL-[0-9]{6,19}$/.test(orderNumber)) throw new Error("Pedido inválido");
  storage.setItem(LAST_ORDER_KEY, orderNumber);
  if (readCheckoutAttempt(storage)?.key === key) storage.removeItem(ATTEMPT_KEY);
}
export function lastOrderNumber(storage: Storage) {
  const number = storage.getItem(LAST_ORDER_KEY);
  return number && /^DCL-[0-9]{6,19}$/.test(number) ? number : null;
}
// Per-tab fallback; server-side idempotency remains authoritative.
let checkoutQueue: Promise<void> = Promise.resolve();
export async function checkoutLock<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request("dcl-checkout", action);
  const result = checkoutQueue.then(action);
  checkoutQueue = result.then(() => {}, () => {});
  return result;
}
