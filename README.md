# May Pasok Ba?

The page answers **WALA** or **MERON** for classes, work, and government offices in a Philippine city or municipality.

It reads public Google News RSS for local outlets (GMA, Inquirer, Rappler, SunStar, and whoever else Google indexed that morning), then looks for suspension language tied to the place you picked.

Not an official LGU or DepEd feed. If the mayor posted only on Facebook and no paper picked it up, this can be wrong. Check the `bakit?` links.

## How it decides

- **WALA** if a headline from the last 36 hours names your place (or NCR / Luzon-wide / nationwide) and talks about a suspension.
- **MERON** if it finds nothing like that. No news is treated as a normal day.
- Classes, work, and government are scored separately. `walang pasok` alone is classes. Work and gobyerno need those words too.

## Place

Type any city or municipality, or use the browser location. Location goes through OpenStreetMap Nominatim, then a PSGC list of 1,634 LGUs.

## Daily 5:00 AM check

On Vercel, a cron hits `/api/cron` at **21:00 UTC** (5:00 AM in Manila). That busts the news cache and warms the big cities. Any other place is fetched on demand and cached for an hour.

Set `CRON_SECRET` in the Vercel project. Vercel sends it as `Authorization: Bearer …` on cron requests.

## Run

```bash
npm install
npm test
npm run dev
```

Open http://localhost:3000

## Deploy

Import [Troy-LL/may-pasok-ba](https://github.com/Troy-LL/may-pasok-ba) on Vercel, add `CRON_SECRET`, deploy. Cron only runs in production.
