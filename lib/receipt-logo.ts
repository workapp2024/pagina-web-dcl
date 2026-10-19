import "server-only";
import { Buffer } from "node:buffer";
import sharp from "sharp";

export const RECEIPT_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export async function normalizeReceiptLogo(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > RECEIPT_LOGO_MAX_BYTES || !["image/png", "image/jpeg"].includes(mime)) throw Error("Usá PNG o JPG de hasta 2 MB.");
  const source = Buffer.from(bytes);
  const png = source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = source[0] === 255 && source[1] === 216 && source[2] === 255;
  if ((mime === "image/png" && !png) || (mime === "image/jpeg" && !jpg)) throw Error("El archivo no corresponde al formato indicado.");
  const image = sharp(source, { limitInputPixels: 16_777_216, animated: true });
  const metadata = await image.metadata();
  if (!["png", "jpeg"].includes(metadata.format ?? "") || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) throw Error("Usá una imagen estática de hasta 4096 píxeles por lado.");
  for (let size = 1600; ; size = Math.max(640, Math.floor(size * .8))) {
    const output = await sharp(source, { limitInputPixels: 16_777_216 }).rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    if (output.length <= RECEIPT_LOGO_MAX_BYTES) return output;
    if (size === 640) throw Error("No se pudo optimizar el logo. Exportalo con menor tamaño.");
  }
}
