import { parseProductFilters, productFilterEventProperties } from "@/lib/product-filters";

const commercialEvents = new Set(["home_vehicle_selected", "home_need_selected", "product_filter_applied", "product_filters_cleared"]);
const scopedEvents = new Set(["product_viewed", "fitment_result_viewed", "add_to_cart", "buy_now_clicked", "manual_transfer_instructions_viewed", "manual_transfer_marked_sent"]);

export function sanitizeStoreEvent(event: string, properties: Record<string, unknown>) {
  if (commercialEvents.has(event)) {
    const value = (key: string) => typeof properties[key] === "string" ? properties[key] as string : undefined;
    const filters = parseProductFilters({ vehiculo: value("vehicle_type"), categoria: value("category"), funcion: value("function") });
    const safe: Record<string, unknown> = { $geoip_disable: true, $process_person_profile: false, $ip: null, ...productFilterEventProperties(filters.classification) };
    for (const key of ["token", "distinct_id", "$device_id", "$session_id", "$window_id", "$insert_id", "$lib", "$lib_version"]) {
      if (typeof properties[key] === "string") safe[key] = properties[key];
    }
    return safe;
  }
  if (!scopedEvents.has(event)) {
    // SDK URL/referrer properties must not carry checkout IDs or user query text.
    return Object.fromEntries(Object.entries(properties).filter(([key]) => !/url|referrer|query|search|\$set/i.test(key)));
  }
  const safe: Record<string, unknown> = { $geoip_disable: true, $process_person_profile: false, $ip: null };
  // Keep SDK transport/pseudonymous IDs, never URLs, referrers, form fields,
  // person updates, arbitrary strings or order/customer identifiers.
  for (const key of ["token", "distinct_id", "$device_id", "$session_id", "$window_id", "$insert_id", "$lib", "$lib_version"]) {
    if (typeof properties[key] === "string") safe[key] = properties[key];
  }
  for (const key of ["product_id", "product_slug"]) {
    if (typeof properties[key] === "string" && /^[a-z0-9_-]{1,100}$/i.test(properties[key])) safe[key] = properties[key];
  }
  for (const key of ["quantity", "result_count"]) {
    if (Number.isSafeInteger(properties[key]) && Number(properties[key]) >= 0) safe[key] = properties[key];
  }
  return safe;
}
