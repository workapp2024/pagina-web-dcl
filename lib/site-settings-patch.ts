import type { SiteSettings } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";
import { isThemePreset } from "@/lib/theme";

// Each editor owns only these columns. Never send a full cached SiteSettings row.
export const siteSettingsSections = {
  configuration: ["logo", "whatsapp", "instagram", "facebook", "email", "phone", "address"],
  home: ["logo", "vehicleSectionTitle", "needsSectionTitle", "whyUsSectionTitle", "productsSectionTitle", "promotionsSectionTitle"],
  appearance: ["themePreset"],
  transfer: ["transferAlias", "transferCbuCvu", "transferHolder", "transferInstitution", "transferInstructions"],
} as const satisfies Record<string, readonly (keyof SiteSettings)[]>;

export type SiteSettingsSection = keyof typeof siteSettingsSections;
type SettingsUpdate = Database["public"]["Tables"]["site_settings"]["Update"];

const fields = {
  logo: ["logo_url", 10000], whatsapp: ["whatsapp", 10000],
  instagram: ["instagram", 10000], facebook: ["facebook", 10000],
  email: ["email", 255], phone: ["phone", 100], address: ["address", 255],
  vehicleSectionTitle: ["vehicle_section_title", 255], needsSectionTitle: ["needs_section_title", 255],
  whyUsSectionTitle: ["why_us_section_title", 255], productsSectionTitle: ["products_section_title", 255],
  promotionsSectionTitle: ["promotions_section_title", 255], themePreset: ["theme_preset", 24],
  transferAlias: ["transfer_alias", 120], transferCbuCvu: ["transfer_cbu_cvu", 40],
  transferHolder: ["transfer_holder", 160], transferInstitution: ["transfer_institution", 160],
  transferInstructions: ["transfer_instructions", 1000],
} as const satisfies Record<string, readonly [keyof SettingsUpdate, number]>;

export function pickSiteSettings(section: SiteSettingsSection, settings: Partial<SiteSettings>): Partial<SiteSettings> {
  return Object.fromEntries(siteSettingsSections[section]
    .filter(key => Object.hasOwn(settings, key))
    .map(key => [key, settings[key]]));
}

export function buildSiteSettingsPatch(section: unknown, settings: unknown): SettingsUpdate {
  if (typeof section !== "string" || !Object.hasOwn(siteSettingsSections, section)) {
    throw new Error("Sección no válida. Recargá el Admin antes de guardar.");
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Datos de configuración no válidos.");
  const allowed: readonly string[] = siteSettingsSections[section as SiteSettingsSection];
  const entries = Object.entries(settings);
  if (!entries.length) throw new Error("No hay cambios para guardar.");
  const row: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!allowed.includes(key)) throw new Error(`El campo ${key} no pertenece a esta sección.`);
    const [column, limit] = fields[key as keyof typeof fields];
    if (typeof value !== "string" || value.length > limit) throw new Error(`Valor no válido para ${key}.`);
    if (key === "themePreset" && !isThemePreset(value)) throw new Error("Paleta no reconocida. No se cambió el tema activo.");
    if (key === "facebook" || key === "instagram") {
      const url = value.trim();
      // Empty explicitly removes the link; omitted fields remain untouched.
      if (url) {
        let parsed: URL;
        try { parsed = new URL(url); } catch {
          throw new Error(`La URL de ${key === "facebook" ? "Facebook" : "Instagram"} debe ser una URL HTTPS válida.`);
        }
        if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || /\s/.test(url)) {
          throw new Error(`La URL de ${key === "facebook" ? "Facebook" : "Instagram"} debe ser una URL HTTPS válida.`);
        }
      }
      row[column] = url;
    } else {
      row[column] = value;
    }
  }
  // Validate a complete transfer group, never default missing bank fields to empty.
  if (section === "transfer") {
    if (!allowed.every(key => Object.hasOwn(settings, key))) throw new Error("Enviá todos los campos de transferencia.");
    const { transfer_alias: alias, transfer_cbu_cvu: cbu, transfer_holder: holder, transfer_institution: institution } = row;
    if ([alias, cbu, holder, institution].some(value => value.trim()) && (!(alias.trim() || cbu.trim()) || !holder.trim() || !institution.trim())) {
      throw new Error("Para habilitar transferencia indicá alias o CBU/CVU, titular e institución.");
    }
  }
  return row as SettingsUpdate;
}
