import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "dcl_admin_auth";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type AdminSession = { v: 1; role: "admin"; exp: number };

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signatureMatches(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdminSessionConfigured() {
  return Boolean(sessionSecret());
}

export function createAdminSession() {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const session: AdminSession = { v: 1, role: "admin", exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payload = encode(JSON.stringify(session));
  return `${payload}.${sign(payload, secret)}`;
}

export async function getAdminAuthCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value;
}

export async function isAdminAuthenticated() {
  const cookie = await getAdminAuthCookie();
  const secret = sessionSecret();
  if (!cookie || !secret) return false;
  const [payload, signature, ...extra] = cookie.split(".");
  if (!payload || !signature || extra.length || !signatureMatches(signature, sign(payload, secret))) return false;
  try {
    const session: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Boolean(
      session
      && typeof session === "object"
      && (session as AdminSession).v === 1
      && (session as AdminSession).role === "admin"
      && Number.isFinite((session as AdminSession).exp)
      && (session as AdminSession).exp > Math.floor(Date.now() / 1000),
    );
  } catch {
    return false;
  }
}

export async function clearAdminAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}

export const adminSessionCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
