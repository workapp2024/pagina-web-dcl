import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

async function guard() {
  if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Administración no configurada.", 503);
  return null;
}

function validHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function stationFields(body: Record<string, unknown>) {
  const name = boundedString(body.name, 100, { required: true });
  const genre = boundedString(body.genre, 80) ?? "";
  const streamUrl = boundedString(body.streamUrl, 2000, { required: true });
  const coverUrl = boundedString(body.coverUrl, 2000);
  const description = boundedString(body.description, 240) ?? "";
  const sortOrder = Number(body.sortOrder ?? 0);
  const playlist = typeof streamUrl === "string" && /\.(m3u|pls)(?:$|\?)/i.test(streamUrl);
  const coverValid = !coverUrl || coverUrl.startsWith("/") || validHttpsUrl(coverUrl);
  if (!name || !streamUrl || !validHttpsUrl(streamUrl) || playlist || !coverValid || !Number.isInteger(sortOrder) || Math.abs(sortOrder) > 10000) return null;
  return {
    name, genre, stream_url: streamUrl, cover_url: coverUrl || null, description,
    active: body.active !== false, featured: body.featured === true, sort_order: sortOrder,
  };
}

export async function GET() {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const { data, error } = await createAdminServerClient().from("radio_stations").select("*").order("sort_order").limit(100);
    if (error) throw error;
    return NextResponse.json({ ok: true, data });
  } catch (error) { return apiInternalError("admin_music_list", error); }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "admin-music", { limit: 30, windowMs: 10 * 60 * 1000 }); if (limited) return limited;
  const blocked = await guard(); if (blocked) return blocked;
  const body = await readJsonObject(request); const row = body && stationFields(body);
  if (!row) return apiError("BAD_REQUEST", "Revisá los datos. El stream debe ser una URL HTTPS directa, no M3U ni PLS.", 400);
  try {
    const { data, error } = await createAdminServerClient().from("radio_stations").insert(row as never).select("*").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, data });
  } catch (error) { return apiInternalError("admin_music_create", error); }
}

export async function PATCH(request: Request) {
  const limited = rateLimit(request, "admin-music", { limit: 60, windowMs: 10 * 60 * 1000 }); if (limited) return limited;
  const blocked = await guard(); if (blocked) return blocked;
  const body = await readJsonObject(request); const row = body && stationFields(body);
  if (!body || !isUuid(body.id) || !row) return apiError("BAD_REQUEST", "Emisora o datos inválidos.", 400);
  try {
    const { error } = await createAdminServerClient().from("radio_stations").update(row as never).eq("id", body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return apiInternalError("admin_music_update", error); }
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, "admin-music", { limit: 20, windowMs: 10 * 60 * 1000 }); if (limited) return limited;
  const blocked = await guard(); if (blocked) return blocked;
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.id)) return apiError("BAD_REQUEST", "Emisora inválida.", 400);
  try {
    const { error } = await createAdminServerClient().from("radio_stations").delete().eq("id", body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return apiInternalError("admin_music_delete", error); }
}
