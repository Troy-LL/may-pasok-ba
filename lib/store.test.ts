import assert from "node:assert/strict";
import test from "node:test";
import type { Headline } from "./rss.ts";
import {
  cachedHeadlines,
  decodeHeadlines,
  encodeHeadlines,
  newsKey,
  preserveHeadlineBodies,
  singleFlight,
  type HeadlineStore,
} from "./store.ts";

const headline: Headline = {
  title: "Walang pasok in Metro Manila",
  link: "https://example.com/gma",
  source: "GMA Network",
  publishedAt: new Date("2026-08-13T10:00:00Z"),
};

function memoryStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const puts: string[] = [];
  const store: HeadlineStore = {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      puts.push(key);
      data.set(key, value);
    },
  };
  return { store, data, puts };
}

test("encoded headlines survive a round trip with dates", () => {
  const fetchedAt = new Date("2026-08-13T21:00:00Z");
  const decoded = decodeHeadlines(encodeHeadlines([headline], fetchedAt));

  assert.equal(decoded?.fetchedAt.toISOString(), fetchedAt.toISOString());
  assert.equal(decoded?.headlines.length, 1);
  assert.equal(decoded?.headlines[0].title, headline.title);
  assert.equal(
    decoded?.headlines[0].publishedAt.toISOString(),
    headline.publishedAt.toISOString(),
  );
});

test("decode rejects missing and malformed entries", () => {
  assert.equal(decodeHeadlines(null), null);
  assert.equal(decodeHeadlines("not json"), null);
  assert.equal(decodeHeadlines('{"headlines":[]}'), null);
});

test("fresh cache entries skip the network", async () => {
  const now = new Date("2026-08-13T21:00:00Z");
  const { store, puts } = memoryStore({
    [newsKey("manila")]: encodeHeadlines(
      [headline],
      new Date("2026-08-13T20:55:00Z"),
    ),
  });

  let loads = 0;
  const headlines = await cachedHeadlines(store, "manila", now, async () => {
    loads += 1;
    return [];
  });

  assert.equal(loads, 0);
  assert.equal(puts.length, 0);
  assert.equal(headlines.headlines.length, 1);
});

test("fresh cache still refreshes when Google links have no article body", async () => {
  const now = new Date("2026-08-13T21:00:00Z");
  const googleHeadline: Headline = {
    title: "WALANG PASOK: Class suspensions for Wednesday, August 19, 2026",
    link: "https://news.google.com/rss/articles/CBMi123",
    source: "ABS-CBN",
    publishedAt: new Date("2026-08-18T10:57:00Z"),
  };
  const { store, data } = memoryStore({
    [newsKey("ncr")]: encodeHeadlines(
      [googleHeadline],
      new Date("2026-08-13T20:55:00Z"),
    ),
  });

  const background: Promise<unknown>[] = [];
  let loads = 0;
  const result = await cachedHeadlines(
    store,
    "ncr",
    now,
    async () => {
      loads += 1;
      return [
        {
          ...googleHeadline,
          link: "https://www.abs-cbn.com/news/story",
          body: "Malacañang announced the suspension of face-to-face classes in the National Capital Region.",
        },
      ];
    },
    { revalidate: (promise) => background.push(promise) },
  );

  assert.equal(result.headlines[0]?.body, undefined);
  assert.equal(background.length, 1);
  await Promise.all(background);
  assert.equal(loads, 1);
  assert.match(
    decodeHeadlines(data.get(newsKey("ncr")) ?? null)?.headlines[0]?.body ?? "",
    /National Capital Region/,
  );
});

test("stale cache entries are refreshed and written back", async () => {
  const now = new Date("2026-08-13T21:00:00Z");
  const { store, data } = memoryStore({
    [newsKey("manila")]: encodeHeadlines(
      [],
      new Date("2026-08-13T18:00:00Z"),
    ),
  });

  const headlines = await cachedHeadlines(store, "manila", now, async () => [
    headline,
  ]);

  assert.equal(headlines.headlines.length, 1, "refreshed headlines are returned");
  assert.equal(
    decodeHeadlines(data.get(newsKey("manila")) ?? null)?.fetchedAt.toISOString(),
    now.toISOString(),
  );
});

