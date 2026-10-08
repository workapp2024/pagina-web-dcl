import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function normalizeWholesaleCode(code: string) {
  return code.trim().toUpperCase();
}

export function isValidManualWholesaleCode(code: string) {
  return /^[A-Z0-9]{4,32}$/.test(code);
}

export function hashWholesaleCode(code: string) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function verifyWholesaleCode(code: string, expectedHash: string) {
  return verifyWholesaleHash(hashWholesaleCode(code), expectedHash);
}

export function verifyWholesaleHash(actualHash: string, expectedHash: string) {
  if (!/^[a-f0-9]{64}$/.test(actualHash) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const toBytes = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], byte => Number.parseInt(byte, 16));
  return timingSafeEqual(toBytes(actualHash), toBytes(expectedHash));
}

export function createWholesaleSessionToken() {
  return randomBytes(32).toString("hex");
}

export const hashWholesaleSessionToken = hashWholesaleCode;
