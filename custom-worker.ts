import puppeteer from "@cloudflare/puppeteer";
import {
  fetchHeadlines,
  statusFromHeadlines,
  weeklyFromHeadlines,
  NEWS_QUERIES,
} from "./lib/news.ts";
import {
  getPlace,
  matchGeo,
  resolvePlace,
} from "./lib/places.ts";
import { isCronAuthorized } from "./lib/cron.ts";
import { cachedHeadlines, putHeadlines, singleFlight } from "./lib/store.ts";
import {
  applySecurityHeaders,
  corsPreflightResponse,
  isValidCoordinate,
  sanitizeQuery,
} from "./lib/security.ts";
import type { Headline } from "./lib/rss.ts";
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

async function browserPageRss(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!response?.ok()) {
      throw new Error(`browser news ${response?.status() ?? "unavailable"}`);
    }
    return await page.content();
  } finally {
    await page.close();
  }
}

async function fetchHeadlinesWithBrowser(env: Env): Promise<Headline[]> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    return await fetchHeadlines(
      (rssUrl) => browserPageRss(browser, rssUrl),
      NEWS_QUERIES,
      async (googleUrl) => {
        const page = await browser.newPage();
        try {
          await page.goto(googleUrl, {
            waitUntil: "load",
            timeout: 15_000,
          });
          let url = page.url();
          if (url.includes("news.google.com")) {
            try {
              await page.waitForFunction(
                () => !window.location.hostname.includes("news.google.com"),
                { timeout: 5000 },
              );
              url = page.url();
            } catch {
              // Redirect did not trigger within 5s
            }
          }
          if (!url.includes("news.google.com")) {
            const html = await page.content();
            return { url, html };
          }
          return undefined;
        } catch {
          return undefined;
        } finally {
          await page.close();
        }
      },
    );
  } finally {
    await browser.close();
  }
}

const inFlight = singleFlight<Headline[]>();

function placeFor(request: Request): Place {
  const rawQuery = new URL(request.url).searchParams.get("place") ?? "";
  const q = sanitizeQuery(rawQuery);
  return getPlace(q) ?? resolvePlace(q);
}

function headlinesFor(
  env: Env,
  ctx: ExecutionContext,
  now: Date,
): Promise<Headline[]> {
  return inFlight("ncr", () =>
    cachedHeadlines(
      env.NEWS,
      "ncr",
      now,
      () => fetchHeadlinesWithBrowser(env),
      { revalidate: (refresh) => ctx.waitUntil(refresh) },
    ),
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
    const headlines = await headlinesFor(env, ctx, now);
    return json(statusFromHeadlines(headlines, place, now), 200);
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
    const headlines = await headlinesFor(env, ctx, now);
    return json(weeklyFromHeadlines(headlines, place, now), 200);
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
  const headlines = await fetchHeadlinesWithBrowser(env);
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

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(warmNews(env));
  },
} satisfies ExportedHandler<Env>;
