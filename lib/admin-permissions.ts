export type AdminRole = "ADMIN" | "VENDEDOR";
export type AdminPermission = "admin" | "catalog" | "commercial" | "stock:read" | "orders:operate";

export function hasAdminPermission(role: AdminRole, permission: AdminPermission = "admin") {
  return role === "ADMIN" || (role === "VENDEDOR" && permission !== "admin");
}

const sellerPages = new Set(["/admin", "/admin/mi-cuenta", "/admin/productos", "/admin/compatibilidades", "/admin/pedidos", "/admin/ventas", "/admin/clientes", "/admin/inventario"]);
export function canVisitAdminPage(role: AdminRole, path: string) {
  return role === "ADMIN" || (role === "VENDEDOR" && (sellerPages.has(path) || /^\/admin\/pedidos\/DCL-[0-9]{6,19}\/comprobante\/?$/.test(path)));
}

export type AdminIdentity = { id: string; role: AdminRole; name: string; legacy: boolean; sessionVersion?: number };
export type StaffProfile = { id: string; email: string; display_name: string; role: AdminRole; active: boolean; session_version: number };
