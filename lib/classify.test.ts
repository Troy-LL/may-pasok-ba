import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHeadline,
  isFresh,
  placeMentions,
  verdictsFromFlags,
} from "./classify.ts";

const dagupan = {
  name: "Dagupan",
  province: "Pangasinan",
  island: "luzon" as const,
  ncr: false,
  aliases: ["Dagupan City", "City of Dagupan"],
};

const qc = {
  name: "Quezon City",
  province: "Metro Manila",
  island: "luzon" as const,
  ncr: true,
  aliases: ["QC", "Q.C."],
};

test("walang pasok in a city list is classes only", () => {
  const title =
    "WALANG PASOK: CLASS SUSPENSIONS FOR AUGUST 13, 2026 Suspendido ang klase sa mga sumusunod na lugar sa bansa sa Huwebes, Aug. 13 #WalangPasok ILOCOS REGION • Dagupan City, Pangasinan - All levels";
  assert.equal(placeMentions(title, dagupan), true);
  assert.deepEqual(classifyHeadline(title), {
    classes: true,
    work: false,
    government: false,
  });
});

test("generic national roundup does not mention Quezon City by name", () => {
  const title = "Walang pasok: In-person class suspensions for Aug. 13 - Inquirer.net";
  assert.equal(placeMentions(title, qc), false);
  assert.equal(placeMentions(title, dagupan), false);
});

test("NCR headline applies to Quezon City", () => {
  const title =
    "Walang pasok in Metro Manila: class suspension for Thursday due to habagat";
  assert.equal(placeMentions(title, qc), true);
  assert.equal(placeMentions(title, dagupan), false);
});

test("work and government are separate from classes", () => {
  const title =
    "Work in government and private offices also suspended in Dagupan City";
  assert.deepEqual(classifyHeadline(title), {
    classes: false,
    work: true,
    government: true,
  });
});

test("lifted suspension is not WALA", () => {
  assert.deepEqual(classifyHeadline("May pasok: class suspension lifted in Cebu City"), {
    classes: false,
    work: false,
    government: false,
  });
});

test("nationwide hits every place", () => {
  const title = "Nationwide class suspension declared due to typhoon";
  assert.equal(placeMentions(title, qc), true);
  assert.equal(placeMentions(title, dagupan), true);
  assert.equal(classifyHeadline(title).classes, true);
});

test("QC alias matches", () => {
  assert.equal(placeMentions("Walang pasok sa QC today, all levels", qc), true);
});

test("verdicts flip WALA only when flagged", () => {
  assert.deepEqual(
    verdictsFromFlags({ classes: true, work: false, government: true }),
    { classes: "WALA", work: "MERON", government: "WALA" },
  );
});

test("fresh window is 36 hours", () => {
  const now = new Date("2026-08-13T21:00:00Z");
  assert.equal(isFresh(new Date("2026-08-13T10:00:00Z"), now), true);
  assert.equal(isFresh(new Date("2026-08-11T20:00:00Z"), now), false);
});
