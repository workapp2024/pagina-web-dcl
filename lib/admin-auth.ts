import "server-only";
import { createAdminServerClient } from "@/lib/supabase/server";
import { hasAdminPermission, type AdminPermission, type AdminIdentity, type StaffProfile } from "@/lib/admin-permissions";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "dcl_admin_auth";
const SESSION_TTL_SECONDS = 60 * 60 * 12;


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

export function legacyAdminEnabled() {
  return !process.env.ADMIN_AUTH_MODE || process.env.ADMIN_AUTH_MODE === "legacy";
}

export function createAdminSession(profile?: StaffProfile) {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const session = profile ? { v: 2, sub: profile.id, version: profile.session_version, exp } : { v: 1, role: "admin", exp };
  const payload = encode(JSON.stringify(session));
  return `${payload}.${sign(payload, secret)}`;
}

export async function getAdminAuthCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value;
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const cookie = await getAdminAuthCookie();
  const secret = sessionSecret();
  if (!cookie || !secret) return null;
  const [payload, signature, ...extra] = cookie.split(".");
  if (!payload || !signature || extra.length || !signatureMatches(signature, sign(payload, secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session || !Number.isFinite(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null;
    if (session.v === 1 && session.role === "admin" && legacyAdminEnabled()) {
      return { id: "legacy-owner", role: "ADMIN", name: "Propietario (acceso anterior)", legacy: true };
    }
    if (session.v !== 2 || typeof session.sub !== "string") return null;
    const db = createAdminServerClient();
    const { data, error } = await db.from("admin_profiles").select("id,role,active,display_name,session_version").eq("id", session.sub).maybeSingle();
    const profile = data as StaffProfile | null;
    if (error || !profile?.active || !["ADMIN", "VENDEDOR"].includes(profile.role) || profile.session_version !== session.version) return null;
    return { id: profile.id, role: profile.role, name: profile.display_name, legacy: false, sessionVersion: profile.session_version };
  } catch { return null; }
}

// Default remains owner-only: routes fail closed unless explicitly permitted.
export async function isAdminAuthenticated(permission: AdminPermission = "admin") {
  const identity = await getAdminIdentity();
  return Boolean(identity && hasAdminPermission(identity.role, permission));
}

export async function isIndividualAdmin() {
  const identity = await getAdminIdentity();
  return Boolean(identity && !identity.legacy && identity.role === "ADMIN");
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
