/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";

const METHODS = ["cash", "bank_transfer", "mercadopago", "debit_card", "credit_card", "other"] as const;
type Context = { params: Promise<{ id: string }> };

async function guard(write = false) {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN" || (write && (identity.legacy || !isUuid(identity.id)))) return { response: apiError("FORBIDDEN", "No autorizado.", 403), identity: null };
  if (!isServiceRoleConfigured()) return { response: apiError("CONFIGURATION_ERROR", "Administración no configurada.", 503), identity: null };
  return { response: null, identity };
}

export async function GET(_request: Request, context: Context) {
  const { response } = await guard();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return apiError("BAD_REQUEST", "El pedido seleccionado no es válido.", 400);
  try {
    const db = createAdminServerClient() as any;
    const [payments, corrections, returns, recognitions, reversals, accountingJournals] = await Promise.all([
      db.from("wholesale_payment_entries").select("id,revision_id,entry_type,refund_of,amount,currency,payment_method,external_reference,occurred_at,actor_id,created_at").eq("order_id", id).order("occurred_at", { ascending: true }),
      db.from("wholesale_delivery_corrections").select("id,delivery_id,revision_id,reason,actor_id,created_at").eq("order_id", id).order("created_at", { ascending: true }),
      db.from("wholesale_physical_returns").select("id,delivery_id,revision_id,reason,actor_id,returned_at").eq("order_id", id).order("returned_at", { ascending: true }),
      db.from("wholesale_sale_recognitions").select("id,revision_id,completion_event_id,amount,currency,recognized_at").eq("order_id", id).order("completion_event_id", { ascending: true }),
      db.from("wholesale_sale_reversals").select("id,recognition_id,reversal_event_id,amount,currency,reason,actor_id,reversed_at").eq("order_id", id).order("reversal_event_id", { ascending: true }),
      db.from("wholesale_accounting_journals").select("id,source_type,source_id,revision_id,recognition_id,payment_entry_id,source_event_id,currency,amount,status,actor_id,occurred_at,created_at,wholesale_accounting_journal_lines(line_number,role,account_reference,debit,credit,currency)").eq("order_id", id).order("created_at", { ascending: true }),
    ]);
    if (payments.error || corrections.error || returns.error || recognitions.error || reversals.error || accountingJournals.error) throw new Error("ledger_read_failed");
    const paymentIds = (payments.data ?? []).map((entry: { id: string }) => entry.id);
    const postings = paymentIds.length ? await db.from("wholesale_financial_postings").select("payment_entry_id,status,account_id,cash_movement_id").in("payment_entry_id",paymentIds) : {data:[],error:null};
    if (postings.error) throw new Error("ledger_read_failed");
    const [mappings, accounts] = await Promise.all([
      db.from("wholesale_financial_account_mappings").select("payment_method,account_id"),
      db.from("financial_accounts").select("id,name").eq("active", true),
    ]);
    if (mappings.error || accounts.error) throw new Error("ledger_read_failed");
    const correctionIds = (corrections.data ?? []).map((entry: { id: string }) => entry.id);
    const returnIds = (returns.data ?? []).map((entry: { id: string }) => entry.id);
    const recognitionIds = (recognitions.data ?? []).map((entry: { id: string }) => entry.id);
    const reconciliation = paymentIds.length
      ? await db.from("wholesale_payment_reconciliation_events").select("id,payment_entry_id,event_type,reason,actor_id,created_at").in("payment_entry_id", paymentIds).order("created_at", { ascending: true })
      : { data: [], error: null };
    const [correctionItems, returnItems] = await Promise.all([
      correctionIds.length ? db.from("wholesale_delivery_correction_items").select("correction_id,product_id,quantity").in("correction_id", correctionIds) : Promise.resolve({ data: [], error: null }),
      returnIds.length ? db.from("wholesale_physical_return_items").select("return_id,product_id,quantity").in("return_id", returnIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const recognitionItems = recognitionIds.length
      ? await db.from("wholesale_sale_recognition_items").select("recognition_id,product_id,product_name_snapshot,quantity,unit_price,line_total,currency").in("recognition_id", recognitionIds)
      : { data: [], error: null };
    const recognitionDeliveries = recognitionIds.length
      ? await db.from("wholesale_sale_recognition_deliveries").select("recognition_id,delivery_id,product_id,quantity").in("recognition_id", recognitionIds)
      : { data: [], error: null };
    if (reconciliation.error || correctionItems.error || returnItems.error || recognitionItems.error || recognitionDeliveries.error) throw new Error("ledger_read_failed");
    return NextResponse.json({ ok: true, data: {
      paymentAccounts: (mappings.data ?? []).flatMap((mapping: {payment_method:string;account_id:string}) => {
        const account = (accounts.data ?? []).find((row: {id:string}) => row.id === mapping.account_id);
        return account ? [{method:mapping.payment_method,name:account.name}] : [];
      }),
      payments: (payments.data ?? []).map((entry: {id:string})=>{
        const posting = (postings.data ?? []).find((row: {payment_entry_id:string})=>row.payment_entry_id===entry.id);
        return {...entry,posting_status:posting?.status ?? null,financial_account_name:(accounts.data ?? []).find((row: {id:string})=>row.id===posting?.account_id)?.name ?? null};
      }), reconciliations: reconciliation.data ?? [],
      accountingJournals: accountingJournals.data ?? [],
      recognitions: (recognitions.data ?? []).map((entry: { id: string }) => ({
        ...entry,
        items: (recognitionItems.data ?? []).filter((item: { recognition_id: string }) => item.recognition_id === entry.id)
          .map((item: { product_id: string; product_name_snapshot: string; quantity: number; unit_price: number; line_total: number; currency: string }) => ({
            productId: item.product_id, name: item.product_name_snapshot, quantity: item.quantity,
            unitPrice: item.unit_price, lineTotal: item.line_total, currency: item.currency,
          })),
        deliveries: (recognitionDeliveries.data ?? []).filter((delivery: { recognition_id: string }) => delivery.recognition_id === entry.id)
          .map((delivery: { delivery_id: string; product_id: string; quantity: number }) => ({
            deliveryId: delivery.delivery_id, productId: delivery.product_id, quantity: delivery.quantity,
          })),
        reversal: (reversals.data ?? []).find((reversal: { recognition_id: string }) => reversal.recognition_id === entry.id) ?? null,
      })),
      deliveryCorrections: (corrections.data ?? []).map((entry: { id: string }) => ({ ...entry, items: (correctionItems.data ?? []).filter((item: { correction_id: string }) => item.correction_id === entry.id).map((item: { product_id: string; quantity: number }) => ({ productId: item.product_id, quantity: item.quantity })) })),
      physicalReturns: (returns.data ?? []).map((entry: { id: string }) => ({ ...entry, items: (returnItems.data ?? []).filter((item: { return_id: string }) => item.return_id === entry.id).map((item: { product_id: string; quantity: number }) => ({ productId: item.product_id, quantity: item.quantity })) })),
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo cargar el libro mayorista.", 500);
  }
}

function parseItems(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const grouped = new Map<string, number>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => key !== "productId" && key !== "quantity") || typeof item.productId !== "string" || !Number.isInteger(item.quantity)) return null;
    const productId = item.productId.trim();
    const quantity = item.quantity as number;
    if (!productId || productId.length > 64 || quantity < 1 || quantity > 100) return null;
    const sum = (grouped.get(productId) ?? 0) + quantity;
    if (sum > 100) return null;
    grouped.set(productId, sum);
  }
  return [...grouped].map(([productId, quantity]) => ({ productId, quantity }));
}

function rpcFailure(message: string) {
  if (message.includes("WHOLESALE_ADMIN_REQUIRED")) return apiError("FORBIDDEN", "No autorizado para esta operación.", 403);
  if (message.includes("WHOLESALE_IDEMPOTENCY_CONFLICT")) return apiError("BAD_REQUEST", "La clave de operación ya se usó con otros datos.", 409);
  if (message.includes("WHOLESALE_CORRECTION_QUANTITY_INVALID")) return apiError("BAD_REQUEST", "La corrección supera las unidades registradas en la entrega.", 409);
  if (message.includes("WHOLESALE_RETURN_QUANTITY_INVALID")) return apiError("BAD_REQUEST", "La devolución supera las unidades entregadas que siguen pendientes de devolución.", 409);
  if (message.includes("WHOLESALE_REFUND_EXCEEDS_PAYMENT")) return apiError("BAD_REQUEST", "El reembolso supera el saldo del cobro original.", 409);
  if (message.includes("WHOLESALE_PAYMENT_EXCEEDS_TOTAL")) return apiError("BAD_REQUEST", "El cobro supera el saldo del pedido confirmado.", 409);
  if (message.includes("WHOLESALE_PAYMENT_REVISION_INVALID")) return apiError("BAD_REQUEST", "El pago debe vincularse a la revisión confirmada vigente.", 409);
  if (message.includes("WHOLESALE_DELIVERY_NOT_CORRECTABLE") || message.includes("WHOLESALE_PAYMENT_NOT_FOUND") || message.includes("WHOLESALE_DELIVERY_NOT_FOUND")) return apiError("NOT_FOUND", "No se encontró el registro indicado.", 404);
  if (message.includes("WHOLESALE_INVALID_PAYMENT") || message.includes("WHOLESALE_INVALID_REFUND") || message.includes("WHOLESALE_INVALID_REQUEST")) return apiError("BAD_REQUEST", "Revisá los datos de la operación.", 400);
  return apiError("INTERNAL_ERROR", "No se pudo registrar la operación mayorista.", 500);
}

export async function POST(request: Request, context: Context) {
  const { response, identity } = await guard(true);
  if (response) return response;
  if (!isWholesaleSessionWriteAllowed(request)) return apiError("FORBIDDEN", "No se pudo validar el origen de la solicitud.", 403);
  const { id } = await context.params;
  if (!isUuid(id) || !request.headers.get("content-type")?.toLowerCase().includes("application/json")) return apiError("BAD_REQUEST", "La solicitud no es válida.", 400);
  const body = await readJsonObject(request);
  if (!body || typeof body.operation !== "string") return apiError("BAD_REQUEST", "Indicá una operación válida.", 400);
  const db = createAdminServerClient() as any;
  let rpc: string;
  let args: Record<string, unknown>;
  if (body.operation === "payment") {
    if (Object.keys(body).some(key => !["operation", "revisionId", "amount", "currency", "method", "externalReference", "occurredAt", "idempotencyKey"].includes(key)) || !isUuid(body.revisionId) || !isUuid(body.idempotencyKey) || !Number.isFinite(body.amount) || typeof body.amount !== "number" || body.amount <= 0 || typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency) || !METHODS.includes(body.method as typeof METHODS[number]) || typeof body.occurredAt !== "string" || !Number.isFinite(Date.parse(body.occurredAt))) return apiError("BAD_REQUEST", "Datos del pago inválidos.", 400);
    const externalReference = body.externalReference === undefined || body.externalReference === null ? null : boundedString(body.externalReference, 200, { trim: true });
    if (externalReference === null && body.externalReference !== undefined && body.externalReference !== null) return apiError("BAD_REQUEST", "La referencia externa es demasiado larga.", 400);
    rpc = "record_wholesale_payment";
    args = { p_order: id, p_revision: body.revisionId, p_amount: body.amount, p_currency: body.currency, p_method: body.method, p_external_reference: externalReference, p_occurred_at: body.occurredAt, p_key: body.idempotencyKey, p_actor: identity!.id };
  } else if (body.operation === "refund") {
    if (Object.keys(body).some(key => !["operation", "paymentId", "amount", "method", "externalReference", "occurredAt", "idempotencyKey"].includes(key)) || !isUuid(body.paymentId) || !isUuid(body.idempotencyKey) || typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0 || !METHODS.includes(body.method as typeof METHODS[number]) || typeof body.occurredAt !== "string" || !Number.isFinite(Date.parse(body.occurredAt))) return apiError("BAD_REQUEST", "Datos del reembolso inválidos.", 400);
    const externalReference = body.externalReference === undefined || body.externalReference === null ? null : boundedString(body.externalReference, 200, { trim: true });
    if (externalReference === null && body.externalReference !== undefined && body.externalReference !== null) return apiError("BAD_REQUEST", "La referencia externa es demasiado larga.", 400);
    rpc = "refund_wholesale_payment";
    args = { p_payment: body.paymentId, p_amount: body.amount, p_method: body.method, p_external_reference: externalReference, p_occurred_at: body.occurredAt, p_key: body.idempotencyKey, p_actor: identity!.id };
  } else if (body.operation === "reconcile" || body.operation === "reverse_reconciliation") {
    if (Object.keys(body).some(key => !["operation", "entryId", "reason", "idempotencyKey"].includes(key)) || !isUuid(body.entryId) || !isUuid(body.idempotencyKey)) return apiError("BAD_REQUEST", "Datos de conciliación inválidos.", 400);
    const reason = boundedString(body.reason, 500, { required: true });
    if (!reason) return apiError("BAD_REQUEST", "El motivo de conciliación es obligatorio.", 400);
    rpc = "record_wholesale_payment_reconciliation";
    args = { p_entry: body.entryId, p_event: body.operation === "reconcile" ? "reconciled" : "reconciliation_reversed", p_reason: reason, p_key: body.idempotencyKey, p_actor: identity!.id };
  } else if (body.operation === "correct_delivery" || body.operation === "physical_return") {
    const common = ["operation", "deliveryId", "items", "reason", "idempotencyKey"];
    if (Object.keys(body).some(key => !common.includes(key)) || !isUuid(body.deliveryId) || !isUuid(body.idempotencyKey)) return apiError("BAD_REQUEST", "Datos de corrección de entrega inválidos.", 400);
    const items = parseItems(body.items);
    const reason = boundedString(body.reason, 500, { required: true });
    if (!items || !reason) return apiError("BAD_REQUEST", "Indicá cantidades y un motivo válido.", 400);
    rpc = body.operation === "correct_delivery" ? "record_wholesale_delivery_correction" : "record_wholesale_physical_return";
    args = { p_order: id, p_delivery: body.deliveryId, p_items: items, p_reason: reason, p_key: body.idempotencyKey, p_actor: identity!.id };
  } else return apiError("BAD_REQUEST", "Operación no disponible.", 400);

  try {
    const result = await db.rpc(rpc, args) as { data: unknown; error: { message?: string } | null };
    if (result.error) return rpcFailure(result.error.message ?? "");
    if (!isUuid(result.data)) return apiError("INTERNAL_ERROR", "No se pudo confirmar el registro.", 500);
    return NextResponse.json({ ok: true, data: { id: result.data } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo registrar la operación mayorista.", 500);
  }
}
