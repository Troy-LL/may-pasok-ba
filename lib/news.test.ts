import assert from "node:assert/strict";
import test from "node:test";
import type { Place } from "./places.ts";
import {
  mergeHeadlines,
  NEWS_QUERIES,
  parseRss2Json,
  scoreHeadlines,
  statusFromHeadlines,
  summarizeWeek,
  type Headline,
} from "./news.ts";

const metroManila: Place = {
  id: "metro-manila",
  name: "Metro Manila",
  province: "NCR",
  island: "luzon",
  ncr: true,
  kind: "region",
  aliases: ["NCR", "National Capital Region", "Kalakhang Maynila"],
};

const manila: Place = {
  id: "manila",
  name: "Manila",
  province: "Metro Manila",
  island: "luzon",
  ncr: true,
  kind: "city",
  aliases: ["City of Manila", "Manila City"],
};

const now = new Date("2026-08-13T21:00:00Z");

function headline(
  title: string,
  source: string,
  publishedAt = "2026-08-13T10:00:00Z",
  body?: string,
): Headline {
  return {
    title,
    link: `https://example.com/${source}`,
    source,
    publishedAt: new Date(publishedAt),
    ...(body ? { body } : {}),
  };
}

test("RSS2JSON fallback preserves the Google headline source", () => {
  const parsed = parseRss2Json({
    status: "ok",
    items: [
      {
        title: "Walang pasok in Quezon City - ABS-CBN",
        link: "https://news.google.com/rss/articles/example",
        pubDate: "2026-08-13 10:00:00",
      },
    ],
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, "Walang pasok in Quezon City");
  assert.equal(parsed[0]?.source, "ABS-CBN");
  assert.equal(parsed[0]?.publishedAt.toISOString(), "2026-08-13T10:00:00.000Z");
});

test("blog-only walang pasok does not flip any kind", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "Walang pasok in Metro Manila: class suspension for Thursday",
        "Random Blog PH",
      ),
    ],
    metroManila,
    now,
  );
  assert.deepEqual(scored.verdicts, {
    classes: "MERON",
    work: "MERON",
    government: "MERON",
  });
  assert.deepEqual(scored.confidence, {
    classes: "none",
    work: "none",
    government: "none",
  });
  assert.equal(scored.headlines.length, 0);
});

test("one GMA NCR class headline is WALA reported", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "Walang pasok in Metro Manila: class suspension for Thursday due to habagat",
        "GMA Network",
      ),
    ],
    metroManila,
    now,
  );
  assert.equal(scored.verdicts.classes, "WALA");
  assert.equal(scored.confidence.classes, "reported");
  assert.equal(scored.verdicts.work, "MERON");
  assert.equal(scored.confidence.work, "none");
  assert.equal(scored.headlines.length, 1);
});

test("GMA plus Inquirer is WALA confirmed for classes", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "Walang pasok in Metro Manila: class suspension for Thursday",
        "GMA Network",
      ),
      headline(
        "Metro Manila class suspension declared for Thursday",
        "Inquirer.net",
      ),
    ],
    metroManila,
    now,
  );
  assert.equal(scored.verdicts.classes, "WALA");
  assert.equal(scored.confidence.classes, "confirmed");
});

test("work headline does not confirm classes", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "Work suspension in Metro Manila for government and private offices",
        "Rappler",
      ),
    ],
    metroManila,
    now,
  );
  assert.equal(scored.verdicts.work, "WALA");
  assert.equal(scored.confidence.work, "reported");
  assert.equal(scored.verdicts.classes, "MERON");
  assert.equal(scored.confidence.classes, "none");
});

test("weekly summary groups evidence by Manila calendar day", () => {
  const days = summarizeWeek(
    [
      headline(
        "Walang pasok in Metro Manila: class suspension for Thursday",
        "GMA Network",
        "2026-08-13T10:00:00Z",
      ),
      headline(
        "Work suspension in Metro Manila for private offices",
        "Rappler",
        "2026-08-12T10:00:00Z",
      ),
    ],
    metroManila,
    now,
  );

  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-08-14");
  assert.equal(days.find((day) => day.date === "2026-08-13")?.verdicts.classes, "WALA");
  assert.equal(days.find((day) => day.date === "2026-08-13")?.verdicts.work, "MERON");
  assert.equal(days.find((day) => day.date === "2026-08-12")?.verdicts.work, "WALA");
  assert.equal(days.find((day) => day.date === "2026-08-11")?.confidence.classes, "none");
});

test("weekly summary uses the suspension date in a roundup title", () => {
  const days = summarizeWeek(
    [
      headline(
        "WALANG PASOK: Class suspensions for Monday, August 17, 2026",
        "GMA Network",
        "2026-08-16T04:34:00Z",
        "National Capital Region\nManila - Kindergarten to Senior High School",
      ),
    ],
    manila,
    new Date("2026-08-16T18:00:00Z"),
  );

  assert.equal(days[0].date, "2026-08-17");
  assert.equal(days[0].verdicts.classes, "WALA");
  assert.equal(days[1].verdicts.classes, "MERON");
});

test("status carries the week so one request can fill the board", () => {
  const status = statusFromHeadlines(
    [
      headline(
        "Walang pasok in Metro Manila: class suspension for Thursday",
        "GMA Network",
      ),
    ],
    metroManila,
    now,
  );

  assert.equal(status.verdicts.classes, "WALA");
  assert.equal(status.days.length, 7);
  assert.equal(
    status.days.find((day) => day.date === "2026-08-13")?.verdicts.classes,
    "WALA",
  );
});

test("article body can place a generic roundup without leaking other-place kinds", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "Walang Pasok: Class suspensions for Monday, August 17",
        "GMA Network",
        "2026-08-13T10:00:00Z",
        "National Capital Region Manila - Kindergarten to Senior High School. Cavite City - classes and government work suspended.",
      ),
    ],
    manila,
    now,
  );

  assert.equal(scored.verdicts.classes, "WALA");
  assert.equal(scored.verdicts.government, "MERON");
  assert.equal(scored.headlines[0].body, undefined);
});

test("NEWS_QUERIES contains keyword-split 7d queries", () => {
  assert.ok(NEWS_QUERIES.length >= 2);
  for (const q of NEWS_QUERIES) {
    assert.match(q, /when:7d/);
  }
});

test("mergeHeadlines deduplicates by link and sorts newest first", () => {
  const h1 = headline(
    "Walang pasok in Quezon City",
    "ABS-CBN",
    "2026-08-13T10:00:00Z",
  );
  const h2 = {
    ...headline(
      "Walang pasok in Quezon City - updated",
      "ABS-CBN",
      "2026-08-13T11:00:00Z",
    ),
    link: h1.link, // same link
  };
  const h3 = headline(
    "Classes suspended in Manila",
    "GMA Network",
    "2026-08-13T12:00:00Z",
  );

  const merged = mergeHeadlines([[h1], [h2, h3]]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].link, h3.link);
  assert.equal(merged[0].title, "Classes suspended in Manila");
  assert.equal(merged[1].link, h1.link);
});

