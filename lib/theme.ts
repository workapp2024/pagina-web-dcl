export const themePresets = [
  { id: "dcl-dark", name: "DCL Dark", description: "Negro, rojo y naranja con contraste automotriz.", swatches: ["#050505", "#ef4444", "#f59e0b"] },
  { id: "clean-light", name: "Clean Light", description: "Claro, limpio y comercial.", swatches: ["#f7f8fa", "#2563eb", "#e2e8f0"] },
  { id: "graphite-pro", name: "Graphite Pro", description: "Grafito sobrio para operación profesional.", swatches: ["#202226", "#94a3b8", "#3f4652"] },
  { id: "midnight-blue", name: "Midnight Blue", description: "Azul noche con acentos cyan tecnológicos.", swatches: ["#0b1220", "#0ea5e9", "#67e8f9"] },
] as const;

export type ThemePreset = (typeof themePresets)[number]["id"];
export const DEFAULT_THEME: ThemePreset = "dcl-dark";
export function isThemePreset(value: unknown): value is ThemePreset { return themePresets.some((theme) => theme.id === value); }
