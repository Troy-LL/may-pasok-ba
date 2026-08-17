export function isValidCoordinate(
  lat: string | null | undefined,
  lon: string | null | undefined,
): boolean {
  if (!lat || !lon) return false;
  if (!/^-?\d+(?:\.\d+)?$/.test(lat.trim()) || !/^-?\d+(?:\.\d+)?$/.test(lon.trim())) {
    return false;
  }
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function sanitizeUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
  } catch {
    return "";
  }
  return "";
}

export function sanitizeQuery(
  query: string | null | undefined,
  maxLen = 100,
): string {
  if (!query || typeof query !== "string") return "";
  // Strip control characters (including null bytes)
  const cleaned = query.replace(/[\x00-\x1F\x7F]/g, "").trim();
  return cleaned.slice(0, maxLen);
}

const COMMON_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const CSP_HEADER =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https://nominatim.openstreetmap.org; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

export function applySecurityHeaders(
  response: Response,
  isApi = false,
): Response {
  const newHeaders = new Headers(response.headers);

  for (const [key, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
    if (!newHeaders.has(key)) {
      newHeaders.set(key, value);
    }
  }

  if (!isApi && !newHeaders.has("Content-Security-Policy")) {
    newHeaders.set("Content-Security-Policy", CSP_HEADER);
  }

  if (isApi) {
    if (!newHeaders.has("Access-Control-Allow-Origin")) {
      newHeaders.set("Access-Control-Allow-Origin", "*");
    }
    if (!newHeaders.has("Cross-Origin-Resource-Policy")) {
      newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      ...COMMON_SECURITY_HEADERS,
    },
  });
}
