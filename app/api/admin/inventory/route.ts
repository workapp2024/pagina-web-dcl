import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { apiError, apiInternalError, boundedString, readJsonObject } from "@/lib/api";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type {
  CreateInventoryMovementInput,
  InventoryMovement,
  InventoryProduct,
  InventorySnapshot,
} from "@/lib/supabase/inventory";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type InventoryMovementRow = Database["public"]["Tables"]["inventory_movements"]["Row"];
type InventoryMovementInsert = Database["public"]["Tables"]["inventory_movements"]["Insert"];

const INVENTORY_PRODUCT_SELECT = "id,name,active,price,cost_price,margin_percentage,stock,stock_min";
const INVENTORY_MOVEMENT_SELECT = "id,product_id,movement_type,quantity_delta,reason,reference_type,reference_id,created_at";

async function requireInventoryAdmin() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, message: "No autorizado." }, { status: 401 });
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY para administrar el inventario." },
      { status: 500 },
    );
  }

  return null;
}

function mapProduct(row: Pick<ProductRow, "id" | "name" | "active" | "price" | "cost_price" | "margin_percentage" | "stock" | "stock_min">): InventoryProduct {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    price: Number(row.price),
    costPrice: row.cost_price ?? undefined,
    marginPercentage: row.margin_percentage ?? undefined,
    stock: row.stock,
    stockMin: row.stock_min,
  };
}

function mapMovement(row: InventoryMovementRow, productName: string): InventoryMovement {
  return {
    id: row.id,
    productId: row.product_id,
    productName,
    type: row.movement_type,
    quantityDelta: row.quantity_delta,
    reason: row.reason,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const accessError = await requireInventoryAdmin();
  if (accessError) return accessError;

  try {
    const productId = new URL(request.url).searchParams.get("productId")?.trim();
    const supabase = createAdminServerClient();

    const productsQuery = productId
      ? supabase.from("products").select(INVENTORY_PRODUCT_SELECT).eq("id", productId)
      : supabase.from("products").select(INVENTORY_PRODUCT_SELECT).order("name");
    const movementsQuery = productId
      ? supabase.from("inventory_movements").select(INVENTORY_MOVEMENT_SELECT).eq("product_id", productId).order("created_at", { ascending: false })
      : supabase.from("inventory_movements").select(INVENTORY_MOVEMENT_SELECT).order("created_at", { ascending: false });

    const [{ data: productData, error: productsError }, { data: movementData, error: movementsError }] = await Promise.all([
      productsQuery,
      movementsQuery,
    ]);

    if (productsError || movementsError) {
      const error = productsError || movementsError;
      return NextResponse.json({ ok: false, error: error?.message || "No se pudo consultar el inventario." }, { status: 500 });
    }

    const products = (productData as ProductRow[]).map(mapProduct);
    const productNames = new Map(products.map((product) => [product.id, product.name]));
    const movements = (movementData as InventoryMovementRow[]).map((movement) =>
      mapMovement(movement, productNames.get(movement.product_id) || "Producto eliminado"),
    );
    const data: InventorySnapshot = { products, movements };

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción al leer inventario:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const accessError = await requireInventoryAdmin();
  if (accessError) return accessError;

  try {
    const payload = await readJsonObject(request) as Partial<CreateInventoryMovementInput> | null;
    if (!payload) return apiError("BAD_REQUEST", "La solicitud no tiene un formato válido.", 400);
    const productId = boundedString(payload.productId, 64, { required: true });
    const type = payload.type;
    const quantity = Number(payload.quantity);
    const reason = boundedString(payload.reason, 500) || "";

    if (!productId || !type || !["entrada", "salida", "ajuste"].includes(type)) {
      return NextResponse.json({ ok: false, message: "Producto y tipo de movimiento válidos son obligatorios." }, { status: 400 });
    }

    if (!Number.isInteger(quantity) || quantity === 0 || Math.abs(quantity) > 100_000) {
      return NextResponse.json({ ok: false, message: "La cantidad debe ser un número entero distinto de cero." }, { status: 400 });
    }

    if ((type === "entrada" || type === "salida") && quantity < 0) {
      return NextResponse.json({ ok: false, message: "Para entradas y salidas, ingresá una cantidad positiva." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ ok: false, message: "El motivo es obligatorio para registrar un movimiento." }, { status: 400 });
    }

    const quantityDelta = type === "salida" ? -quantity : quantity;
    const supabase = createAdminServerClient();
    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id,stock")
      .eq("id", productId)
      .maybeSingle();

    if (productError || !productData) {
      return NextResponse.json(
        { ok: false, error: productError?.message || "El producto seleccionado no existe." },
        { status: 404 },
      );
    }

    const currentStock = (productData as Pick<ProductRow, "id" | "stock">).stock;
    if (currentStock + quantityDelta < 0) {
      return NextResponse.json({ ok: false, message: "La operación dejaría el stock en negativo." }, { status: 400 });
    }

    const movement: InventoryMovementInsert = {
      product_id: productId,
      movement_type: type,
      quantity_delta: quantityDelta,
      reason,
    };
    const { data: movementData, error: movementError } = await supabase
      .from("inventory_movements")
      // Ver nota equivalente en /api/admin/products sobre el tipo manual de Supabase.
      .insert(movement as never)
      .select(INVENTORY_MOVEMENT_SELECT)
      .single();

    if (movementError || !movementData) {
      return NextResponse.json(
        { ok: false, error: movementError?.message || "No se pudo registrar el movimiento." },
        { status: 500 },
      );
    }

    const { data: updatedProductData, error: updatedProductError } = await supabase
      .from("products")
      .select("stock")
      .eq("id", productId)
      .single();

    if (updatedProductError || !updatedProductData) {
      return NextResponse.json(
        { ok: false, error: updatedProductError?.message || "Movimiento registrado, pero no se pudo leer el stock actualizado." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        movement: movementData as InventoryMovementRow,
        stock: (updatedProductData as Pick<ProductRow, "stock">).stock,
      },
    });
  } catch (err) {
    console.error("Excepción al registrar movimiento de inventario:", err);
    return apiInternalError("admin_inventory_movement", err);
  }
}
