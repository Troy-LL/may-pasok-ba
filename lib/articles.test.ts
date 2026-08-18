import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyMentionsPlace,
  enrichArticleBodies,
  extractArticleBody,
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

test("enrichArticleBodies uses custom resolver to resolve link and body", async () => {
  const headlines = [
    {
      title: "WALANG PASOK: Class suspensions for August 17",
      link: "https://news.google.com/rss/articles/CBMi123",
      source: "GMA Network",
      publishedAt: new Date("2026-08-17T01:00:00Z"),
    },
  ];
  const enriched = await enrichArticleBodies(headlines, async () => {
    return {
      url: "https://www.gmanetwork.com/news/story/123",
      html: `<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Quezon City - all levels suspended"}</script>`,
    };
  });
  assert.equal(enriched[0]?.link, "https://www.gmanetwork.com/news/story/123");
  assert.match(enriched[0]?.body ?? "", /Quezon City - all levels/);
});
