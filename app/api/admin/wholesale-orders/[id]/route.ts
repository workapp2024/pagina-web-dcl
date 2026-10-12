/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";

async function guard() {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN") return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Administración no configurada.", 503);
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await guard();
  if (blocked) return blocked;
  const { id } = await context.params;
  if (!isUuid(id)) return apiError("BAD_REQUEST", "El pedido seleccionado no es válido.", 400);
  try {
    const db = createAdminServerClient() as any;
    const result = await db.from("wholesale_orders").select("id,order_number,customer_id,status,current_revision_id,created_at,updated_at,confirmed_at,closed_at").eq("id", id).maybeSingle() as { data: { id: string; order_number: string; customer_id: string; status: string; current_revision_id: string; created_at: string; updated_at: string; confirmed_at: string | null; closed_at: string | null } | null; error: { message: string } | null };
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return apiError("NOT_FOUND", "No se encontró la solicitud mayorista.", 404);
    const order = result.data;
    const [customer, revision, events, originalRevisionResult, inventoryMovements, deliveryHeaders] = await Promise.all([
      db.from("customers").select("full_name").eq("id", order.customer_id).maybeSingle(),
      db.from("wholesale_order_revisions").select("id,version_number,revision_type,status,requires_customer_approval,commercial_conditions,total_amount,currency,created_at").eq("id", order.current_revision_id).maybeSingle(),
      db.from("wholesale_order_events").select("id,event_type,actor_type,actor_id,source,approval_channel,created_at").eq("order_id", id).order("created_at", { ascending: true }).order("id", { ascending: true }),
      db.from("wholesale_order_revisions").select("id,version_number,revision_type,status,requires_customer_approval,commercial_conditions,total_amount,currency,created_at").eq("order_id", id).eq("revision_type", "original").order("version_number", { ascending: true }).limit(1).maybeSingle(),
      db.from("wholesale_inventory_movements").select("product_id,reserved_delta").eq("order_id", id),
      db.from("wholesale_deliveries").select("id,revision_id,delivered_at,actor_id").eq("order_id", id).order("delivered_at", { ascending: true }),
    ]) as [
      { data: { full_name: string } | null; error: { message: string } | null },
      { data: { id: string; version_number: number; revision_type: string; status: string; requires_customer_approval: boolean; commercial_conditions: string; total_amount: string | number; currency: string; created_at: string } | null; error: { message: string } | null },
      { data: { id: number; event_type: string; actor_type: string; actor_id: string | null; source: string; approval_channel: string | null; created_at: string }[] | null; error: { message: string } | null },
      { data: { id: string; version_number: number; revision_type: string; status: string; requires_customer_approval: boolean; commercial_conditions: string; total_amount: string | number; currency: string; created_at: string } | null; error: { message: string } | null },
      { data: { product_id: string; reserved_delta: number }[] | null; error: { message: string } | null },
      { data: { id: string; revision_id: string; delivered_at: string; actor_id: string }[] | null; error: { message: string } | null },
    ];
    if (customer.error || revision.error || events.error || originalRevisionResult.error || inventoryMovements.error || deliveryHeaders.error) throw new Error(customer.error?.message ?? revision.error?.message ?? events.error?.message ?? originalRevisionResult.error?.message ?? inventoryMovements.error?.message ?? deliveryHeaders.error?.message);
    const currentRevision = revision.data;
    if (!currentRevision) throw new Error("La revisión vigente no está disponible.");
    const items = await db.from("wholesale_order_revision_items").select("product_id,product_name_snapshot,category_snapshot,connector_type_snapshot,quantity,unit_price,line_total,currency").eq("revision_id", currentRevision.id).order("product_name_snapshot") as { data: { product_id: string; product_name_snapshot: string; category_snapshot: string | null; connector_type_snapshot: string | null; quantity: number; unit_price: string | number; line_total: string | number; currency: string }[] | null; error: { message: string } | null };
    if (items.error) throw new Error(items.error.message);
    const originalRevision = originalRevisionResult.data;
    const originalItems = originalRevision
      ? originalRevision.id === currentRevision.id
        ? items
        : await db.from("wholesale_order_revision_items").select("product_id,product_name_snapshot,category_snapshot,connector_type_snapshot,quantity,unit_price,line_total,currency").eq("revision_id", originalRevision.id).order("product_name_snapshot") as { data: { product_id: string; product_name_snapshot: string; category_snapshot: string | null; connector_type_snapshot: string | null; quantity: number; unit_price: string | number; line_total: string | number; currency: string }[] | null; error: { message: string } | null }
      : null;
    if (originalItems?.error) throw new Error(originalItems.error.message);
    const revisionItems = (items.data ?? []).map(item => ({
      productId: item.product_id, name: item.product_name_snapshot, category: item.category_snapshot,
      connectorType: item.connector_type_snapshot, quantity: item.quantity, unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total), currency: item.currency,
    }));
    const deliveryIds = (deliveryHeaders.data ?? []).map(delivery => delivery.id);
    const deliveryItemsResult = deliveryIds.length
      ? await db.from("wholesale_delivery_items").select("delivery_id,product_id,quantity").in("delivery_id", deliveryIds)
      : { data: [], error: null };
    if (deliveryItemsResult.error) throw new Error(deliveryItemsResult.error.message);
    const reservedByProduct = new Map<string, number>();
    for (const movement of inventoryMovements.data ?? []) reservedByProduct.set(movement.product_id, (reservedByProduct.get(movement.product_id) ?? 0) + movement.reserved_delta);
    const deliveredByProduct = new Map<string, number>();
    for (const item of deliveryItemsResult.data ?? []) deliveredByProduct.set(item.product_id, (deliveredByProduct.get(item.product_id) ?? 0) + item.quantity);
    const itemTotal = revisionItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const storedTotal = Number(currentRevision.total_amount);
    if (!Number.isFinite(storedTotal) || !revisionItems.every(item => Number.isFinite(item.lineTotal) && Number.isFinite(item.unitPrice) && item.lineTotal === Math.round(item.unitPrice * item.quantity * 100) / 100 && item.currency.trim() === currentRevision.currency.trim()) || Math.round(itemTotal * 100) !== Math.round(storedTotal * 100)) {
      throw new Error("El total de la revisión no coincide con sus artículos.");
    }
    const originalRevisionItems = (originalItems?.data ?? []).map((item: { product_id: string; product_name_snapshot: string; category_snapshot: string | null; connector_type_snapshot: string | null; quantity: number; unit_price: string | number; line_total: string | number; currency: string }) => ({
      productId: item.product_id, name: item.product_name_snapshot, category: item.category_snapshot,
      connectorType: item.connector_type_snapshot, quantity: item.quantity, unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total), currency: item.currency,
    }));
    const originalTotal = originalRevisionItems.reduce((sum: number, item: { lineTotal: number }) => sum + item.lineTotal, 0);
    if (originalRevision && (!Number.isFinite(Number(originalRevision.total_amount)) || !originalRevisionItems.every((item: { lineTotal: number; unitPrice: number; quantity: number; currency: string }) =>
      Number.isFinite(item.lineTotal) && Number.isFinite(item.unitPrice) && item.lineTotal === Math.round(item.unitPrice * item.quantity * 100) / 100 && item.currency.trim() === originalRevision.currency.trim()) ||
      Math.round(originalTotal * 100) !== Math.round(Number(originalRevision.total_amount) * 100))) {
      throw new Error("El total original no coincide con sus artículos.");
    }
    const actorIds = [...new Set((events.data ?? []).filter(event => event.actor_type === "admin" && event.actor_id).map(event => event.actor_id as string))];
    const actors = (actorIds.length ? await db.from("admin_profiles").select("id,display_name").in("id", actorIds) : { data: [], error: null }) as { data: { id: string; display_name: string }[] | null; error: { message: string } | null };
    if (actors.error) throw new Error(actors.error.message);
    const actorNames = new Map((actors.data ?? []).map(actor => [actor.id, actor.display_name]));
    return NextResponse.json({ ok: true, data: {
      id: order.id, orderNumber: order.order_number, status: order.status,
      createdAt: order.created_at, updatedAt: order.updated_at, confirmedAt: order.confirmed_at, closedAt: order.closed_at,
      customer: customer.data?.full_name ?? "Cliente",
      revision: { ...currentRevision, totalAmount: itemTotal, items: revisionItems },
      deliveryProgress: revisionItems.map(item => ({ productId: item.productId, ordered: item.quantity,
        delivered: deliveredByProduct.get(item.productId) ?? 0, reservedRemaining: reservedByProduct.get(item.productId) ?? 0 })),
      deliveries: (deliveryHeaders.data ?? []).map(delivery => ({ id: delivery.id, revisionId: delivery.revision_id,
        deliveredAt: delivery.delivered_at, actorId: delivery.actor_id,
        items: (deliveryItemsResult.data ?? []).filter((item: { delivery_id: string }) => item.delivery_id === delivery.id)
          .map((item: { product_id: string; quantity: number }) => ({ productId: item.product_id, quantity: item.quantity })) })),
      originalRevision: originalRevision ? {
        id: originalRevision.id, version_number: originalRevision.version_number,
        status: originalRevision.status, commercial_conditions: originalRevision.commercial_conditions,
        totalAmount: originalTotal, currency: originalRevision.currency, items: originalRevisionItems,
      } : null,
      events: (events.data ?? []).map(event => ({
        id: event.id, type: event.event_type, actorType: event.actor_type,
        actor: event.actor_type === "admin" && event.actor_id ? actorNames.get(event.actor_id) ?? "Administrador" : event.actor_type === "customer" ? "Cliente" : "Sistema",
        channel: event.approval_channel ?? event.source, createdAt: event.created_at,
      })),
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo cargar el detalle mayorista.", 500);
  }
}

function parseProposalItems(value: unknown): { productId: string; quantity: number }[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some(key => key !== "productId" && key !== "quantity") ||
      typeof entry.productId !== "string" || !Number.isInteger(entry.quantity)) return null;
    const productId = entry.productId.trim();
    const quantity = entry.quantity as number;
    if (!productId || productId.length > 64 || quantity < 1 || quantity > 100) return null;
    const total = (quantities.get(productId) ?? 0) + quantity;
    if (total > 100) return null;
    quantities.set(productId, total);
  }
  if (quantities.size < 1 || quantities.size > 50) return null;
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}

