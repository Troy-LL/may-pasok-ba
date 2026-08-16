import assert from "node:assert/strict";
import test from "node:test";
import { isCronAuthorized } from "./cron.ts";

test("cron requires a configured secret in production", () => {
  assert.equal(isCronAuthorized(null, undefined, true), false);
});

test("cron accepts only the configured bearer token", () => {
  assert.equal(isCronAuthorized("Bearer right", "right", true), true);
  assert.equal(isCronAuthorized("Bearer wrong", "right", true), false);
});

test("cron remains open for local development without a secret", () => {
  assert.equal(isCronAuthorized(null, undefined, false), true);
});
