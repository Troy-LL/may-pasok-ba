import decoderModule from "google-news-url-decoder";
import { fold, hasPhrase } from "./classify.ts";
import type { Place } from "./places.ts";

const { GoogleDecoder } = decoderModule;
const SUPPORTED_HOSTS = [
  "gmanetwork.com",
  "abs-cbn.com",
  "mb.com.ph",
  "rappler.com",
  "philstar.com",
];

export function supportsArticleBody(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const host = parsed.hostname.replace(/^www\./, "");
    return SUPPORTED_HOSTS.some(
      (supported) => host === supported || host.endsWith(`.${supported}`),
    );
  } catch {
    return false;
  }
}

function jsonStringField(html: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`"${escaped}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`),
  );
  if (!match) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    quot: '"',
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name] ?? entity);
}

function cleanHtml(fragment: string): string {
  const decoded = decodeEntities(
    fragment
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(
        /<\/?(?:p|div|li|ul|ol|h[1-6]|br|section|article)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  );
  return decoded
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function container(
  html: string,
  start: RegExp,
  end: RegExp,
): string | undefined {
  const startMatch = start.exec(html);
  if (!startMatch) return undefined;
  const from = startMatch.index + startMatch[0].length;
  const rest = html.slice(from);
  const endMatch = end.exec(rest);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

export function extractArticleBody(
  url: string,
  html: string,
): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }

  let bodyHtml: string | undefined;
  if (host.endsWith("gmanetwork.com")) {
    bodyHtml = jsonStringField(html, "articleBody");
  } else if (host.endsWith("abs-cbn.com")) {
    bodyHtml = jsonStringField(html, "body_html");
  } else if (host.endsWith("mb.com.ph")) {
    const blocks = [...html.matchAll(
      /<div\b[^>]*class=(["'])[^"']*\barticle-text\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi,
    )].map((match) => match[2]);
    bodyHtml = blocks.length > 0 ? blocks.join(" ") : undefined;
  } else if (host.endsWith("rappler.com")) {
    bodyHtml = container(
      html,
      /<div\b[^>]*class=(["'])[^"']*\bpost-single__content\b[^"']*\1[^>]*>/i,
      /<\/article>/i,
    );
  } else if (host.endsWith("philstar.com")) {
    bodyHtml = container(
      html,
      /<div\b[^>]*id=(["'])sports_article_writeup\1[^>]*>/i,
      /<\/div>/i,
    );
  }

  if (!bodyHtml) {
    bodyHtml =
      jsonStringField(html, "articleBody") ?? metaDescription(html);
  }
  if (!bodyHtml) return undefined;
  const text = cleanHtml(bodyHtml);
  return text.length >= 20 ? text : undefined;
}

function metaDescription(html: string): string | undefined {
  const patterns = [
    /<meta\b[^>]*property=(["'])og:description\1[^>]*content=(["'])([\s\S]*?)\2/i,
    /<meta\b[^>]*content=(["'])([\s\S]*?)\1[^>]*property=(["'])og:description\3/i,
    /<meta\b[^>]*name=(["'])description\1[^>]*content=(["'])([\s\S]*?)\2/i,
    /<meta\b[^>]*content=(["'])([\s\S]*?)\1[^>]*name=(["'])description\3/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const value = [match[3], match[2]].find(
      (part) => typeof part === "string" && part.length >= 20,
    );
    if (value) return value;
  }
  return undefined;
}

function regionWideEvidence(text: string): string | undefined {
  const t = fold(text).replace(/\s+/g, " ");
  const region =
    "(?:metro manila|national capital region|kalakhang maynila|(?:^|[^a-z0-9])ncr(?:$|[^a-z0-9]))";
  const suspension =
    /(?:walang\s+pasok|suspensions?|suspended?|no\s+(?:face-to-face\s+)?classes|classes?\s+(?:are|were)?\s*called\s+off)/
      .source;
  const patterns = [
    new RegExp(
      `${suspension}.{0,180}(?:in|for|throughout|across|covering|all\\s+of)\\s+(?:the\\s+)?${region}`,
    ),
    new RegExp(`${region}.{0,120}${suspension}`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(t);
    if (match?.index !== undefined) {
      return text.slice(
        Math.max(0, match.index - 180),
        Math.min(text.length, match.index + match[0].length + 180),
      );
    }
  }
  return undefined;
}

export function bodyEvidenceForPlace(
  body: string,
  place: Place,
): string | undefined {
  const regionWide = regionWideEvidence(body);
  if (place.kind === "region") return regionWide;

  const folded = fold(body);
  const snippets: string[] = [];
  for (const name of [place.name, ...place.aliases]) {
    if (!hasPhrase(body, name)) continue;
    const index = folded.indexOf(fold(name));
    if (index >= 0) {
      const boundaries = ["\n", ".", ";"];
      const start = Math.max(
        0,
        ...boundaries.map((boundary) => body.lastIndexOf(boundary, index) + 1),
      );
      const ends = boundaries
        .map((boundary) => body.indexOf(boundary, index + name.length))
        .filter((end) => end >= 0);
      const end = ends.length > 0 ? Math.min(...ends) : body.length;
      snippets.push(body.slice(start, end));
    }
  }
  if (snippets.length > 0) return snippets.join(" ");
  return place.ncr ? regionWide : undefined;
}

export function bodyMentionsPlace(body: string, place: Place): boolean {
  return bodyEvidenceForPlace(body, place) !== undefined;
}

function needsArticleBody(headline: EnrichableHeadline): boolean {
  if (headline.body) return false;
  if (typeof headline.link !== "string") return false;
  if (!BODY_SOURCES.test(headline.source ?? "")) return false;
  return (
    headline.link.includes("news.google.com/") ||
    supportsArticleBody(headline.link)
  );
}

export function needsArticleBodies(
  headlines: EnrichableHeadline[],
): boolean {
  return headlines.some((headline) => needsArticleBody(headline));
}

type EnrichableHeadline = {
  link: string;
  source?: string;
  body?: string;
  title?: string;
};

const BODY_LIMIT = 6;
const RESOLVER_LIMIT = 1;
const DECODE_WORKERS = 2;
const DECODE_MS = 20_000;
const DECODE_FETCH_MS = 8_000;
const BODY_SOURCES =
  /gma|abs-cbn|manila bulletin|rappler|philstar|philippine star/i;
const DATED_ROUNDUP =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b/i;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
const decodedUrlCache = new Map<string, string>();

function cacheDecodedUrl(sourceUrl: string, decodedUrl: string): void {
  if (decodedUrlCache.size >= 100) {
    const oldest = decodedUrlCache.keys().next().value;
    if (typeof oldest === "string") decodedUrlCache.delete(oldest);
  }
  decodedUrlCache.set(sourceUrl, decodedUrl);
}

async function cancelIfUnused(response: Response): Promise<void> {
  if (!response.bodyUsed) {
    await response.body?.cancel();
  }
}

function googleNewsArticleId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.hostname === "news.google.com" &&
      parts.length >= 2 &&
      (parts.at(-2) === "articles" || parts.at(-2) === "read")
    ) {
      return parts.at(-1);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function googleNewsDecodeParams(
  html: string,
): { signature: string; timestamp: string } | undefined {
  const signature =
    html.match(/data-n-a-sg="([^"]+)"/)?.[1] ??
    html.match(/data-n-a-sg='([^']+)'/)?.[1] ??
    html.match(/data-n-a-sg=\\"([^"]+)\\"/)?.[1];
  const timestamp =
    html.match(/data-n-a-ts="([^"]+)"/)?.[1] ??
    html.match(/data-n-a-ts='([^']+)'/)?.[1] ??
    html.match(/data-n-a-ts=\\"([^"]+)\\"/)?.[1];
  if (!signature || !timestamp) return undefined;
  return { signature, timestamp };
}

export function publisherUrlFromBatchexecute(
  text: string,
): string | undefined {
  const jsonStr = text.includes("\n\n") ? text.split("\n\n").at(-1) : text;
  if (!jsonStr) return undefined;
  try {
    const parsed: unknown = JSON.parse(jsonStr.trim());
    if (!Array.isArray(parsed)) return undefined;
    const rows = parsed.filter(
      (row): row is [string, string, string] =>
        Array.isArray(row) &&
        (row[0] === "wrb.fr" || row[0] === "w779db") &&
        row[1] === "Fbv4je" &&
        typeof row[2] === "string",
    );
    const encoded =
      rows[0]?.[2] ??
      (Array.isArray(parsed[0]) && typeof parsed[0][2] === "string"
        ? parsed[0][2]
        : undefined);
    if (!encoded) return undefined;
    const inner: unknown = JSON.parse(encoded);
    if (!Array.isArray(inner) || typeof inner[1] !== "string") return undefined;
    return inner[1];
  } catch {
    return undefined;
  }
}

async function batchexecuteDecodedUrl(
  articleId: string,
  params: { signature: string; timestamp: string },
): Promise<string | undefined> {
  const batch = await fetch(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        Origin: "https://news.google.com",
        Referer: "https://news.google.com/",
      },
      body: `f.req=${encodeURIComponent(
        JSON.stringify([
          [
            [
              "Fbv4je",
              `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${articleId}",${params.timestamp},"${params.signature}"]`,
            ],
          ],
        ]),
      )}`,
      signal: AbortSignal.timeout(DECODE_FETCH_MS),
    },
  );
  if (!batch.ok) {
    await cancelIfUnused(batch);
    return undefined;
  }
  const decoded = publisherUrlFromBatchexecute(await batch.text());
  if (!decoded || decoded.includes("news.google.com")) return undefined;
  return decoded;
}

export async function decodeGoogleNewsUrlFromHtml(
  sourceUrl: string,
  html: string,
): Promise<string | undefined> {
  const articleId = googleNewsArticleId(sourceUrl);
  if (!articleId || html.length > 2_000_000) return undefined;
  const params = googleNewsDecodeParams(html);
  if (!params) return undefined;
  try {
    return await batchexecuteDecodedUrl(articleId, params);
  } catch {
    return undefined;
  }
}

export async function decodeGoogleNewsUrl(
  sourceUrl: string,
): Promise<string | undefined> {
  const articleId = googleNewsArticleId(sourceUrl);
  if (!articleId) return undefined;
  try {
    const page = await fetch(
      `https://news.google.com/rss/articles/${articleId}`,
      {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(DECODE_FETCH_MS),
      },
    );
    if (!page.ok) {
      await cancelIfUnused(page);
      return undefined;
    }
    return await decodeGoogleNewsUrlFromHtml(sourceUrl, await page.text());
  } catch {
    return undefined;
  }
}

