export type InventoryMovementType = "entrada" | "salida" | "ajuste" | "venta";

export type InventoryProduct = {
  id: string;
  name: string;
  active: boolean;
  stock: number;
  stockMin: number;
  costPrice?: number;
  price: number;
  marginPercentage?: number;
};

export type InventoryMovement = {
  id: string;
  productId: string;
  productName: string;
  type: InventoryMovementType;
  quantityDelta: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
};

export type InventorySnapshot = {
  products: InventoryProduct[];
  movements: InventoryMovement[];
};

export type CreateInventoryMovementInput = {
  productId: string;
  type: "entrada" | "salida" | "ajuste";
  /** Entrada y salida usan un valor positivo; ajuste acepta delta positivo o negativo. */
  quantity: number;
  reason: string;
};

export async function getAdminInventory(productId?: string): Promise<{ success: boolean; data?: InventorySnapshot; error?: string }> {
  try {
    const search = productId ? `?productId=${encodeURIComponent(productId)}` : "";
    const response = await fetch(`/api/admin/inventory${search}`, { method: "GET" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      return { success: false, error: body.error || body.message || "No se pudo cargar el inventario." };
    }

    return { success: true, data: body.data as InventorySnapshot };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "No se pudo cargar el inventario." };
  }
}

export async function createInventoryMovement(
  input: CreateInventoryMovementInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      return { success: false, error: body.error || body.message || "No se pudo registrar el movimiento." };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "No se pudo registrar el movimiento." };
  }
}
