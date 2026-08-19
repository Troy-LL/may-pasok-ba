import { isFresh } from "./classify.ts";
import type { Headline } from "./rss.ts";

export const MAX_RANGE_DAYS = 8;
export const ACTIONABLE_MS = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
const FUTURE_SLOP_MS = 5 * 60 * 1000;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  enero: 1,
  feb: 2,
  february: 2,
  pebrero: 2,
  mar: 3,
  march: 3,
  marso: 3,
  apr: 4,
  april: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  hunyo: 6,
  jul: 7,
  july: 7,
  hulyo: 7,
  aug: 8,
  august: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  setyembre: 9,
  setiembre: 9,
  oct: 10,
  october: 10,
  oktubre: 10,
  nov: 11,
  november: 11,
  nobyembre: 11,
  dec: 12,
  december: 12,
  disyembre: 12,
};

const MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|set(?:y|i)embre|oktubre|nobyembre|disyembre";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4}))?";
const RANGE_SEP = "(?:[-–—]|to|through|thru|until|hanggang)";

const FROM_TO = new RegExp(
  `\\b(?:from|starting|effective|mula)\\s+(${MONTH})\\.?\\s+${DAY}${YEAR}\\s+${RANGE_SEP}\\s+(?:(${MONTH})\\.?\\s+)?${DAY}${YEAR}\\b`,
  "gi",
);
const RANGE = new RegExp(
  `\\b(${MONTH})\\.?\\s+${DAY}\\s*${RANGE_SEP}\\s*(?:(${MONTH})\\.?\\s+)?${DAY}${YEAR}\\b`,
  "gi",
);
const DAY_TOKEN = "\\d{1,2}(?:st|nd|rd|th)?";
const DAY_LIST = new RegExp(
  `\\b(${MONTH})\\.?\\s+(${DAY_TOKEN}(?:\\s*,\\s*${DAY_TOKEN})+(?:\\s*,?\\s*(?:and|&)\\s*${DAY_TOKEN})?)${YEAR}\\b`,
  "gi",
);
const AND_DAYS = new RegExp(
  `\\b(${MONTH})\\.?\\s+${DAY}\\s+and\\s+${DAY}(?!\\s+other)${YEAR}\\b`,
  "gi",
);
const UNTIL = new RegExp(
  `\\b(?:until|thru|through|hanggang)\\s+(${MONTH})\\.?\\s+${DAY}${YEAR}\\b`,
  "gi",
);
const MONTH_DAY_YEAR = new RegExp(
  `\\b(${MONTH})\\.?\\s+${DAY},?\\s+(\\d{4})\\b`,
  "gi",
);
const MONTH_DAY = new RegExp(`\\b(${MONTH})\\.?\\s+${DAY}\\b`, "gi");
const TOMORROW = /\b(?:tomorrow|bukas)\b/gi;
const NEXT_DAYS =
  /\b(?:(?:for|over)\s+the\s+next|for|next)\s+(\d+|two|three|four|five|six|seven)\s+days\b/gi;
const FURTHER_NOTICE =
  /until further\s+(?:notice|announcement|advisory|orders?)|until (?:it is )?lifted|indefinitely|hanggang sa (?:susunod|bagong)(?: na)? (?:anunsyo|abiso|order|utas)/i;
const WEEKDAY =
  /\b(?:this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|linggo|lunes|martes|miyerkules|myerkules|huwebes|biyernes|sabado)\b/gi;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  linggo: 0,
  monday: 1,
  lunes: 1,
  tuesday: 2,
  martes: 2,
  wednesday: 3,
  miyerkules: 3,
  myerkules: 3,
  thursday: 4,
  huwebes: 4,
  friday: 5,
  biyernes: 5,
  saturday: 6,
  sabado: 6,
};

const DAY_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

export function manilaYmd(date: Date): string | undefined {
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addCalendarDays(
  iso: string,
  days: number,
): string | undefined {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

export function weekDates(end: string): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    return addCalendarDays(end, -index) ?? end;
  });
}