function operationError(message: string) {
  if (message.includes("WHOLESALE_PROPOSAL_UNCHANGED")) {
    return apiError("BAD_REQUEST", "La revisión vigente ya contiene estos datos. Actualizá el detalle antes de crear otra propuesta.", 409);
  }
  if (message.includes("WHOLESALE_REVISION_STALE")) {
    return NextResponse.json({ ok: false, error: "WHOLESALE_REVISION_STALE", message: "El pedido cambió desde que lo abriste. Recargá y revisá la versión vigente antes de continuar." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (message.includes("WHOLESALE_IDEMPOTENCY_CONFLICT")) {
    return NextResponse.json({ ok: false, error: "WHOLESALE_IDEMPOTENCY_CONFLICT", message: "Esta operación ya se registró con otros datos. Actualizá el pedido antes de intentar otra vez." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (message.includes("WHOLESALE_ORDER_INVALID_STATE") || message.includes("WHOLESALE_REVISION_INVALID_STATE") || message.includes("WHOLESALE_REVISION_NOT_CONFIRMABLE")) {
    return apiError("BAD_REQUEST", "El estado actual del pedido no permite esta acción. Actualizá el detalle.", 409);
  }
  if (message.includes("WHOLESALE_INSUFFICIENT_STOCK")) return apiError("OUT_OF_STOCK", "No hay unidades suficientes en el inventario mayorista para confirmar esta revisión.", 409);
  if (message.includes("WHOLESALE_DELIVERY_QUANTITY_INVALID")) return apiError("BAD_REQUEST", "La cantidad supera las unidades pendientes de entrega o reserva.", 409);
  if (message.includes("WHOLESALE_REVISION_STALE")) return apiError("BAD_REQUEST", "El pedido ya no tiene esa revisión confirmada. Actualizá el detalle.", 409);
  if (message.includes("WHOLESALE_ORDER_NOT_FOUND")) return apiError("NOT_FOUND", "No se encontró la solicitud mayorista.", 404);
  if (message.includes("WHOLESALE_ADMIN_REQUIRED")) return apiError("FORBIDDEN", "No autorizado para esta acción.", 403);
  if (message.includes("WHOLESALE_INVALID_REQUEST") || message.includes("WHOLESALE_INVALID_ITEMS") || message.includes("WHOLESALE_PRODUCT_UNAVAILABLE")) {
    return apiError("BAD_REQUEST", "Revisá los datos de la operación y los artículos.", 400);
  }
  return apiError("INTERNAL_ERROR", "No se pudo completar la acción mayorista. Intentá nuevamente.", 500);
}

function parseInternalNote(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  return boundedString(value, 1000);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN" || identity.legacy || !isUuid(identity.id)) {
    return apiError("FORBIDDEN", "No autorizado para esta acción mayorista.", 403);
  }
  if (!isWholesaleSessionWriteAllowed(request)) return apiError("FORBIDDEN", "No se pudo validar el origen de la solicitud.", 403);
  const { id } = await context.params;
  if (!isUuid(id)) return apiError("BAD_REQUEST", "El pedido seleccionado no es válido.", 400);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return apiError("BAD_REQUEST", "El formato de la solicitud no es válido.", 400);
  }
  const body = await readJsonObject(request);
  if (!body || typeof body.action !== "string") return apiError("BAD_REQUEST", "La acción solicitada no es válida.", 400);

  let rpcName: string;
  let rpcArgs: Record<string, unknown>;
  let resultKind: "revision" | "start_review" | "confirm" | "reject" | "delivery";
  if (body.action === "start_review") {
    if (Object.keys(body).some(key => key !== "action")) return apiError("BAD_REQUEST", "Los datos de la operación no son válidos.", 400);
    rpcName = "start_wholesale_order_review";
    rpcArgs = { p_order: id, p_actor: identity.id };
    resultKind = "start_review";
  } else if (body.action === "confirm") {
    if (Object.keys(body).some(key => key !== "action" && key !== "revisionId") || !isUuid(body.revisionId)) {
      return apiError("BAD_REQUEST", "Indicá una revisión vigente válida para confirmar.", 400);
    }
    rpcName = "confirm_wholesale_order_revision";
    rpcArgs = { p_order: id, p_revision: body.revisionId, p_actor: identity.id };
    resultKind = "confirm";
  } else if (body.action === "reject") {
    if (Object.keys(body).some(key => key !== "action" && key !== "internalNote")) return apiError("BAD_REQUEST", "Los datos de rechazo no son válidos.", 400);
    const internalNote = parseInternalNote(body.internalNote);
    if (internalNote === null) return apiError("BAD_REQUEST", "La nota interna debe tener hasta 1.000 caracteres.", 400);
    rpcName = "close_wholesale_order";
    rpcArgs = { p_order: id, p_action: "reject", p_actor: identity.id, p_internal_note: internalNote };
    resultKind = "reject";
  } else if (body.action === "deliver") {
    if (Object.keys(body).some(key => !["action", "revisionId", "idempotencyKey", "items"].includes(key)) ||
      !isUuid(body.revisionId) || !isUuid(body.idempotencyKey)) return apiError("BAD_REQUEST", "Indicá una entrega válida.", 400);
    const items = parseProposalItems(body.items);
    if (!items) return apiError("BAD_REQUEST", "Revisá las cantidades de la entrega.", 400);
    rpcName = "record_wholesale_delivery";
    rpcArgs = { p_order: id, p_revision: body.revisionId, p_items: items, p_key: body.idempotencyKey, p_actor: identity.id };
    resultKind = "delivery";
  } else if (body.action === "propose") {
    const allowedKeys = ["action", "expectedRevisionId", "items", "idempotencyKey", "commercialConditions", "internalNote"];
    if (Object.keys(body).some(key => !allowedKeys.includes(key)) ||
      !isUuid(body.expectedRevisionId) || !isUuid(body.idempotencyKey)) {
      return apiError("BAD_REQUEST", "Revisá la revisión y la clave de la propuesta.", 400);
    }
    const items = parseProposalItems(body.items);
    const conditions = body.commercialConditions === undefined || body.commercialConditions === null
      ? null : boundedString(body.commercialConditions, 2000, { trim: false });
    const internalNote = parseInternalNote(body.internalNote);
    if (!items || (conditions === null && body.commercialConditions !== undefined && body.commercialConditions !== null) ||
      (body.commercialConditions !== undefined && body.commercialConditions !== null && typeof body.commercialConditions !== "string") ||
      internalNote === null) {
      return apiError("BAD_REQUEST", "Revisá los artículos, las condiciones y la nota interna.", 400);
    }
    rpcName = "propose_wholesale_order_revision_if_current";
    rpcArgs = { p_order: id, p_expected_revision: body.expectedRevisionId, p_items: items,
      p_idempotency_key: body.idempotencyKey, p_actor: identity.id,
      p_commercial_conditions: conditions, p_internal_note: internalNote };
    resultKind = "revision";
  } else {
    return apiError("BAD_REQUEST", "La acción solicitada no está disponible.", 400);
  }

  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Administración no configurada.", 503);
  try {
    const db = createAdminServerClient() as any;
    const result = await db.rpc(rpcName, rpcArgs) as { data: unknown; error: { message?: string } | null };
    if (result.error) return operationError(result.error.message ?? "");
    if (resultKind === "revision") {
      if (!isUuid(result.data)) return apiError("INTERNAL_ERROR", "No se pudo confirmar el resultado de la propuesta.", 500);
      return NextResponse.json({ ok: true, data: { status: "proposed", revisionId: result.data } }, { headers: { "Cache-Control": "no-store" } });
    }
    const expectedStatus = resultKind === "start_review" ? "in_review" : "rejected";
    if (resultKind === "confirm") {
      if (!isUuid(result.data)) return apiError("INTERNAL_ERROR", "No se pudo confirmar el resultado de la operación.", 500);
      return NextResponse.json({ ok: true, data: { status: "confirmed" } }, { headers: { "Cache-Control": "no-store" } });
    }
    if (resultKind === "delivery") {
      if (!isUuid(result.data)) return apiError("INTERNAL_ERROR", "No se pudo confirmar el registro de entrega.", 500);
      return NextResponse.json({ ok: true, data: { status: "delivered", deliveryId: result.data } }, { headers: { "Cache-Control": "no-store" } });
    }
    if (result.data !== expectedStatus) return apiError("INTERNAL_ERROR", "No se pudo confirmar el resultado de la operación.", 500);
    return NextResponse.json({ ok: true, data: { status: expectedStatus } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo completar la acción mayorista. Intentá nuevamente.", 500);
  }
}
