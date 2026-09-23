import { parseProductFilters, productFilterEventProperties } from "@/lib/product-filters";
import { safeConnector } from "@/lib/analytics-connector";
import { isProductCategory, productVehicleTypes } from "@/lib/product-taxonomy";
import { vehiclePositions } from "@/lib/vehicle-product-search";

const commercialEvents = new Set(["home_vehicle_selected", "home_need_selected", "product_filter_applied", "product_filters_cleared"]);
const scopedEvents = new Set(["connector_search", "vehicle_search_error", "vehicle_search_completed", "vehicle_search_no_results", "product_viewed", "fitment_result_viewed", "add_to_cart", "buy_now_clicked", "manual_transfer_instructions_viewed", "manual_transfer_marked_sent", "whatsapp_click", "checkout_started"]);
const productId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9_-]{1,100}$/i.test(value);
const nonNegativeInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const vehicleName = (value: unknown): value is string => typeof value === "string" && /^[\p{L}\p{N} ._-]{1,80}$/u.test(value);

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
  if (event === "whatsapp_click") {
    const source = properties.source;
    if (typeof source === "string" && /^(product|promotion|vehicle_search|payment_success|general|header|floating|footer|cart|other)$/.test(source)) {
      safe.source = source;
      if (source === "product" && productId(properties.product_id)) safe.product_id = properties.product_id;
      if (source === "promotion" && productId(properties.promotion_id)) safe.promotion_id = properties.promotion_id;
      if (source === "vehicle_search") addVehicleContext(safe, properties);
    }
  }
  if (event === "vehicle_search_completed" || event === "vehicle_search_no_results") {
    addVehicleContext(safe, properties);
    if (nonNegativeInt(properties.result_count)) safe.result_count = properties.result_count;
    if (typeof properties.year_provided === "boolean") safe.year_provided = properties.year_provided;
    safe.has_results = event === "vehicle_search_completed";
  }
  if (event === "checkout_started") {
    if (nonNegativeInt(properties.item_count)) safe.item_count = properties.item_count;
    if (typeof properties.cart_total === "number" && Number.isFinite(properties.cart_total) && properties.cart_total >= 0) safe.cart_total = properties.cart_total;
    const ids = properties.product_ids;
    if (Array.isArray(ids) && ids.length <= 30 && Array.from(ids).every(productId) && new Set(ids).size === ids.length) safe.product_ids = [...ids];
  }
  if (event === "connector_search") {
    const connector = safeConnector(properties.connector);
    if (connector) safe.connector = connector;
    if (typeof properties.has_results === "boolean") safe.has_results = properties.has_results;
    if (nonNegativeInt(properties.result_count)) safe.result_count = properties.result_count;
  }
  // Keep SDK transport/pseudonymous IDs, never URLs, referrers, form fields,
  // person updates, arbitrary strings or order/customer identifiers.
  for (const key of ["token", "distinct_id", "$device_id", "$session_id", "$window_id", "$insert_id", "$lib", "$lib_version"]) {
    if (typeof properties[key] === "string") safe[key] = properties[key];
  }
  for (const key of ["product_id", "product_slug"]) {
    if (["product_viewed", "add_to_cart", "buy_now_clicked", "fitment_result_viewed"].includes(event) && productId(properties[key])) safe[key] = properties[key];
  }
  if ((event === "product_viewed" || event === "add_to_cart") && isProductCategory(properties.category)) safe.category = properties.category;
  if (event === "add_to_cart" && properties.quantity === 1) safe.quantity = 1;
  if (event === "fitment_result_viewed" && nonNegativeInt(properties.result_count)) safe.result_count = properties.result_count;
  return safe;
}

function addVehicleContext(safe: Record<string, unknown>, properties: Record<string, unknown>) {
  if (productVehicleTypes.some(option => option.label === properties.vehicle_type)) safe.vehicle_type = properties.vehicle_type;
  if (vehicleName(properties.brand)) safe.brand = properties.brand;
  if (vehicleName(properties.model)) safe.model = properties.model;
  if (nonNegativeInt(properties.year) && properties.year >= 1900 && properties.year <= new Date().getFullYear() + 1) safe.year = properties.year;
  if (vehiclePositions.some(option => option.key === properties.position)) safe.position = properties.position;
  if (typeof properties.has_results === "boolean") safe.has_results = properties.has_results;
}
