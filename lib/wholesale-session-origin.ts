import { isIP } from "node:net";
import { isSameOriginWrite } from "@/lib/store/buyer-session";

function isLocalDevelopmentHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;

  if (isIP(host) !== 4) return false;
  const octets = host.split(".").map(Number);
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254);
}

/** Keep the shared production check unchanged; allow only same-host local dev requests. */
export function isWholesaleSessionWriteAllowed(request: Request) {
  if (process.env.NODE_ENV !== "development") return isSameOriginWrite(request);
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    const requestUrl = new URL(request.url);
    const effectiveOrigin = new URL(`${requestUrl.protocol}//${host}`).origin;
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === origin
      && parsedOrigin.origin === effectiveOrigin
      && isLocalDevelopmentHost(parsedOrigin.hostname);
  } catch {
    return false;
  }
}
