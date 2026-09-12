const DAY = 86_400_000;
const ARGENTINA_OFFSET = 3 * 60 * 60 * 1000;

function midnight(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Fecha inválida.");
  const utc = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== day) throw new Error("Fecha inválida.");
  // Argentina: UTC-03:00. Do not depend on the server's local timezone.
  return utc + ARGENTINA_OFFSET;
}

export function analyticsDates(period: string, from?: string, to?: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let start = midnight(today);
  let end = start + DAY;
  if (period === "custom") {
    if (!from || !to) throw new Error("Elegí fecha desde y hasta.");
    start = midnight(from);
    end = midnight(to) + DAY;
    if (start >= end) throw new Error("La fecha desde debe ser anterior o igual a hasta.");
  } else if (period === "month") start = midnight(`${today.slice(0, 7)}-01`);
  else if (period === "7d" || period === "30d") start -= ((period === "7d" ? 7 : 30) - 1) * DAY;
  else if (period !== "today") throw new Error("Período inválido.");
  // Historical days are complete; today ends at query time, never in the future.
  end = Math.min(end, now.getTime());
  if (start >= end) throw new Error("El rango no contiene tiempo transcurrido.");
  return { from: start / 1000, to: Math.floor(end / 1000) };
}
