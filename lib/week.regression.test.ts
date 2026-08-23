import assert from "node:assert/strict"
import test from "node:test"
import type { Headline } from "./rss.ts"
import { scoreHeadlines, statusFromHeadlines, summarizeWeek } from "./news.ts"
import { getPlace } from "./places.ts"

const NOW = new Date("2026-08-22T22:00:00Z")

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function h(title: string, source: string, iso: string, body?: string): Headline {
  return {
    title,
    link: `https://example.com/${slugify(title)}`,
    source,
    publishedAt: new Date(iso),
    ...(body ? { body } : {}),
  }
}

function must(id: string) {
  const found = getPlace(id)
  if (!found) throw new Error(`missing place ${id}`)
  return found
}

test("R1 source names never imply places", () => {
  const manila = must("manila")
  for (const item of [
    h(
      "Classes suspended in Zamboanga City due to high heat index",
      "Manila Bulletin",
      "2026-08-17T04:04:46Z",
    ),
    h(
      "Time to review LGU class suspension protocols",
      "The Manila Times",
      "2026-08-20T16:02:00Z",
    ),
  ]) {
    const scored = scoreHeadlines([item], manila, NOW)
    assert.equal(scored.headlines.length, 0, item.title)
    assert.deepEqual(scored.verdicts, {
      classes: "MERON",
      work: "MERON",
      government: "MERON",
    })
  }
})

test("R2 meta and retrospective headlines never flag", () => {
  const qc = must("quezon-city")
  const caloocan = must("caloocan")
  const mayor = scoreHeadlines(
    [
      h(
        "QC mayor vows to do better after class suspension delays",
        "The Manila Times",
        "2026-08-22T16:04:00Z",
      ),
    ],
    qc,
    NOW,
  )
  assert.equal(mayor.headlines.length, 0)
  assert.equal(mayor.verdicts.classes, "MERON")

  const ust = h(
    "UST student councils slam delayed class suspension amid flooding",
    "Manila Bulletin",
    "2026-08-22T02:00:00Z",
    "University of Santo Tomas student councils criticized the delayed announcement. The Metro Manila suspension came hours after classes had started.",
  )
  for (const item of [
    h(
      "Belmonte orders review of class suspension protocols",
      "Philstar.com",
      "2026-08-22T10:00:00Z",
    ),
    h(
      "DepEd seeks changes to class suspension rules to allow safe schools to reopen",
      "Philstar Life",
      "2026-08-21T22:00:00Z",
    ),
    ust,
  ]) {
    const scored = scoreHeadlines([item], qc, NOW)
    assert.equal(scored.headlines.length, 0, item.title)
    assert.deepEqual(
      scored.verdicts,
      { classes: "MERON", work: "MERON", government: "MERON" },
      item.title,
    )
  }

  const ustInCaloocan = scoreHeadlines([ust], caloocan, NOW)
  assert.equal(ustInCaloocan.verdicts.government, "MERON")
  assert.equal(ustInCaloocan.confidence.government, "none")
})

test("R3 holiday pay idiom does not flag work", () => {
  const items = [
    h(
      "DOLE: 'No work, no pay' applies on Ninoy Aquino Day",
      "SunStar Publishing Inc.",
      "2026-08-20T07:03:12Z",
    ),
    h(
      "Do absent senators get paid? Gatchalian says 'no work, no pay' bill now pending",
      "ABS-CBN",
      "2026-08-20T08:02:00Z",
    ),
  ]
  for (const id of ["metro-manila", "quezon-city", "manila", "caloocan"]) {
    const place = must(id)
    const days = summarizeWeek(items, place, NOW)
    for (const day of days) {
      assert.equal(day.verdicts.work, "MERON", `${place.id} ${day.date}`)
    }
    const named = days.find((day) => day.date === "2026-08-20")
    if (!named) throw new Error("missing day 2026-08-20")
    assert.equal(named.verdicts.work, "MERON")
  }
})

test("R4 alternative setup language flags work government and classes", () => {
  const mm = must("metro-manila")

  const arrangements = summarizeWeek(
    [
      h(
        "Government offices in NCR, 12 provinces shift to alternative work arrangements due to heavy rain",
        "ABS-CBN",
        "2026-08-18T04:12:37Z",
      ),
    ],
    mm,
    NOW,
  )
  const arrangementsDay = arrangements.find((day) => day.date === "2026-08-18")
  if (!arrangementsDay) throw new Error("missing day 2026-08-18")
  assert.equal(arrangementsDay.verdicts.classes, "MERON")
  assert.equal(arrangementsDay.verdicts.work, "WALA")
  assert.equal(arrangementsDay.verdicts.government, "WALA")
  assert.notEqual(arrangementsDay.confidence.work, "none")
  assert.notEqual(arrangementsDay.confidence.government, "none")

  const palace = summarizeWeek(
    [
      h(
        "Palace orders alternative work setup in 18 areas amid habagat rains",
        "Inquirer.net",
        "2026-08-18T11:36:00Z",
      ),
    ],
    mm,
    NOW,
  )
  const palaceDay = palace.find((day) => day.date === "2026-08-18")
  if (!palaceDay) throw new Error("missing day 2026-08-18")
  assert.equal(palaceDay.verdicts.work, "WALA")
  assert.equal(palaceDay.verdicts.government, "WALA")

  const malacanang = summarizeWeek(
    [
      h(
        "Malacañang orders gov't offices, schools to shift to alternative setup on Aug. 20",
        "GMA Network",
        "2026-08-19T10:16:01Z",
        "Malacañang ordered government offices and schools in Metro Manila to shift to alternative work and learning setups Thursday.",
      ),
    ],
    mm,
    NOW,
  )
  const malacanangDay = malacanang.find((day) => day.date === "2026-08-20")
  if (!malacanangDay) throw new Error("missing day 2026-08-20")
  assert.notEqual(malacanangDay.confidence.classes, "none")
  assert.notEqual(malacanangDay.confidence.government, "none")
  assert.equal(malacanangDay.verdicts.classes, "WALA")
  assert.equal(malacanangDay.verdicts.government, "WALA")

  const roundup = h(
    "#WalangPasok: Work, class suspensions for August 18, 2026 due to habagat rains, floods",
    "ABS-CBN",
    "2026-08-17T09:10:17Z",
    "Work and class suspensions were declared Tuesday in Metro Manila, Cavite, and Batangas.",
  )
  for (const id of ["metro-manila", "caloocan"]) {
    const days = summarizeWeek([roundup], must(id), NOW)
    const roundupDay = days.find((day) => day.date === "2026-08-18")
    if (!roundupDay) throw new Error(`missing day 2026-08-18 for ${id}`)
    assert.equal(roundupDay.verdicts.classes, "WALA", id)
    assert.equal(roundupDay.verdicts.work, "WALA", id)
  }
})