function isoDate(
  year: number,
  month: number,
  day: number,
): string | undefined {
  if (!month || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(name: string): number {
  return MONTHS[name.toLowerCase()] ?? 0;
}

function resolveIso(
  monthName: string,
  day: number,
  year: number | undefined,
  published: string,
): string | undefined {
  const month = monthNumber(monthName);
  const fallbackYear = Number(published.slice(0, 4));
  let iso = isoDate(year ?? fallbackYear, month, day);
  if (!iso) return undefined;
  const earliest = addCalendarDays(published, -30);
  if (year === undefined && earliest && iso < earliest) {
    iso = isoDate(fallbackYear + 1, month, day) ?? iso;
  }
  return iso;
}

export function enumerateRange(
  start: string,
  end: string,
  maxDays = MAX_RANGE_DAYS,
): string[] {
  let from = start;
  let to = end;
  if (from > to) [from, to] = [to, from];
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; i < maxDays; i += 1) {
    out.push(cursor);
    if (cursor === to) break;
    const next = addCalendarDays(cursor, 1);
    if (!next) break;
    cursor = next;
  }
  return out;
}

function spansOverlap(
  consumed: [number, number][],
  start: number,
  end: number,
): boolean {
  return consumed.some(([from, to]) => start < to && end > from);
}

function yearFrom(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const year = Number(raw);
  return Number.isFinite(year) ? year : undefined;
}

export function parseCoverageDates(
  text: string,
  publishedAt: Date,
): string[] {
  const published = manilaYmd(publishedAt);
  if (!published) return [];
  const dates = new Set<string>();
  const consumed: [number, number][] = [];

  const take = (iso: string | undefined) => {
    if (iso) dates.add(iso);
  };
  const takeRange = (start?: string, end?: string) => {
    if (!start) return;
    for (const day of enumerateRange(start, end ?? start)) take(day);
  };

  const walk = (
    pattern: RegExp,
    onMatch: (match: RegExpExecArray) => boolean,
  ) => {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (!spansOverlap(consumed, start, end) && onMatch(match)) {
        consumed.push([start, end]);
      }
      match = pattern.exec(text);
    }
  };

  walk(FROM_TO, (match) => {
    const start = resolveIso(
      match[1],
      Number(match[2]),
      yearFrom(match[3]),
      published,
    );
    const end = resolveIso(
      match[4] ?? match[1],
      Number(match[5]),
      yearFrom(match[6]) ?? yearFrom(match[3]),
      published,
    );
    if (!start || !end) return false;
    takeRange(start, end);
    return true;
  });

  walk(RANGE, (match) => {
    const start = resolveIso(
      match[1],
      Number(match[2]),
      yearFrom(match[5]),
      published,
    );
    const end = resolveIso(
      match[3] ?? match[1],
      Number(match[4]),
      yearFrom(match[5]),
      published,
    );
    if (!start || !end) return false;
    takeRange(start, end);
    return true;
  });

  walk(DAY_LIST, (match) => {
    const year = yearFrom(match[3]);
    const days = [...match[2].matchAll(/\d{1,2}/g)]
      .map((part) => Number(part[0]))
      .filter((day) => day >= 1 && day <= 31);
    if (days.length < 2) return false;
    for (const day of days) {
      take(resolveIso(match[1], day, year, published));
    }
    return true;
  });

  walk(AND_DAYS, (match) => {
    const year = yearFrom(match[4]);
    const first = resolveIso(match[1], Number(match[2]), year, published);
    const second = resolveIso(match[1], Number(match[3]), year, published);
    if (!first || !second) return false;
    take(first);
    take(second);
    return true;
  });

  walk(UNTIL, (match) => {
    const end = resolveIso(
      match[1],
      Number(match[2]),
      yearFrom(match[3]),
      published,
    );
    if (!end) return false;
    if (end < addCalendarDays(published, -1)!) return false;
    takeRange(published, end);
    return true;
  });

  walk(MONTH_DAY_YEAR, (match) => {
    const iso = resolveIso(
      match[1],
      Number(match[2]),
      Number(match[3]),
      published,
    );
    if (!iso) return false;
    take(iso);
    return true;
  });

  walk(MONTH_DAY, (match) => {
    const iso = resolveIso(match[1], Number(match[2]), undefined, published);
    if (!iso) return false;
    take(iso);
    return true;
  });

  walk(TOMORROW, () => {
    const iso = addCalendarDays(published, 1);
    if (!iso) return false;
    take(iso);
    return true;
  });

  walk(NEXT_DAYS, (match) => {
    const raw = match[1].toLowerCase();
    const count = DAY_WORDS[raw] ?? Number(raw);
    if (!Number.isFinite(count) || count < 2 || count > MAX_RANGE_DAYS) {
      return false;
    }
    const end = addCalendarDays(published, count - 1);
    takeRange(published, end);
    return true;
  });

  if (FURTHER_NOTICE.test(text)) {
    takeRange(published, addCalendarDays(published, MAX_RANGE_DAYS - 1));
  }

  if (dates.size === 0) {
    walk(WEEKDAY, (match) => {
      const weekday = WEEKDAYS[match[1].toLowerCase()];
      if (weekday === undefined) return false;
      const [year, month, day] = published.split("-").map(Number);
      const publishedWeekday = new Date(
        Date.UTC(year, month - 1, day),
      ).getUTCDay();
      let delta = weekday - publishedWeekday;
      if (delta < -1) delta += 7;
      // Same-day or yesterday weekday names stay undated so last-night posts
      // still count at 5:00 AM. Future weekdays are early cancellations.
      if (delta < 1) return false;
      take(addCalendarDays(published, delta));
      return true;
    });
  }

  return [...dates].sort();
}

