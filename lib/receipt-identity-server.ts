import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminServerClient } from "@/lib/supabase/server";
import { DEFAULT_RECEIPT_IDENTITY, parseReceiptIdentity, type ReceiptIdentity } from "@/lib/receipt-identity";
import type { ReceiptResult } from "@/lib/store/order-receipt";
import type { Json } from "@/lib/supabase/database.types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function readReceiptIdentity() {
  const { data, error } = await createAdminServerClient().from("site_settings").select("receipt_identity").eq("id", 1).maybeSingle();
  if (error && ["42703", "PGRST204"].includes(error.code)) return { settings: DEFAULT_RECEIPT_IDENTITY, revision: null, available: false };
  if (error || !data) throw Error("No se pudo leer la identidad de comprobantes.");
  const envelope = (data as unknown as { receipt_identity: { version?: number; revision?: string; settings?: unknown } | null }).receipt_identity;
  if (!envelope) return { settings: DEFAULT_RECEIPT_IDENTITY, revision: null, available: true };
  if (envelope.version !== 1 || !envelope.revision || !uuid.test(envelope.revision)) throw Error("Configuración guardada inválida.");
  return { settings: parseReceiptIdentity(envelope.settings), revision: envelope.revision, available: true };
}
export async function saveReceiptIdentity(settings: ReceiptIdentity, expectedRevision: unknown) {
  const validated = parseReceiptIdentity(settings);
  if (expectedRevision !== null && (typeof expectedRevision !== "string" || !uuid.test(expectedRevision))) throw Error("Revisión inválida.");
  const revision = randomUUID();
  let query = createAdminServerClient().from("site_settings").update({ receipt_identity: { version: 1, revision, settings: validated } as unknown as Json } as never).eq("id", 1);
  query = expectedRevision === null ? query.is("receipt_identity", null) : query.eq("receipt_identity->>revision", expectedRevision);
  const { data, error } = await query.select("receipt_identity").maybeSingle();
  if (error) throw Error("No se pudo guardar. La configuración de base debe estar habilitada.");
  return data ? { settings: validated, revision, available: true } : null;
}
export async function withReceiptIdentity(result: ReceiptResult): Promise<ReceiptResult> {
  if (result.status !== "ok") return result;
  try { return { ...result, receipt: { ...result.receipt, visual: (await readReceiptIdentity()).settings } }; }
  catch { return { status: "incident", message: "No se pudo preparar el diseño del comprobante. Volvé a intentarlo." }; }
}
