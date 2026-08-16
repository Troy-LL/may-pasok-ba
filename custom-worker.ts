import puppeteer from "@cloudflare/puppeteer";
import { getStatus, getWeeklySummary } from "./lib/news.ts";
import {
  WARM_PLACE_IDS,
  getPlace,
  matchGeo,
  resolvePlace,
} from "./lib/places.ts";
import { isCronAuthorized } from "./lib/cron.ts";

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
      : undefined,
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

async function browserRss(env: Env, url: string): Promise<string> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    return await browserPageRss(browser, url);
  } finally {
    await browser.close();
  }
}

async function statusWithEnv(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("place") ?? "";
  const result = await getStatus(
    getPlace(q) ?? resolvePlace(q),
    new Date(),
    (rssUrl) => browserRss(env, rssUrl),
  );
  return json(result, result.ok ? 200 : 502, 1200);
}

async function history(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("place") ?? "";
  const result = await getWeeklySummary(
    getPlace(q) ?? resolvePlace(q),
    new Date(),
    (rssUrl) => browserRss(env, rssUrl),
  );
  return json(result, result.ok ? 200 : 502, 1200);
}

async function geo(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (!lat || !lon) return json({ ok: false, error: "need lat and lon" }, 400);

  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=jsonv2&zoom=14`,
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
  const warmed: string[] = [];
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    for (const id of WARM_PLACE_IDS) {
      const place = getPlace(id);
      if (!place) continue;
      await getStatus(place, new Date(), (rssUrl) =>
        browserPageRss(browser, rssUrl),
      );
      warmed.push(id);
    }
  } finally {
    await browser.close();
  }
  return warmed;
}

async function api(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return json({ ok: false }, 405);

  if (url.pathname === "/api/status") {
    return cached(request, ctx, 1200, () => statusWithEnv(request, env));
  }
  if (url.pathname === "/api/history") {
    return cached(request, ctx, 1200, () => history(request, env));
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
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return api(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(warmNews(env));
  },
} satisfies ExportedHandler<Env>;
