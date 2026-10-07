export type RankingRow = { key: string; label: string; count: number };
export type RankingResult = { status: "ok"; rows: RankingRow[] } | { status: "unavailable" };
export const unavailableRanking: RankingResult = { status: "unavailable" };