export function datesCoveredByHeadline(headline: Headline): string[] {
  const published = manilaYmd(headline.publishedAt);
  if (!published) return [];
  const text = `${headline.title}\n${headline.body?.slice(0, 1500) ?? ""}`;
  const parsed = parseCoverageDates(text, headline.publishedAt);
  return parsed.length > 0 ? parsed : [published];
}

function withinActionableWindow(publishedAt: Date, now: Date): boolean {
  const age = now.getTime() - publishedAt.getTime();
  return age >= -FUTURE_SLOP_MS && age <= ACTIONABLE_MS;
}

export function headlineAppliesOn(
  headline: Headline,
  date: string,
  now: Date,
): boolean {
  const published = manilaYmd(headline.publishedAt);
  if (!published) return false;
  const text = `${headline.title}\n${headline.body?.slice(0, 1500) ?? ""}`;
  const explicit = parseCoverageDates(text, headline.publishedAt);
  const dates = explicit.length > 0 ? explicit : [published];
  if (dates.includes(date)) {
    return explicit.length > 0
      ? withinActionableWindow(headline.publishedAt, now)
      : isFresh(headline.publishedAt, now);
  }
  if (explicit.length > 0) return false;
  if (!isFresh(headline.publishedAt, now)) return false;
  const today = manilaYmd(now);
  return date === today && published === addCalendarDays(today ?? "", -1);
}

export function relevantBoardDate(
  headlines: Headline[],
  now: Date,
): string | undefined {
  const today = manilaYmd(now);
  if (!today) return undefined;
  const tomorrow = addCalendarDays(today, 1);
  if (headlines.some((headline) => headlineAppliesOn(headline, today, now))) {
    return today;
  }
  if (
    tomorrow &&
    headlines.some((headline) => headlineAppliesOn(headline, tomorrow, now))
  ) {
    return tomorrow;
  }
  return today;
}

export function isCurrentHeadline(
  headline: Headline,
  now: Date,
  boardDate?: string,
): boolean {
  const day = boardDate ?? manilaYmd(now);
  if (!day) return false;
  return headlineAppliesOn(headline, day, now);
}

export function headlineCoversDate(
  headline: Headline,
  date: string,
): boolean {
  return datesCoveredByHeadline(headline).includes(date);
}
