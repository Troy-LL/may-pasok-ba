export type Headline = {
  title: string;
  link: string;
  publishedAt: Date;
  source: string;
  body?: string;
};

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

export function parseRss(xml: string): Headline[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  const out: Headline[] = [];
  for (const raw of items) {
    const title = tag(raw, "title");
    if (!title) continue;
    const link = tag(raw, "link");
    const pub = tag(raw, "pubDate");
    const source = tag(raw, "source") || sourceFromTitle(title);
    const publishedAt = pub ? new Date(pub) : new Date(NaN);
    out.push({
      title: stripSourceSuffix(title, source),
      link,
      publishedAt,
      source,
    });
  }
  return out;
}

function sourceFromTitle(title: string): string {
  const i = title.lastIndexOf(" - ");
  return i === -1 ? "" : title.slice(i + 3).trim();
}

function stripSourceSuffix(title: string, source: string): string {
  if (source && title.endsWith(` - ${source}`)) {
    return title.slice(0, title.length - source.length - 3).trim();
  }
  return title;
}
