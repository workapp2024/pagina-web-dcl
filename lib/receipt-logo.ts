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
  const image = sharp(source, { limitInputPixels: 8_000_000, animated: true });
  const metadata = await image.metadata();
  if (!["png", "jpeg"].includes(metadata.format ?? "") || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) throw Error("Usá una imagen estática de hasta 4096 píxeles por lado.");
  const output = await image.rotate().png().toBuffer();
  if (output.length > RECEIPT_LOGO_MAX_BYTES) throw Error("La imagen es demasiado grande. Reducí sus dimensiones.");
  return output;
}
