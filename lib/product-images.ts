export const MAX_ADDITIONAL_PRODUCT_IMAGES = 2;

function isImageReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048
    && (/^https:\/\/[^\s]+$/i.test(value) || /^\/(?!\/)[^\s]*$/.test(value));
}

// images contains additional images only; image remains the canonical cover.
export function validateAdditionalProductImages(value: unknown, mainImage?: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ADDITIONAL_PRODUCT_IMAGES || value.some(image => !isImageReference(image))) {
    throw new Error("Seleccioná hasta dos imágenes adicionales con una URL HTTPS o una ruta pública válida.");
  }
  if (new Set(value).size !== value.length || (mainImage && value.includes(mainImage))) throw new Error("Las imágenes del producto no deben repetirse.");
  return [...value];
}

export function productImageSources(product: { image: string; images?: readonly string[] }) {
  // Existing HTTP covers remain visible as before; new additions require HTTPS.
  const cover = typeof product.image === "string" && (isImageReference(product.image) || /^http:\/\/[^\s]+$/i.test(product.image)) ? product.image : "";
  return [...new Set([cover, ...(product.images ?? []).filter(isImageReference).slice(0, MAX_ADDITIONAL_PRODUCT_IMAGES)].filter(Boolean))];
}
