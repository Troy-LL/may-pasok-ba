import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPlaces,
  getPlace,
  matchGeo,
  pickerPlaces,
  resolvePlace,
} from "./places.ts";

test("picker is NCR only", () => {
  const all = pickerPlaces();
  assert.ok(all.length > 1);
  assert.ok(all.every((p) => p.ncr));
  assert.equal(all[0]?.id, "metro-manila");
  assert.ok(!all.some((p) => p.id === "cebu" || p.id === "davao"));
});

test("typing Metro Manila or NCR does not fall through to Manila city", () => {
  assert.equal(resolvePlace("Metro Manila").id, "metro-manila");
  assert.equal(resolvePlace("NCR").id, "metro-manila");
  assert.equal(resolvePlace("Kalakhang Maynila").id, "metro-manila");
  assert.equal(resolvePlace("Manila").id, "manila");
  assert.equal(resolvePlace("Caloocan, Metro Manila").id, "caloocan");
});

test("an empty picker query lists many places, not only Caloocan", () => {
  const open = filterPlaces("");
  assert.ok(open.length > 1);
  assert.equal(open[0]?.id, "metro-manila");
  assert.ok(open.some((p) => p.id === "quezon-city"));
  assert.ok(open.some((p) => p.id === "manila"));
  assert.ok(open.some((p) => p.id === "caloocan"));
});

test("filtering the filled Caloocan label is not how the open list should work", () => {
  const narrowed = filterPlaces("Caloocan, Metro Manila");
  assert.equal(narrowed[0]?.id, "caloocan");
  assert.equal(narrowed.length, 1);
});

test("typing a city name finds NCR cities only", () => {
  const hits = filterPlaces("taguig");
  assert.ok(hits.some((p) => p.id === "taguig"));
  assert.equal(filterPlaces("davao").length, 0);
  assert.equal(filterPlaces("cebu").length, 0);
});

test("resolvePlace ignores cities outside NCR", () => {
  assert.equal(resolvePlace("Cebu").id, "metro-manila");
  assert.equal(resolvePlace("Davao").id, "metro-manila");
  assert.equal(getPlace("cebu"), undefined);
});

test("matchGeo only returns NCR", () => {
  assert.equal(
    matchGeo({ city: "Caloocan", state: "Metro Manila" })?.id,
    "caloocan",
  );
  assert.equal(matchGeo({ city: "Cebu", state: "Cebu" }), undefined);
});
