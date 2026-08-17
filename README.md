# May Pasok Ba?

The page answers **WALA** or **MERON** for classes, work, and government offices in a Philippine city or municipality.

It reads public Google News RSS via a shared headline pool built from keyword-split queries, then scores only **allowlisted Philippine outlets** (GMA, Inquirer, Rappler, Philstar, SunStar, ABS-CBN, Manila Bulletin, and similar). Random blogs are ignored. For the first 10 relevant results, it resolves the publisher link and reads the article body from GMA, ABS-CBN, Manila Bulletin, Rappler, and Philstar using source-specific extractors.

Cloudflare first requests the feed directly. Because Google can reject data-center IPs with HTTP 503, production falls back to Cloudflare Browser Rendering, then RSS2JSON as a last resort; fallback results are headline-only. Headlines are cached in Cloudflare Workers KV with stale-while-revalidate and per-colo edge caching.

Not an official LGU or DepEd feed. It does not scrape Facebook. If the mayor posted only on Facebook, this can still be wrong. Check the **why?** links.

## How it decides

- **WALA** if an allowlisted headline or supported article body from the last 36 hours names your place (or explicitly applies across NCR / Luzon / nationwide) and talks about a suspension.
- **MERON** if it finds nothing like that — **no matching news, not an official all-clear**.
- One outlet → WALA with `1 outlet`. Two or more distinct outlets for the same kind → `2 outlets` (confirmed).
- Classes, work, and government are scored separately. `walang pasok` alone is classes. Work and government need those words too.
- News is cached for **20 minutes** on demand; the 5:00 AM cron still busts the cache.
- The 7-day summary uses the suspension date written in a roundup title, falling back to its Manila publication date. It is news evidence, not a stored official attendance record; MERON still means no matching evidence.
- Inquirer, SunStar, and News5/TV5 remain headline-only. News5 currently blocks server-side page fetches with HTTP 403.

## Place

Type an NCR city or municipality, **Metro Manila** / NCR, or use the browser location (NCR only). Location goes through OpenStreetMap Nominatim. Metro Manila is the region, not Caloocan — a Caloocan-only headline does not flip the whole NCR.

## Daily 5:00 AM check

On Cloudflare Workers, a Cron Trigger runs at **21:00 UTC** (5:00 AM in Manila) and warms the shared NCR news pool in Workers KV. Requests are cached in KV for 7 days with background revalidation and at the edge for 20 minutes.

`CRON_SECRET` protects manual calls to `/api/cron`; the native Cron Trigger does not need it.

## Run

Node **22+**. `npm test` uses `--experimental-strip-types` (not `--experimental-default-type` — Node 24 rejects that flag). Commit `package-lock.json`. No local env file. Cron auth is skipped when `CRON_SECRET` is unset.

```bash
npm install
npm test
npm run dev
```

Open http://localhost:3000. Smoke: `GET /api/status?place=quezon-city` should return JSON with `ok`, `verdicts`, and `confidence`. `GET /api/history?place=quezon-city` returns seven days of news evidence.

## Deploy

The static Next.js export and lightweight JSON API deploy to Cloudflare Workers at
`https://may-pasok-ba.niched.tech`.

```bash
npx wrangler login
npx wrangler secret put CRON_SECRET
npm run deploy
```

Use `npm run preview` to test the production Worker runtime locally. The
Wrangler configuration owns the custom domain and the daily Cron Trigger.
