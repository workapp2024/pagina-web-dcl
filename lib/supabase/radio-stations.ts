import type { RadioStation } from "@/lib/radio-stations";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import { sanitizeStoredImageUrl } from "./storage";

type RadioStationRow = {
  id: string; name: string; genre: string; stream_url: string; cover_url: string | null;
  description: string; active: boolean; featured: boolean; sort_order: number;
};

export function mapRadioStation(row: RadioStationRow): RadioStation {
  return {
    id: row.id,
    name: row.name,
    genre: row.genre,
    streamUrl: row.stream_url,
    coverUrl: sanitizeStoredImageUrl(row.cover_url) || undefined,
    description: row.description,
    active: row.active,
    featured: row.featured,
    sortOrder: row.sort_order,
  };
}

export async function getPublicRadioStations(): Promise<RadioStation[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await createServerClient()
    .from("radio_stations")
    .select("id,name,genre,stream_url,cover_url,description,active,featured,sort_order")
    .eq("active", true)
    .order("featured", { ascending: false })
    .order("sort_order")
    .limit(50);
  if (error) {
    // Expected until the local migration is reviewed and applied.
    if (error.code !== "42P01" && error.code !== "PGRST205") console.warn("DCL Music no disponible:", error.message);
    return [];
  }
  return (data ?? []).map(row => mapRadioStation(row as RadioStationRow));
}
