/** Presentation only. Business errors remain actionable; internal details stay on the server. */
export function adminMessage(message: string | null | undefined): string {
  if (!message) return "";
  if (/failed to fetch|fetch failed|networkerror|network request|load failed/i.test(message)) return "No pudimos conectar. Revisá tu conexión e intentá nuevamente.";
  if (/supabase|storage|posthog|\bAPI\b|backend|migraci[oó]n|schema cache|\b(?:relation|column|function)\b.+(?:exist|found)|SQLSTATE|PGRST\d|permission denied for (?:table|schema)/i.test(message)) return "Esta función no está disponible en este momento. Contactá al administrador si el problema continúa.";
  return message.replace(/para conservar la idempotencia/gi, "para evitar registrar la operación dos veces");
}
