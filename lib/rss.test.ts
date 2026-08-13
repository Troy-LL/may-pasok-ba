import assert from "node:assert/strict";
import test from "node:test";
import { parseRss } from "./rss.ts";

const SAMPLE = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Walang pasok in Dagupan City - GMA Network</title>
  <link>https://example.com/a</link>
  <pubDate>Thu, 13 Aug 2026 06:33:00 GMT</pubDate>
  <source url="https://www.gmanetwork.com">GMA Network</source>
</item>
<item>
  <title><![CDATA[Work suspension in NCR]]></title>
  <link>https://example.com/b</link>
  <pubDate>Thu, 13 Aug 2026 01:00:00 GMT</pubDate>
</item>
</channel></rss>`;

test("parseRss reads title, source, date", () => {
  const items = parseRss(SAMPLE);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Walang pasok in Dagupan City");
  assert.equal(items[0].source, "GMA Network");
  assert.equal(items[0].publishedAt.toISOString(), "2026-08-13T06:33:00.000Z");
  assert.equal(items[1].title, "Work suspension in NCR");
});
