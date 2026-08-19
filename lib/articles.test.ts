import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyMentionsPlace,
  decodeGoogleNewsUrl,
  enrichArticleBodies,
  extractArticleBody,
  googleNewsDecodeParams,
  needsArticleBodies,
  publisherUrlFromBatchexecute,
} from "./articles.ts";
import type { Place } from "./places.ts";

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

const ncr: Place = {
  ...manila,
  id: "metro-manila",
  name: "Metro Manila",
  province: "NCR",
  kind: "region",
  aliases: ["NCR", "National Capital Region", "Kalakhang Maynila"],
};

test("extracts GMA JSON-LD articleBody", () => {
  const html = `<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"<p>National Capital Region</p><ul><li>Manila - All levels</li></ul>"}</script>`;
  assert.match(
    extractArticleBody("https://www.gmanetwork.com/news/story/", html) ?? "",
    /Manila - All levels/,
  );
});

test("extracts ABS-CBN body_html from Next data", () => {
  const html = `<script id="__NEXT_DATA__">{"props":{"article":{"body_html":"\\u003cp\\u003eQuezon City - all levels\\u003c/p\\u003e"}}}</script>`;
  assert.match(
    extractArticleBody("https://www.abs-cbn.com/news/story", html) ?? "",
    /Quezon City - all levels/,
  );
});

test("extracts Manila Bulletin article-text blocks", () => {
  const html = `<div class='article-text left'>Manila classes were suspended.</div><div class='article-text left'>Pasig shifted to ADM.</div>`;
  assert.match(
    extractArticleBody("https://mb.com.ph/2026/story", html) ?? "",
    /Manila classes were suspended\.\s+Pasig shifted to ADM\./,
  );
});

test("extracts Rappler and Philstar article containers", () => {
  assert.match(
    extractArticleBody(
      "https://www.rappler.com/philippines/story/",
      `<article><div class="post-single__content"><p>Metro Manila list</p><ul><li>Manila</li></ul></div></article><footer>Related</footer>`,
    ) ?? "",
    /Metro Manila list\s+Manila/,
  );
  assert.match(
    extractArticleBody(
      "https://www.philstar.com/headlines/story",
      `<div id="sports_article_writeup" class="article__writeup"><p>Manila suspended classes.</p></div><aside>Related</aside>`,
    ) ?? "",
    /Manila suspended classes/,
  );
});

test("an NCR section with only Manila does not flip Caloocan or the whole region", () => {
  const body =
    "List of areas where classes were suspended: National Capital Region Manila - Kindergarten to Senior High School.";
  assert.equal(bodyMentionsPlace(body, manila), true);
  assert.equal(bodyMentionsPlace(body, caloocan), false);
  assert.equal(bodyMentionsPlace(body, ncr), false);
});

test("an explicit NCR-wide suspension applies to every NCR place", () => {
  const body =
    "Malacañang suspended face-to-face classes at all levels throughout Metro Manila due to heavy rain.";
  assert.equal(bodyMentionsPlace(body, manila), true);
  assert.equal(bodyMentionsPlace(body, caloocan), true);
  assert.equal(bodyMentionsPlace(body, ncr), true);
});

test("Palace NCR order in ABS-CBN and Rappler copy applies to every NCR city", () => {
  const absCbn =
    "MANILA (2nd UPDATE) — Malacañang announced the suspension of face-to-face classes in all levels, as well as work in government offices in the National Capital Region and 17 other provinces on Wednesday, August 19, due to inclement weather brought by the southwest monsoon or habagat.";
  const rappler =
    "Malacañang suspended face-to-face classes in all levels for public and private schools in Metro Manila and 17 provinces for Wednesday, August 19, as the southwest monsoon or habagat continues to trigger significant rainfall.";
  for (const body of [absCbn, rappler]) {
    assert.equal(bodyMentionsPlace(body, manila), true);
    assert.equal(bodyMentionsPlace(body, caloocan), true);
    assert.equal(bodyMentionsPlace(body, ncr), true);
  }
});