test("a failed refresh serves the stale entry instead of throwing", async () => {
  const now = new Date("2026-08-13T21:00:00Z");
  const { store } = memoryStore({
    [newsKey("manila")]: encodeHeadlines(
      [headline],
      new Date("2026-08-13T12:00:00Z"),
    ),
  });

  const headlines = await cachedHeadlines(store, "manila", now, async () => {
    throw new Error("news 503");
  });

  assert.equal(headlines.headlines.length, 1);
});

test("stale entries are served at once and refreshed in the background", async () => {
  const now = new Date("2026-08-13T21:00:00Z");
  const { store, data } = memoryStore({
    [newsKey("manila")]: encodeHeadlines([], new Date("2026-08-13T18:00:00Z")),
  });

  const background: Promise<unknown>[] = [];
  const headlines = await cachedHeadlines(
    store,
    "manila",
    now,
    async () => [headline],
    { revalidate: (promise) => background.push(promise) },
  );

  assert.equal(headlines.headlines.length, 0);
  assert.equal(background.length, 1);

  await Promise.all(background);
  assert.equal(
    decodeHeadlines(data.get(newsKey("manila")) ?? null)?.headlines.length,
    1,
  );
});

test("a failed load with no cache entry rejects", async () => {
  const { store } = memoryStore();

  await assert.rejects(
    cachedHeadlines(store, "manila", new Date(), async () => {
      throw new Error("news 503");
    }),
    /news 503/,
  );
});

test("preserveHeadlineBodies retains article bodies from existing cache", () => {
  const existing: Headline[] = [
    {
      title: "WALANG PASOK: Class suspensions",
      link: "https://example.com/story1",
      source: "Rappler",
      publishedAt: new Date("2026-08-17T01:00:00Z"),
      body: "Caloocan - all levels suspended",
    },
  ];
  const freshWithoutBody: Headline[] = [
    {
      title: "WALANG PASOK: Class suspensions",
      link: "https://example.com/story1",
      source: "Rappler",
      publishedAt: new Date("2026-08-17T01:00:00Z"),
    },
  ];
  const merged = preserveHeadlineBodies(freshWithoutBody, existing);
  assert.equal(merged[0]?.body, "Caloocan - all levels suspended");
});

test("stale entries preserve extracted bodies when refreshed in background", async () => {
  const now = new Date("2026-08-17T05:00:00Z");
  const cachedItem: Headline = {
    title: "WALANG PASOK: Class suspensions",
    link: "https://example.com/story1",
    source: "Rappler",
    publishedAt: new Date("2026-08-17T01:00:00Z"),
    body: "Caloocan - all levels suspended",
  };
  const { store, data } = memoryStore({
    [newsKey("ncr")]: encodeHeadlines([cachedItem], new Date("2026-08-17T04:00:00Z")),
  });

  const background: Promise<unknown>[] = [];
  const freshWithoutBody: Headline = {
    title: "WALANG PASOK: Class suspensions",
    link: "https://example.com/story1",
    source: "Rappler",
    publishedAt: new Date("2026-08-17T01:00:00Z"),
  };

  await cachedHeadlines(
    store,
    "ncr",
    now,
    async () => [freshWithoutBody],
    { revalidate: (promise) => background.push(promise) },
  );

  await Promise.all(background);
  const updated = decodeHeadlines(data.get(newsKey("ncr")) ?? null);
  assert.equal(updated?.headlines[0]?.body, "Caloocan - all levels suspended");
});

test("single flight shares one load between concurrent callers", async () => {
  const flight = singleFlight<number>();
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return loads;
  };

  const [a, b] = await Promise.all([
    flight("manila", load),
    flight("manila", load),
  ]);

  assert.equal(loads, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await flight("manila", load), 2);
});
