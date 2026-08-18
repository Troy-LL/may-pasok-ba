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

  if (!bodyHtml) return undefined;
  const text = cleanHtml(bodyHtml);
  return text.length >= 20 ? text : undefined;
}

function regionWideEvidence(text: string): string | undefined {
  const t = fold(text).replace(/\s+/g, " ");
  const region =
    "(?:metro manila|national capital region|kalakhang maynila|(?:^|[^a-z0-9])ncr(?:$|[^a-z0-9]))";
  const suspension =
    "(?:walang\\s+pasok|suspend(?:ed|sion|ing)?|no\\s+(?:face-to-face\\s+)?classes|classes?\\s+(?:are|were)?\\s*called\\s+off)";
  const patterns = [
    new RegExp(
      `${suspension}.{0,180}(?:in|for|throughout|across|covering|all\\s+of)\\s+${region}`,
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

type EnrichableHeadline = {
  link: string;
  source?: string;
  body?: string;
};

const BODY_LIMIT = 6;
const DECODE_WORKERS = 6;
const DECODE_MS = 12_000;
const BODY_SOURCES =
  /gma|abs-cbn|manila bulletin|rappler|philstar|philippine star/i;
const decodedUrlCache = new Map<string, string>();

function cacheDecodedUrl(sourceUrl: string, decodedUrl: string): void {
  if (decodedUrlCache.size >= 100) {
    const oldest = decodedUrlCache.keys().next().value;
    if (typeof oldest === "string") decodedUrlCache.delete(oldest);
  }
  decodedUrlCache.set(sourceUrl, decodedUrl);
}

async function fetchArticleBody(url: string): Promise<string | undefined> {
  if (!supportsArticleBody(url)) return undefined;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "MayPasokBa/1.0 (public suspension evidence reader)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 1200, tags: ["news"] },
    });
    if (!response.ok || !supportsArticleBody(response.url)) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return undefined;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 1_500_000) return undefined;
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

export async function enrichArticleBodies<T extends EnrichableHeadline>(
  headlines: T[],
  resolver?: ArticleResolver,
): Promise<T[]> {
  const candidateIndexes = headlines
    .map((headline, index) => ({ headline, index }))
    .filter(
      ({ headline }) =>
        !headline.body &&
        headline.link.includes("news.google.com/") &&
        BODY_SOURCES.test(headline.source ?? ""),
    )
    .slice(0, BODY_LIMIT);
  if (candidateIndexes.length === 0) return headlines;

  const bySource = new Map<string, { url: string; html?: string }>();
  for (const { headline } of candidateIndexes) {
    const cached = decodedUrlCache.get(headline.link);
    if (cached) bySource.set(headline.link, { url: cached });
  }

  const unresolved = candidateIndexes
    .map(({ headline }) => headline.link)
    .filter((link) => !bySource.has(link));
  if (unresolved.length > 0) {
    if (resolver) {
      for (const link of unresolved) {
        try {
          const res = await resolver(link);
          if (res?.url && !res.url.includes("news.google.com")) {
            bySource.set(link, res);
            cacheDecodedUrl(link, res.url);
          }
        } catch {
          // Continue to fallback decoder
        }
      }
    }

    const stillUnresolved = unresolved.filter((link) => !bySource.has(link));
    if (stillUnresolved.length > 0) {
      const decoder = new GoogleDecoder();
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(DECODE_WORKERS, stillUnresolved.length) },
        async () => {
          while (cursor < stillUnresolved.length) {
            const link = stillUnresolved[cursor++];
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
                bySource.set(link, { url: result.decoded_url });
                cacheDecodedUrl(link, result.decoded_url);
              }
            } catch {
              // Keep the Google link and continue with headline-only scoring.
            }
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
