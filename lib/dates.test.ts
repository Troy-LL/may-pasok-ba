import assert from "node:assert/strict";
import test from "node:test";
import {
  datesCoveredByHeadline,
  enumerateRange,
  headlineAppliesOn,
  parseCoverageDates,
  relevantBoardDate,
} from "./dates.ts";
import type { Headline } from "./rss.ts";

const published = new Date("2026-08-18T10:00:00Z"); // Aug 18 18:00 Manila

function item(
  title: string,
  body = "",
  publishedAt = published,
): Headline {
  return {
    title,
    body,
    link: "https://example.com/story",
    source: "ABS-CBN",
    publishedAt,
  };
}

test("parses multi-day ranges and day lists", () => {
  assert.deepEqual(
    parseCoverageDates("Classes suspended August 18-20 in Metro Manila", published),
    ["2026-08-18", "2026-08-19", "2026-08-20"],
  );
  assert.deepEqual(
    parseCoverageDates("Walang pasok from August 18 to August 21", published),
    ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
  );
  assert.deepEqual(
    parseCoverageDates("Suspensions on August 18, 19, and 20", published),
    ["2026-08-18", "2026-08-19", "2026-08-20"],
  );
  assert.deepEqual(
    parseCoverageDates("Classes off August 18 and 19", published),
    ["2026-08-18", "2026-08-19"],
  );
});

test("until a date runs from the published day through that date", () => {
  assert.deepEqual(
    parseCoverageDates("Classes suspended until August 21 in NCR", published),
    ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
  );
  assert.deepEqual(
    parseCoverageDates("Walang pasok hanggang Agosto 20", published),
    ["2026-08-18", "2026-08-19", "2026-08-20"],
  );
});

test("until further notice is capped at eight days", () => {
  assert.deepEqual(
    parseCoverageDates("Classes suspended until further notice", published),
    enumerateRange("2026-08-18", "2026-08-25"),
  );
  assert.equal(
    parseCoverageDates(
      "Work cancelled indefinitely in Metro Manila",
      published,
    ).length,
    8,
  );
});

test("caps a long titled range at eight days", () => {
  const days = parseCoverageDates(
    "Classes suspended August 1-31 due to flooding",
    new Date("2026-08-01T04:00:00Z"),
  );
  assert.equal(days.length, 8);
  assert.equal(days[0], "2026-08-01");
  assert.equal(days.at(-1), "2026-08-08");
});

test("early relative dates: tomorrow, bukas, and a future weekday", () => {
  assert.deepEqual(parseCoverageDates("Walang pasok tomorrow", published), [
    "2026-08-19",
  ]);
  assert.deepEqual(parseCoverageDates("Walang pasok bukas", published), [
    "2026-08-19",
  ]);
  assert.deepEqual(
    parseCoverageDates("Class suspensions for Friday", published),
    ["2026-08-21"],
  );
  assert.deepEqual(
    parseCoverageDates("Walang pasok sa Miyerkules", published),
    ["2026-08-19"],
  );
});

test("same-day weekday names stay undated so last-night posts still count", () => {
  assert.deepEqual(
    parseCoverageDates(
      "Walang pasok in Metro Manila: class suspension for Thursday",
      new Date("2026-08-13T10:00:00Z"),
    ),
    [],
  );
});

test("reads the suspension date from the article body", () => {
  assert.deepEqual(
    datesCoveredByHeadline(
      item(
        "#WalangPasok: Work, class suspensions due to habagat rains, floods",
        "Malacañang announced the suspension of face-to-face classes in all levels, as well as work in government offices in the National Capital Region and 17 other provinces on Wednesday, August 19.",
      ),
    ),
    ["2026-08-19"],
  );
});

test("does not treat NCR and 17 other provinces as August 17", () => {
  assert.deepEqual(
    parseCoverageDates(
      "in the National Capital Region and 17 other provinces on Wednesday, August 19",
      published,
    ),
    ["2026-08-19"],
  );
});

test("a mid-range day still counts after the 36-hour freshness window", () => {
  const headline = item(
    "Walang pasok in Metro Manila August 18-20",
    "Metro Manila classes suspended",
    new Date("2026-08-18T00:00:00Z"),
  );
  const later = new Date("2026-08-19T16:30:00Z"); // Aug 20 00:30 Manila, ~40.5h later
  assert.equal(headlineAppliesOn(headline, "2026-08-20", later), true);
  assert.equal(headlineAppliesOn(headline, "2026-08-21", later), false);
});

test("an early Friday cancellation does not drive Wednesday's board", () => {
  const headline = item(
    "Walang pasok in Metro Manila for August 21, 2026",
    "National Capital Region Manila - all levels",
    new Date("2026-08-18T10:00:00Z"),
  );
  const wednesdayEvening = new Date("2026-08-19T12:00:00Z");
  assert.equal(relevantBoardDate([headline], wednesdayEvening), "2026-08-19");
  assert.equal(headlineAppliesOn(headline, "2026-08-19", wednesdayEvening), false);
  assert.equal(headlineAppliesOn(headline, "2026-08-21", wednesdayEvening), true);
});
