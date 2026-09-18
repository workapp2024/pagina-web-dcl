export const MAINTENANCE_MESSAGE =
  "Estamos realizando una actualización breve. Las compras estarán disponibles nuevamente en unos minutos.";

export const ADMIN_MAINTENANCE_MESSAGE =
  "El sistema está temporalmente en mantenimiento. Las acciones de escritura volverán a estar disponibles en unos minutos.";

export function isMaintenanceMode(): boolean {
  return process.env.DCL_MAINTENANCE_MODE === "true";
}