test("R5 year less roundup dates resolve to announced day", () => {
  const manila = must("manila")
  const days = summarizeWeek(
    [
      h(
        "Walang Pasok: Class suspensions for August 17 due to habagat",
        "Philstar.com",
        "2026-08-16T09:40:00Z",
        "Suspended Monday: Manila, Valenzuela, Caloocan, Pasay in Metro Manila.",
      ),
    ],
    manila,
    NOW,
  )
  assert.equal(days.length, 7)
  assert.equal(days[0].date, "2026-08-23")
  assert.equal(days[days.length - 1].date, "2026-08-17")
  assert.equal(days.find((day) => day.date === "2026-08-16"), undefined)
  const aug17 = days.find((day) => day.date === "2026-08-17")
  if (!aug17) throw new Error("missing day 2026-08-17")
  assert.equal(aug17.verdicts.classes, "WALA")
})

test("R6 expanded allowlist sources are scored", () => {
  const mm = must("metro-manila")
  const days = summarizeWeek(
    [
      h(
        "Govt work, classes suspended in NCR, 12 provinces from 12 noon due to habagat",
        "Malaya Business Insight",
        "2026-08-17T03:56:51Z",
      ),
    ],
    mm,
    NOW,
  )
  const aug17 = days.find((day) => day.date === "2026-08-17")
  if (!aug17) throw new Error("missing day 2026-08-17")
  assert.deepEqual(aug17.verdicts, {
    classes: "WALA",
    work: "WALA",
    government: "WALA",
  })

  const pna = scoreHeadlines(
    [
      h(
        "Classes suspended in NCR due to habagat rains",
        "Philippine News Agency",
        "2026-08-22T09:00:00Z",
      ),
    ],
    mm,
    NOW,
  )
  assert.ok(pna.headlines.length >= 1)
  assert.equal(pna.verdicts.classes, "WALA")

  const dzrh = scoreHeadlines(
    [h("Walang pasok sa NCR dahil sa bagyo", "DZRH", "2026-08-22T10:00:00Z")],
    mm,
    NOW,
  )
  assert.ok(dzrh.headlines.length >= 1)
  assert.equal(dzrh.verdicts.classes, "WALA")

  const tribune = scoreHeadlines(
    [
      h(
        "NCR classes suspended anew due to continuous rain",
        "Daily Tribune",
        "2026-08-22T11:00:00Z",
      ),
    ],
    mm,
    NOW,
  )
  assert.ok(tribune.headlines.length >= 1)
  assert.equal(tribune.verdicts.classes, "WALA")
})

test("R7 body evidence widens kinds the title omits", () => {
  const qc = must("quezon-city")
  const days = summarizeWeek(
    [
      h(
        "Walang pasok: Class, work suspensions on Aug. 18 due to monsoon rain",
        "Inquirer.net",
        "2026-08-17T07:09:00Z",
        "The Quezon City government suspended work in government offices only; private offices remain open.",
      ),
    ],
    qc,
    NOW,
  )
  const aug18 = days.find((day) => day.date === "2026-08-18")
  if (!aug18) throw new Error("missing day 2026-08-18")
  assert.equal(aug18.verdicts.classes, "WALA")
  assert.equal(aug18.verdicts.work, "WALA")
  assert.equal(aug18.verdicts.government, "WALA")
  assert.equal(aug18.confidence.government, "reported")
})

test("R8 stale headline stays out of today verdicts", () => {
  const mm = must("metro-manila")
  const item = h(
    "Malacañang orders gov't offices, schools to shift to alternative setup on Aug. 20",
    "GMA Network",
    "2026-08-19T10:16:01Z",
    "Malacañang ordered government offices and schools in Metro Manila to shift to alternative work and learning setups Thursday.",
  )
  const status = statusFromHeadlines([item], mm, NOW)
  assert.equal(status.headlines.length, 0)

  const aug20 = status.days.find((day) => day.date === "2026-08-20")
  if (!aug20) throw new Error("missing day 2026-08-20")
  assert.equal(aug20.verdicts.classes, "WALA")
  assert.equal(aug20.verdicts.government, "WALA")
})
