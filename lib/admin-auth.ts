import { cookies } from "next/headers";

export const ADMIN_COOKIE = "dcl_admin_auth";

export async function getAdminAuthCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value;
}

export async function isAdminAuthenticated() {
  const cookie = await getAdminAuthCookie();
  return cookie === process.env.ADMIN_PASSWORD;
}

export async function clearAdminAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}
