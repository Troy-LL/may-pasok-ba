import assert from "node:assert/strict";
import test from "node:test";
import type { Place } from "./places.ts";
import {
  fetchRssHeadlines,
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

const caloocan: Place = {
  ...manila,
  id: "caloocan",
  name: "Caloocan",
  aliases: ["Caloocan City", "City of Caloocan"],
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

test("status asOf is the headline fetch time, not the request time", () => {
  const fetchedAt = new Date("2026-08-13T10:00:00Z");
  const status = statusFromHeadlines(
    [
      headline(
        "Walang pasok in Metro Manila: class suspension for Thursday",
        "GMA Network",
      ),
    ],
    metroManila,
    now,
    fetchedAt,
  );

  assert.equal(status.asOf, "2026-08-13T10:00:00.000Z");
  assert.equal(status.phDate, "2026-08-14");
});

test("HTML 200 from Google is not treated as an empty feed", async () => {
  const originalFetch = globalThis.fetch;
  let rss2jsonCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("rss2json.com")) {
      rss2jsonCalls += 1;
      return Response.json({
        status: "ok",
        items: [
          {
            title: "Walang pasok in Quezon City - ABS-CBN",
            link: "https://news.google.com/rss/articles/example",
            pubDate: "2026-08-13 10:00:00",
          },
        ],
      });
    }
    return new Response("<html><body>blocked</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  try {
    const headlines = await fetchRssHeadlines(undefined, NEWS_QUERIES.slice(0, 1));
    assert.equal(rss2jsonCalls, 1);
    assert.equal(headlines[0]?.title, "Walang pasok in Quezon City");
    assert.equal(headlines[0]?.source, "ABS-CBN");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
        "2026-08-16T10:00:00Z",
        "National Capital Region Manila - Kindergarten to Senior High School. Cavite City - classes and government work suspended.",
      ),
    ],
    manila,
    new Date("2026-08-16T21:00:00Z"),
  );

  assert.equal(scored.verdicts.classes, "WALA");
  assert.equal(scored.verdicts.government, "MERON");
  assert.equal(scored.headlines[0].body, undefined);
});

test("dated roundups for yesterday do not drive the current board after midnight", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "[Walang Pasok] Class suspensions, Tuesday, August 18, 2026",
        "Rappler",
        "2026-08-18T15:04:29Z",
        "National Capital Region Manila - all levels public and private",
      ),
    ],
    manila,
    new Date("2026-08-18T16:39:00Z"),
  );
  assert.equal(scored.verdicts.classes, "MERON");
});

test("today's dated roundup still counts when published last night", () => {
  const scored = scoreHeadlines(
    [
      headline(
        "WALANG PASOK: Class suspensions for Wednesday, August 19, 2026",
        "GMA Network",
        "2026-08-18T11:51:00Z",
        "National Capital Region Manila - all levels public and private",
      ),
    ],
    manila,
    new Date("2026-08-18T16:39:00Z"),
  );
  assert.equal(scored.verdicts.classes, "WALA");
});

test("a roundup posted a day early still counts on the evening before", () => {
  const evening = new Date("2026-08-18T12:00:00Z");
  const early = headline(
    "#WalangPasok: Work, class suspensions for August 19, 2026 due to habagat rains, floods",
    "ABS-CBN",
    "2026-08-18T10:57:00Z",
    "National Capital Region Manila - all levels public and private",
  );
  const scored = scoreHeadlines([early], manila, evening);
  assert.equal(scored.verdicts.classes, "WALA");
  assert.equal(scored.verdicts.work, "WALA");

  const days = summarizeWeek([early], manila, evening);
  assert.equal(days[0].date, "2026-08-19");
  assert.equal(days[0].verdicts.classes, "WALA");
  assert.equal(
    days.find((day) => day.date === "2026-08-18")?.verdicts.classes,
    "MERON",
  );
});

test("Palace NCR suspension updates Manila and Caloocan from the article body", () => {
  const palace = headline(
    "#WalangPasok: Work, class suspensions for August 19, 2026 due to habagat rains, floods",
    "ABS-CBN",
    "2026-08-18T10:57:00Z",
    "MANILA (2nd UPDATE) — Malacañang announced the suspension of face-to-face classes in all levels, as well as work in government offices in the National Capital Region and 17 other provinces on Wednesday, August 19.",
  );
  const now = new Date("2026-08-18T16:51:00Z");
  const inManila = scoreHeadlines([palace], manila, now);
  const inCaloocan = scoreHeadlines([palace], caloocan, now);
  const metro = scoreHeadlines([palace], metroManila, now);
  assert.equal(inManila.verdicts.classes, "WALA");
  assert.equal(inManila.verdicts.work, "WALA");
  assert.equal(inManila.verdicts.government, "WALA");
  assert.equal(inCaloocan.verdicts.classes, "WALA");
  assert.equal(metro.verdicts.classes, "WALA");
});

test("weekly summary reads Aug. 19 without a year", () => {
  const days = summarizeWeek(
    [
      headline(
        "Walang Pasok: Class suspensions Aug. 19 (Wednesday) due to bad weather",
        "Inquirer.net",
        "2026-08-18T08:46:00Z",
        "Manila - all levels public and private",
      ),
    ],
    manila,
    new Date("2026-08-18T16:39:00Z"),
  );
  assert.equal(days[0].date, "2026-08-19");
  assert.equal(days[0].verdicts.classes, "WALA");
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

