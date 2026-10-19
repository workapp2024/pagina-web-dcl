export type ReceiptIdentity = {
  mainLogo: string | null;
  watermarkLogo: string | null;
  background: string;
  accent: string;
  watermarkSize: number;
  watermarkOpacity: number;
  watermarkTone: "original" | "monochrome";
};

export const DEFAULT_RECEIPT_IDENTITY: ReceiptIdentity = {
  mainLogo: "default", watermarkLogo: "default", background: "#f0f1f3", accent: "#b91c1c",
  watermarkSize: 85, watermarkOpacity: 0.22, watermarkTone: "original",
};
export const RECEIPT_ASSET = /^site\/receipt-identity\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/;
const hex = /^#[0-9a-f]{6}$/i;
function luminance(color: string) {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function parseReceiptIdentity(value: unknown): ReceiptIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Configuración inválida.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== Object.keys(DEFAULT_RECEIPT_IDENTITY).length || Object.keys(v).some(k => !Object.hasOwn(DEFAULT_RECEIPT_IDENTITY, k))) throw Error("Configuración incompleta.");
  for (const key of ["mainLogo", "watermarkLogo"]) if (v[key] !== null && v[key] !== "default" && (typeof v[key] !== "string" || !RECEIPT_ASSET.test(v[key]))) throw Error("Logo inválido.");
  if (typeof v.background !== "string" || typeof v.accent !== "string" || !hex.test(v.background) || !hex.test(v.accent)) throw Error("Elegí colores válidos.");
  // Keep all existing secondary text and reversed-status text readable.
  if (contrast(v.background, "#626873") < 4.8 || contrast(v.background, "#9f2020") < 4.8 || contrast(v.background, v.accent) < 3) throw Error("Elegí un fondo claro y un acento con mayor contraste.");
  if (typeof v.watermarkSize !== "number" || !Number.isInteger(v.watermarkSize) || v.watermarkSize < 40 || v.watermarkSize > 100) throw Error("Tamaño inválido.");
  if (typeof v.watermarkOpacity !== "number" || !Number.isFinite(v.watermarkOpacity) || v.watermarkOpacity < 0 || v.watermarkOpacity > .3) throw Error("Opacidad inválida.");
  if (v.watermarkTone !== "original" && v.watermarkTone !== "monochrome") throw Error("Tono inválido.");
  return { ...v } as ReceiptIdentity;
}
export function receiptLogoSource(asset: string | null, monochrome = false): string | null {
  if (!asset) return null;
  if (asset === "default" && !monochrome) return "/brand/logo-dcl.png.png";
  if (asset !== "default" && !RECEIPT_ASSET.test(asset)) return null;
  return `/api/admin/receipt-identity/image?asset=${encodeURIComponent(asset)}${monochrome ? "&tone=monochrome" : ""}`;
}