function selectBodyCandidates<T extends EnrichableHeadline>(
  headlines: T[],
): { headline: T; index: number }[] {
  return headlines
    .map((headline, index) => ({ headline, index }))
    .filter(({ headline }) => needsArticleBody(headline))
    .sort((a, b) => {
      const dated =
        Number(DATED_ROUNDUP.test(b.headline.title ?? "")) -
        Number(DATED_ROUNDUP.test(a.headline.title ?? ""));
      if (dated !== 0) return dated;
      return a.index - b.index;
    })
    .slice(0, BODY_LIMIT);
}

async function fetchArticleBody(url: string): Promise<string | undefined> {
  if (!supportsArticleBody(url)) return undefined;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 1200, tags: ["news"] },
    });
    if (!response.ok || !supportsArticleBody(response.url)) {
      await cancelIfUnused(response);
      return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      await cancelIfUnused(response);
      return undefined;
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 1_500_000) {
      await cancelIfUnused(response);
      return undefined;
    }
    const html = await response.text();
    if (html.length > 1_500_000) return undefined;
    return extractArticleBody(response.url, html);
  } catch {
    return undefined;
  }
}

export type ArticleResolver = (
  url: string,
) => Promise<{ url: string; html?: string } | undefined>;

async function decodeWithLibrary(link: string): Promise<string | undefined> {
  const decoder = new GoogleDecoder();
  try {
    const result = await Promise.race([
      decoder.decode(link),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), DECODE_MS),
      ),
    ]);
    if (
      result?.status &&
      typeof result.decoded_url === "string" &&
      !result.decoded_url.includes("news.google.com")
    ) {
      return result.decoded_url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function enrichArticleBodies<T extends EnrichableHeadline>(
  headlines: T[],
  resolver?: ArticleResolver,
): Promise<T[]> {
  const candidateIndexes = selectBodyCandidates(headlines);
  if (candidateIndexes.length === 0) return headlines;

  const bySource = new Map<string, { url: string; html?: string }>();
  for (const { headline } of candidateIndexes) {
    const cached = decodedUrlCache.get(headline.link);
    if (cached) bySource.set(headline.link, { url: cached });
    else if (supportsArticleBody(headline.link)) {
      bySource.set(headline.link, { url: headline.link });
    }
  }

  const unresolved = candidateIndexes
    .map(({ headline }) => headline.link)
    .filter((link) => !bySource.has(link));
  if (unresolved.length > 0) {
    await Promise.all(
      unresolved.map(async (link) => {
        const decoded = await decodeGoogleNewsUrl(link);
        if (!decoded) return;
        bySource.set(link, { url: decoded });
        cacheDecodedUrl(link, decoded);
      }),
    );

    const stillUnresolved = unresolved.filter((link) => !bySource.has(link));
    if (resolver) {
      for (const link of stillUnresolved.slice(0, RESOLVER_LIMIT)) {
        try {
          const res = await resolver(link);
          if (res?.url && !res.url.includes("news.google.com")) {
            bySource.set(link, res);
            cacheDecodedUrl(link, res.url);
          }
        } catch {
          // Keep the Google link and continue with headline-only scoring.
        }
      }
    }

    const libraryFallback = stillUnresolved.filter(
      (link) => !bySource.has(link),
    );
    if (!resolver && libraryFallback.length > 0) {
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(DECODE_WORKERS, libraryFallback.length) },
        async () => {
          while (cursor < libraryFallback.length) {
            const link = libraryFallback[cursor++];
            const decoded = await decodeWithLibrary(link);
            if (!decoded) continue;
            bySource.set(link, { url: decoded });
            cacheDecodedUrl(link, decoded);
          }
        },
      );
      await Promise.all(workers);
    }
  }

  const enriched = [...headlines];
  await Promise.all(
    candidateIndexes.map(async ({ headline, index }) => {
      const resolved = bySource.get(headline.link);
      if (!resolved) return;
      let body: string | undefined;
      if (resolved.html) {
        body = extractArticleBody(resolved.url, resolved.html);
      }
      if (!body) {
        body = await fetchArticleBody(resolved.url);
      }
      enriched[index] = {
        ...headline,
        link: resolved.url,
        ...(body ? { body } : {}),
      };
    }),
  );
  return enriched;
}

