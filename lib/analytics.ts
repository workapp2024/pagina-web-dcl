"use client";

import posthog from "posthog-js";

export const analyticsEvents = {
  pageView: "page_view", navigationClick: "navigation_click", productView: "product_viewed",
  categoryView: "category_view", addToCart: "add_to_cart", addToCartBlocked: "add_to_cart_blocked", removeFromCart: "remove_from_cart",
  cartView: "cart_view", checkoutStarted: "checkout_started", whatsappClick: "whatsapp_click",
  vehicleSearchStarted: "vehicle_search_started", vehicleSearchCompleted: "vehicle_search_completed",
  vehicleSearchNoResults: "vehicle_search_no_results", promotionView: "promotion_view",
  promotionClick: "promotion_click", dclMusicOpen: "dcl_music_open", radioPlay: "radio_play",
  radioPause: "radio_pause", radioStationSelected: "radio_station_selected", galleryView: "gallery_view",
  catalogSearch: "catalog_search",
  paymentMethodSelected: "payment_method_selected", mercadopagoCheckoutOpened: "mercadopago_checkout_opened",
  transferInstructionsViewed: "manual_transfer_instructions_viewed", qrPaymentOpened: "qr_payment_opened",
  paymentResultViewed: "payment_result_viewed", deliveryWhatsappClicked: "delivery_whatsapp_clicked",
  fitmentResultViewed: "fitment_result_viewed", buyNowClicked: "buy_now_clicked",
  manualTransferMarkedSent: "manual_transfer_marked_sent", manualTransferConfirmed: "manual_transfer_confirmed",
} as const;

export type AnalyticsEvent = typeof analyticsEvents[keyof typeof analyticsEvents];
export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export function capture(event: AnalyticsEvent, properties: AnalyticsProperties = {}) {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/admin") || !posthog.__loaded) return;
  posthog.capture(event, properties);
}

const capturedOnce = new Set<string>();
// Keys are local deduplication tokens and are NEVER sent to PostHog.
export function captureOnce(key: string, event: AnalyticsEvent, properties: AnalyticsProperties = {}) {
  if (capturedOnce.has(key) || typeof window === "undefined" || !posthog.__loaded || window.location.pathname.startsWith("/admin")) return;
  capturedOnce.add(key);
  if (capturedOnce.size > 1000) capturedOnce.delete(capturedOnce.values().next().value!);
  capture(event, properties);
}