test("enrich uses the resolver before Worker Google fetches", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("news.google.com")) {
      assert.fail("resolver should skip Worker Google decode");
    }
    return Promise.resolve(
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
  }) as typeof fetch;
  try {
    const enriched = await enrichArticleBodies(
      [
        {
          title: "WALANG PASOK: Class suspensions for August 19",
          link: "https://news.google.com/rss/articles/CBMi123",
          source: "GMA Network",
          publishedAt: new Date("2026-08-18T10:00:00Z"),
        },
      ],
      async () => ({
        url: "https://www.gmanetwork.com/news/story/123",
        html: `<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Quezon City - all levels suspended"}</script>`,
      }),
    );
    assert.equal(enriched[0]?.link, "https://www.gmanetwork.com/news/story/123");
    assert.match(enriched[0]?.body ?? "", /Quezon City - all levels/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("googleNewsDecodeParams reads signature attributes without a DOM parse", () => {
  const params = googleNewsDecodeParams(
    `<div data-n-a-ts="1787072804" data-n-a-sg="Ae5Wzi8vRa8zkLaoMj6DiZlSUOAI"></div>`,
  );
  assert.equal(params?.timestamp, "1787072804");
  assert.equal(params?.signature, "Ae5Wzi8vRa8zkLaoMj6DiZlSUOAI");
});

test("publisherUrlFromBatchexecute reads the inner decoded URL", () => {
  const url = publisherUrlFromBatchexecute(
    `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify([null, "https://www.abs-cbn.com/news/story"])]])}`,
  );
  assert.equal(url, "https://www.abs-cbn.com/news/story");
});

test("decodeGoogleNewsUrl follows Google decode params then batchexecute", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("batchexecute")) {
      return new Response(
        `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify([null, "https://www.abs-cbn.com/news/story"])]])}`,
      );
    }
    return new Response(
      `<div data-n-a-ts="123" data-n-a-sg="sig"></div>`,
    );
  }) as typeof fetch;

  try {
    const url = await decodeGoogleNewsUrl(
      "https://news.google.com/rss/articles/CBMidecode",
    );
    assert.equal(url, "https://www.abs-cbn.com/news/story");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts Open Graph description when the article body script is missing", () => {
  const html = `<meta property="og:description" content="Malacañang announced the suspension of face-to-face classes in all levels, as well as work in government offices in the National Capital Region and 17 other provinces on Wednesday, August 19."/>`;
  assert.match(
    extractArticleBody("https://www.abs-cbn.com/news/story", html) ?? "",
    /National Capital Region/,
  );
});

test("needsArticleBodies stays true after a Google link is resolved without a body", () => {
  assert.equal(
    needsArticleBodies(
      [
        {
          title: "#WalangPasok: Work, class suspensions for August 19, 2026",
          link: "https://www.abs-cbn.com/news/aug19",
          source: "ABS-CBN",
        },
      ],
      new Date("2026-08-18T16:39:00Z"),
    ),
    true,
  );
});

test("yesterday's dated Google links do not keep the request waiting", () => {
  assert.equal(
    needsArticleBodies(
      [
        {
          title: "[Walang Pasok] Class suspensions, Tuesday, August 18, 2026",
          link: "https://news.google.com/rss/articles/old",
          source: "Rappler",
        },
      ],
      new Date("2026-08-18T16:39:00Z"),
    ),
    false,
  );
});

test("a Palace body is enough to stop waiting on leftover class-list Google links", () => {
  assert.equal(
    needsArticleBodies(
      [
        {
          title: "#WalangPasok: Work, class suspensions for August 19, 2026",
          link: "https://www.abs-cbn.com/news/aug19",
          source: "ABS-CBN",
          body: "Malacañang announced the suspension of face-to-face classes in the National Capital Region.",
        },
        {
          title: "WALANG PASOK: Class suspensions for Wednesday, August 19, 2026",
          link: "https://news.google.com/rss/articles/gma",
          source: "GMA Network",
        },
      ],
      new Date("2026-08-18T16:39:00Z"),
    ),
    false,
  );
});

