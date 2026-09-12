// Closed vocabulary: never send the free-text search field to Analytics.
const connectors = new Set("H1 H2 H3 H4 H7 H8 H9 H10 H11 H12 H13 H15 H16 H18 H19 H27 HB1 HB2 HB3 HB4 HB5 HIR1 HIR2 9004 9005 9006 9007 9011 9012 880 881 PSX24W PSX26W P13W D1S D1R D2S D2R D3S D3R D4S D4R D5S D8S T5 T10 T15 T20 W5W W16W W21W P21W P21/5W PY21W 1156 1157 3156 3157 7440 7443".split(" "));

export function safeConnector(value: unknown) {
  if (typeof value !== "string") return undefined;
  const connector = value.trim().toUpperCase();
  return connectors.has(connector) ? connector : undefined;
}
