import assert from "node:assert/strict";
import test from "node:test";
import {
  applySecurityHeaders,
  corsPreflightResponse,
  isValidCoordinate,
  sanitizeQuery,
  sanitizeUrl,
} from "./security.ts";

test("isValidCoordinate validates numeric latitude and longitude ranges", () => {
  assert.equal(isValidCoordinate("14.5995", "120.9842"), true);
  assert.equal(isValidCoordinate("-14.5", "-120.9"), true);
  assert.equal(isValidCoordinate("0", "0"), true);
  assert.equal(isValidCoordinate("90", "180"), true);
  assert.equal(isValidCoordinate("-90", "-180"), true);

  // Invalid ranges
  assert.equal(isValidCoordinate("91", "120"), false);
  assert.equal(isValidCoordinate("-91", "120"), false);
  assert.equal(isValidCoordinate("14", "181"), false);
  assert.equal(isValidCoordinate("14", "-181"), false);

  // Non-numeric or missing
  assert.equal(isValidCoordinate(null, "120"), false);
  assert.equal(isValidCoordinate("14", null), false);
  assert.equal(isValidCoordinate("abc", "120"), false);
  assert.equal(isValidCoordinate("14", "NaN"), false);
  assert.equal(isValidCoordinate("Infinity", "120"), false);
  assert.equal(isValidCoordinate("", ""), false);
  assert.equal(isValidCoordinate("14.5; DROP TABLE", "120"), false);
});

test("sanitizeUrl only allows http and https URLs", () => {
  assert.equal(
    sanitizeUrl("https://news.google.com/rss/articles/123"),
    "https://news.google.com/rss/articles/123",
  );
  assert.equal(
    sanitizeUrl("http://example.com/article"),
    "http://example.com/article",
  );

  // Malicious protocols blocked
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(sanitizeUrl("file:///etc/passwd"), "");
  assert.equal(sanitizeUrl("vbscript:msgbox"), "");
  assert.equal(sanitizeUrl(""), "");
  assert.equal(sanitizeUrl(null), "");
  assert.equal(sanitizeUrl(undefined), "");
  assert.equal(sanitizeUrl("not a url"), "");
});

test("sanitizeQuery truncates long queries and strips control characters", () => {
  assert.equal(sanitizeQuery("Quezon City"), "Quezon City");
  assert.equal(sanitizeQuery("a".repeat(200), 50), "a".repeat(50));
  assert.equal(sanitizeQuery("  Manila  "), "Manila");
  assert.equal(sanitizeQuery(null), "");
  assert.equal(sanitizeQuery(undefined), "");
  assert.equal(sanitizeQuery("Hello\x00World"), "HelloWorld");
});

test("applySecurityHeaders sets standard security headers on responses", () => {
  const original = new Response("ok", { status: 200 });
  const secured = applySecurityHeaders(original, false);

  assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
  assert.equal(secured.headers.get("x-frame-options"), "DENY");
  assert.equal(
    secured.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.ok(secured.headers.get("content-security-policy")?.includes("default-src 'self'"));
  assert.ok(secured.headers.get("strict-transport-security")?.includes("max-age=31536000"));
});

test("applySecurityHeaders for API sets CORS and security headers", () => {
  const original = Response.json({ ok: true });
  const secured = applySecurityHeaders(original, true);

  assert.equal(secured.headers.get("access-control-allow-origin"), "*");
  assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
  assert.equal(secured.headers.get("x-frame-options"), "DENY");
});

test("corsPreflightResponse returns 204 with CORS preflight headers", () => {
  const preflight = corsPreflightResponse();
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.ok(preflight.headers.get("access-control-allow-methods")?.includes("GET"));
  assert.ok(preflight.headers.get("access-control-allow-headers")?.includes("Content-Type"));
});
