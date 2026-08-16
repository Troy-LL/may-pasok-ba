import { timingSafeEqual } from "node:crypto";

export function isCronAuthorized(
  authorization: string | null,
  secret: string | undefined,
  production: boolean,
): boolean {
  if (!secret) return !production;
  const actual = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
