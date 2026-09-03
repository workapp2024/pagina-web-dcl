import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (token && host) {
  posthog.init(token, {
    api_host: host,
    defaults: "2026-05-30",
    capture_pageview: false,
    autocapture: false,
    persistence: "localStorage",
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-ph-sensitive], form, [contenteditable='true']",
    },
    before_send: event => {
      if (!event) return null;
      const path = window.location.pathname;
      if (path.startsWith("/admin") || path.startsWith("/api/admin") || (path.startsWith("/checkout") && event.event === "$snapshot")) return null;
      return event;
    },
  });
}
