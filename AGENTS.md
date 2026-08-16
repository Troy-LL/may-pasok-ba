<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# May Pasok Ba?

WALA or MERON for classes, work, and government from Google News RSS — not an official LGU or DepEd feed.

Intent: a cold clone on Node 22+ can `npm install`, `npm test`, and `npm run dev` at http://localhost:3000, and this map (not the Next.js stub alone) is what agents load.

## Load

This file + at most 2. Skip unused.

- Run, cron secret, deploy: `README.md`
- Verdict rules (WALA/MERON, kinds, freshness): `lib/classify.ts`
- RSS query, allowlist, Browser Rendering fallback, `scoreHeadlines`: `lib/news.ts`
- Google link resolution, publisher body extractors, locality snippets: `lib/articles.ts`
- LGU list, picker, Nominatim match: `lib/places.ts`
- Board UI: `components/board.tsx`
- Static assets, JSON APIs, edge cache, daily warm, geocode: `custom-worker.ts`
- Cloudflare domain, Browser Rendering binding, cron: `wrangler.jsonc`

## Commands

Node 22+ (`npm test` is `--experimental-strip-types` only — do not add `--experimental-default-type`; Node 24 rejects it).

```bash
npm install
npm test
npm run dev
```

http://localhost:3000 — health is the page, or `GET /api/status?place=quezon-city`. Manual cron calls require `CRON_SECRET`.

Keep the Next.js block at the top of this file. `next dev` re-adds it.

Do not invent headlines. Do not hand-edit `data/places-*.json` unless adding a real LGU; keep the three shards.

Park thinking in `scratch/`. Do not map it. Do not commit it.