test("a classes-only body still waits for a Palace or work Google link", () => {
  assert.equal(
    needsArticleBodies(
      [
        {
          title: "WALANG PASOK: Mga suspendidong klase sa Miyerkoles, August 19, 2026",
          link: "https://www.gmanetwork.com/news/balitambayan/aug19",
          source: "GMA Network",
          body: "METRO MANILA Marikina -- all levels public and private schools",
        },
        {
          title: "#WalangPasok: Work, class suspensions for August 19, 2026 due to habagat rains, floods",
          link: "https://news.google.com/rss/articles/abscbn",
          source: "ABS-CBN",
        },
      ],
      new Date("2026-08-19T00:10:00Z"),
    ),
    true,
  );
});

test("Palace alternative-work copy still counts as NCR-wide even without the word suspended", () => {
  const body =
    "Malacañang instructed schools and government offices in the National Capital Region and other areas to shift to alternative work arrangements on Wednesday, August 19.";
  assert.equal(bodyMentionsPlace(body, manila), true);
  assert.equal(bodyMentionsPlace(body, caloocan), true);
  assert.equal(bodyMentionsPlace(body, ncr), true);
});

test("enrich fetches a publisher URL that was already decoded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, /abs-cbn\.com/);
    const response = new Response(
      `<meta property="og:description" content="Malacañang announced the suspension of face-to-face classes in all levels, as well as work in government offices in the National Capital Region and 17 other provinces."/>`,
      { headers: { "content-type": "text/html" } },
    );
    Object.defineProperty(response, "url", {
      value: "https://www.abs-cbn.com/news/aug19",
    });
    return response;
  }) as typeof fetch;

  try {
    const enriched = await enrichArticleBodies([
      {
        title: "#WalangPasok: Work, class suspensions for August 19, 2026",
        link: "https://www.abs-cbn.com/news/aug19",
        source: "ABS-CBN",
        publishedAt: new Date("2026-08-18T10:57:00Z"),
      },
    ]);
    assert.match(enriched[0]?.body ?? "", /National Capital Region/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("enrich prefers dated roundups when many Google links need bodies", async () => {
  const originalFetch = globalThis.fetch;
  const fetched = new Set<string>();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.add(url);
    if (url.includes("batchexecute")) {
      return new Response(
        `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify([null, "https://www.abs-cbn.com/news/aug19"])]])}`,
      );
    }
    if (url.includes("news.google.com/rss/articles/aug19")) {
      return new Response(
        `<div data-n-a-ts="123" data-n-a-sg="sig"></div>`,
      );
    }
    if (url.includes("abs-cbn.com")) {
      const response = new Response(
        `<script id="__NEXT_DATA__">{"props":{"article":{"body_html":"<p>Malacañang announced the suspension of face-to-face classes in the National Capital Region.</p>"}}}</script>`,
        { headers: { "content-type": "text/html" } },
      );
      Object.defineProperty(response, "url", {
        value: "https://www.abs-cbn.com/news/aug19",
      });
      return response;
    }
    return new Response("<html></html>", {
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  try {
    const headlines = [
      ...Array.from({ length: 6 }, (_, index) => ({
        title: `Walang pasok somewhere ${index}`,
        link: `https://news.google.com/rss/articles/old${index}`,
        source: "Rappler",
        publishedAt: new Date("2026-08-18T15:00:00Z"),
      })),
      {
        title:
          "#WalangPasok: Work, class suspensions for August 19, 2026 due to habagat rains",
        link: "https://news.google.com/rss/articles/aug19",
        source: "ABS-CBN",
        publishedAt: new Date("2026-08-18T10:57:00Z"),
      },
    ];
    const enriched = await enrichArticleBodies(headlines);
    const aug19 = enriched.at(-1);
    assert.equal(aug19?.link, "https://www.abs-cbn.com/news/aug19");
    assert.match(aug19?.body ?? "", /National Capital Region/);
    assert.ok(
      [...fetched].some((url) => url.includes("articles/aug19")),
      "dated roundup must be decoded even when it is not the newest item",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
