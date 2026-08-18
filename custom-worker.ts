import puppeteer from "@cloudflare/puppeteer";
import {
  fetchRssHeadlines,
  statusFromHeadlines,
  weeklyFromHeadlines,
} from "./lib/news.ts";
import { enrichArticleBodies } from "./lib/articles.ts";
import {
  getPlace,
  matchGeo,
  resolvePlace,
} from "./lib/places.ts";
import { isCronAuthorized } from "./lib/cron.ts";
import {
  cachedHeadlines,
  putHeadlines,
  singleFlight,
  type CachedHeadlines,
} from "./lib/store.ts";
import {
  applySecurityHeaders,
  corsPreflightResponse,
  isValidCoordinate,
  sanitizeQuery,
} from "./lib/security.ts";
import { looksLikeRss, type Headline } from "./lib/rss.ts";
import type { Place } from "./lib/places.ts";

type Env = CloudflareEnv & {
  CRON_SECRET?: string;
};

type Nominatim = {
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state?: string;
  };
};

function json(value: unknown, status = 200, maxAge = 0): Response {
  return Response.json(value, {
    status,
    headers: maxAge
      ? { "cache-control": `public, max-age=0, s-maxage=${maxAge}` }
      : { "cache-control": "no-cache, no-store, must-revalidate" },
  });
}

async function cached(
  request: Request,
  ctx: ExecutionContext,
  maxAge: number,
  create: () => Promise<Response>,
): Promise<Response> {
  const cache = (caches as CacheStorage & { readonly default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await create();
  if (response.ok) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

type Browser = Awaited<ReturnType<typeof puppeteer.launch>>;

function lazyBrowser(env: Env): {
  rssFallback: (url: string) => Promise<string>;
  close: () => Promise<void>;
} {
  let browserPromise: Promise<Browser> | undefined;
  let browser: Browser | undefined;
  return {
    async rssFallback(url) {
      browserPromise ??= puppeteer.launch(env.BROWSER).then((opened) => {
        browser = opened;
        return opened;
      });
      const opened = await browserPromise;
      const page = await opened.newPage();
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        if (!response?.ok()) {
          throw new Error(`browser news ${response?.status() ?? "unavailable"}`);
        }
        const xml = await response.text();
        if (looksLikeRss(xml)) return xml;
        const html = await page.content();
        if (looksLikeRss(html)) return html;
        throw new Error("browser news was not rss");
      } finally {
        await page.close();
      }
    },
    async close() {
      if (browser) await browser.close();
    },
  };
}

async function fetchNewsPool(env: Env): Promise<Headline[]> {
  const session = lazyBrowser(env);
  let headlines: Headline[];
  try {
    headlines = await fetchRssHeadlines(session.rssFallback);
  } finally {
    await session.close();
  }
  try {
    return await enrichArticleBodies(headlines);
  } catch (error) {
    console.error("Article body enrichment failed", error);
    return headlines;
  }
}

const inFlight = singleFlight<CachedHeadlines>();

function placeFor(request: Request): Place {
  const rawQuery = new URL(request.url).searchParams.get("place") ?? "";
  const q = sanitizeQuery(rawQuery);
  return getPlace(q) ?? resolvePlace(q);
}

function headlinesFor(
  env: Env,
  ctx: ExecutionContext,
  now: Date,
): Promise<CachedHeadlines> {
  return inFlight("ncr", () =>
    cachedHeadlines(env.NEWS, "ncr", now, () => fetchNewsPool(env), {
      revalidate: (refresh) => ctx.waitUntil(refresh),
    }),
  );
}

async function status(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const place = placeFor(request);
  const now = new Date();
  try {
    const cached = await headlinesFor(env, ctx, now);
    return json(
      statusFromHeadlines(cached.headlines, place, now, cached.fetchedAt),
      200,
    );
  } catch (error) {
    console.error("Current news load failed", error);
    return json({ ok: false, error: "could not load news right now" }, 502);
  }
}

async function history(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const place = placeFor(request);
  const now = new Date();
  try {
    const cached = await headlinesFor(env, ctx, now);
    return json(
      weeklyFromHeadlines(cached.headlines, place, now, cached.fetchedAt),
      200,
    );
  } catch (error) {
    console.error("Weekly news load failed", error);
    return json(
      { ok: false, error: "could not load weekly news right now" },
      502,
    );
  }
}

async function geo(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (!isValidCoordinate(lat, lon)) {
    return json(
      { ok: false, error: "need valid lat and lon coordinates" },
      400,
    );
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat!)}&lon=${encodeURIComponent(lon!)}&format=jsonv2&zoom=14`,
    {
      headers: {
        "User-Agent": "MayPasokBa/1.0 (personal class-suspension checker)",
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    return json({ ok: false, error: "hindi makuha ang location" }, 502);
  }

  const body = (await response.json()) as Nominatim;
  if (!body.address) return json({ ok: false, error: "walang address" }, 404);

  const place = matchGeo(body.address);
  return place
    ? json({ ok: true, place }, 200, 86400)
    : json({ ok: false, error: "hindi makita ang lungsod" }, 404);
}

async function warmNews(env: Env): Promise<string[]> {
  const headlines = await fetchNewsPool(env);
  await putHeadlines(env.NEWS, "ncr", headlines, new Date());
  return ["ncr"];
}

async function api(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse();
  }
  if (request.method !== "GET") return json({ ok: false }, 405);

  const url = new URL(request.url);

  if (url.pathname === "/api/status") {
    return status(request, env, ctx);
  }
  if (url.pathname === "/api/history") {
    return history(request, env, ctx);
  }
  if (url.pathname === "/api/geo") {
    return cached(request, ctx, 86400, () => geo(request));
  }
  if (url.pathname === "/api/cron") {
    if (
      !isCronAuthorized(
        request.headers.get("authorization"),
        env.CRON_SECRET,
        true,
      )
    ) {
      return json({ ok: false }, 401);
    }
    const warmed = await warmNews(env);
    return json({ ok: true, warmed, at: new Date().toISOString() });
  }

  return json({ ok: false, error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const isApi = new URL(request.url).pathname.startsWith("/api/");
    const response = isApi
      ? await api(request, env, ctx)
      : await env.ASSETS.fetch(request);
    return applySecurityHeaders(response, isApi);
  },

  async scheduled(_event, env) {
    await warmNews(env);
  },
} satisfies ExportedHandler<Env>;
