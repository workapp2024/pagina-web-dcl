export type Customer = { id: string; fullName: string; phone?: string; email?: string; notes?: string; createdAt: string };
export type CustomerVehicle = { id: string; customerId: string; brandName: string; modelName: string; year?: number; plate?: string; notes?: string };
export type SaleProduct = { id: string; name: string; price: number; stock: number; active: boolean; category?: string; connectorType?: string; chipType?: string; voltage?: string; watts?: number; lumens?: number };
export type SaleItem = { id: string; productId: string; productName: string; quantity: number; unitPrice: number; unitCost?: number; lineTotal: number };
export type CustomerSale = { id: string; status: string; total: number; notes?: string; paymentMethod?: string; createdAt: string; vehicle?: CustomerVehicle; items: SaleItem[]; installation?: { id: string; status: string }; warranties: Array<{ id: string; status: string; saleItemId: string; claims: Array<{ id: string; status: string; description: string }> }> };
export type CustomerHistory = { customer: Customer; vehicles: CustomerVehicle[]; sales: CustomerSale[] };
export type SalesBootstrap = { customers: Customer[]; summary: SalesSummary };
export type SalesSummary = { total: number; operations: number; products: number; newCustomers: number };
export type GeneralSale = { id: string; createdAt: string; status: string; total: number; customer: Customer; vehicle?: CustomerVehicle; itemCount: number; paymentMethod?: string };
export type SaleDetail = CustomerSale & { customer: Customer; inventoryMovements: Array<{ id: string; productId: string; quantityDelta: number; reason: string; createdAt: string }> };

async function request<T>(url: string, init?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
  try { const response = await fetch(url, init); const body = await response.json().catch(() => ({})); return response.ok && body.ok ? { success: true, data: body.data as T } : { success: false, error: body.error || body.message || "No se pudo completar la operación." }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : "No se pudo conectar con Ventas." }; }
}
export function getSalesBootstrap() { return request<SalesBootstrap>("/api/admin/sales"); }
export function searchCustomers(query: string) { return request<Customer[]>(`/api/admin/sales?customerQuery=${encodeURIComponent(query)}`); }
export function searchProducts(query: string) { return request<SaleProduct[]>(`/api/admin/sales?productQuery=${encodeURIComponent(query)}`); }
export function getCustomerHistory(customerId: string) { return request<CustomerHistory>(`/api/admin/sales?customerId=${encodeURIComponent(customerId)}`); }
export function getGeneralSales(query: string, period: string) { return request<GeneralSale[]>(`/api/admin/sales?history=1&query=${encodeURIComponent(query)}&period=${encodeURIComponent(period)}`); }
export function getSaleDetail(saleId: string) { return request<SaleDetail>(`/api/admin/sales?saleId=${encodeURIComponent(saleId)}`); }
export function createCustomer(input: { fullName: string; phone?: string; email?: string; notes?: string }) { return request<Customer>("/api/admin/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_customer", ...input }) }); }
export function createCustomerVehicle(input: { customerId: string; brandName: string; modelName: string; year?: number; plate?: string; notes?: string }) { return request<CustomerVehicle>("/api/admin/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_vehicle", ...input }) }); }
export function createSale(input: { customerId: string; customerVehicleId?: string; notes?: string; items: Array<{ productId: string; quantity: number }>; createInstallation?: boolean; paymentMethod: string; idempotencyKey: string }) { return request<{ saleId: string }>("/api/admin/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_sale", ...input }) }); }
