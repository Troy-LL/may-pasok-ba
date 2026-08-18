# May Pasok Ba?

The page answers **WALA** or **MERON** for classes, work, and government offices in a Philippine city or municipality.

It reads public Google News RSS via a shared headline pool built from keyword-split queries, then scores only **allowlisted Philippine outlets** (GMA, Inquirer, Rappler, Philstar, SunStar, ABS-CBN, Manila Bulletin, and similar). Random blogs are ignored. For the newest relevant Google links, especially dated roundups, it first tries a regex decode of Google's `data-n-a-sg` / `data-n-a-ts` params. If Cloudflare's fetch gets a Google interstitial without those attributes, Browser Rendering opens one dated Google article page to read the params, then the publisher body is fetched without a browser tab. The first request after a miss waits for that body instead of returning MERON while a background tab is killed. If the publisher page omits the usual article markup, the Open Graph description is used. A Palace order covering **NCR / Metro Manila** updates every NCR city, not only places named in a later LGU list.

Cloudflare first requests the feed directly. HTML block pages and empty bodies are not treated as a feed. Because Google can reject data-center IPs with HTTP 503, production falls back to Cloudflare Browser Rendering for the RSS XML, then RSS2JSON as a last resort; fallback results are headline-only. Article bodies are read from publisher pages without opening a browser tab per story. Headlines are cached in Cloudflare Workers KV with stale-while-revalidate.

Not an official LGU or DepEd feed. It does not scrape Facebook. If the mayor posted only on Facebook, this can still be wrong. Check the **why?** links.

## How it decides

- **WALA** if an allowlisted headline or supported article body names your place (or NCR / Luzon / nationwide) and talks about a suspension **for today**, or **for tomorrow** when outlets posted early. A roundup titled August 19 still counts on the evening of August 18. Named dates for yesterday drop off the big letters after midnight. Undated posts from last night still count at 5:00 AM.
- **MERON** if it finds nothing like that — **no matching news, not an official all-clear**.
- One outlet → WALA with `1 outlet`. Two or more distinct outlets for the same kind → `2 outlets` (confirmed).
- Classes, work, and government are scored separately. `walang pasok` alone is classes. Work and government need those words too.
- News is cached for **20 minutes** on demand; cron still busts the cache every 2 hours, including 5:00 AM Manila.
- The 7-day summary uses the suspension date written in a roundup title, falling back to its Manila publication date. It is news evidence, not a stored official attendance record; MERON still means no matching evidence.
- Inquirer, SunStar, and News5/TV5 remain headline-only. News5 currently blocks server-side page fetches with HTTP 403.

## Place

Type an NCR city or municipality, **Metro Manila** / NCR, or use the browser location (NCR only). Location goes through OpenStreetMap Nominatim. Metro Manila is the region, not Caloocan — a Caloocan-only headline does not flip the whole NCR.

## Scheduled checks

On Cloudflare Workers, Cron Triggers warm the shared NCR news pool every 2 hours, plus **21:00 UTC** (5:00 AM in Manila). Requests are cached in KV for 7 days with background revalidation. The "As of" time is when headlines were fetched, not when the page was opened.

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
Wrangler configuration owns the custom domain and Cron Triggers.
