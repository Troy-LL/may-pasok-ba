export type Kind = "classes" | "work" | "government";
export type Verdict = "WALA" | "MERON";
export type Island = "luzon" | "visayas" | "mindanao";

export type PlaceRef = {
  name: string;
  province: string;
  island: Island;
  ncr: boolean;
  aliases: string[];
};

export function fold(s: string): string {
  return s
    .replace(/ñ/gi, "n")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.]/g, "")
    .toLowerCase();
}

export function hasPhrase(haystack: string, needle: string): boolean {
  const n = fold(needle).trim();
  if (n.length < 2) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(
    fold(haystack),
  );
}

const NATIONWIDE =
  /nationwide|whole country|entire country|all over the philippines|sa buong bansa|buong pilipinas|buong bansa/;

const NCR =
  /metro manila|national capital region|(?:^|[^a-z0-9])ncr(?:$|[^a-z0-9])|kalakhang maynila/;

const ISLAND_WIDE: Record<Island, RegExp> = {
  luzon: /entire luzon|whole of luzon|all of luzon|luzon-wide|luzon wide|buong luzon/,
  visayas:
    /entire visayas|whole of visayas|all of visayas|visayas-wide|visayas wide|buong visayas/,
  mindanao:
    /entire mindanao|whole of mindanao|all of mindanao|mindanao-wide|mindanao wide|buong mindanao/,
};

const PROVINCE_WIDE =
  /entire|whole of|all of|province[- ]wide|whole province|lahat ng (?:mga )?(?:bayan|munisipyo|lungsod)|buong/;

const SUSPEND =
  /walang\s+pasok|suspensions?|suspended?|no\s+classes|no\s+work|cancel(?:led)?\s+class|call(?:ed)?\s+off/;

const LIFTED =
  /may\s+pasok|classes\s+resume|suspension\s+lifted|no\s+suspension|hindi\s+suspend/;

export function placeMentions(text: string, place: PlaceRef): boolean {
  const t = fold(text);
  if (NATIONWIDE.test(t)) return true;
  if (place.ncr && NCR.test(t)) return true;
  if (ISLAND_WIDE[place.island].test(t)) return true;

  const names = [place.name, ...place.aliases];
  if (names.some((n) => hasPhrase(text, n))) return true;

  if (
    hasPhrase(text, place.province) &&
    PROVINCE_WIDE.test(t) &&
    place.province !== "Philippines"
  ) {
    return true;
  }
  return false;
}

export function classifyHeadline(title: string): Record<Kind, boolean> {
  const t = fold(title);
  if (!SUSPEND.test(t)) {
    return { classes: false, work: false, government: false };
  }
  if (LIFTED.test(t) && !/walang\s+pasok/.test(t)) {
    return { classes: false, work: false, government: false };
  }

  const walangPasok = /walang\s+pasok/.test(t);
  const classes =
    walangPasok ||
    /class|klase|school|deped|face[- ]to[- ]face|all levels/.test(t);
  const work = /work|private\s+(?:office|sector)|trabaho|non-?essential/.test(t);
  const government =
    /government|gobyerno|(?:^|[^a-z0-9])lgu(?:$|[^a-z0-9])|gov(?:ernment)?\s+office|skeletal/.test(
      t,
    );

  return { classes, work, government };
}

export function verdictsFromFlags(flags: Record<Kind, boolean>): Record<
  Kind,
  Verdict
> {
  return {
    classes: flags.classes ? "WALA" : "MERON",
    work: flags.work ? "WALA" : "MERON",
    government: flags.government ? "WALA" : "MERON",
  };
}

export function isFresh(publishedAt: Date, now: Date): boolean {
  const age = now.getTime() - publishedAt.getTime();
  // ponytail: 36h window so last-night LGU posts still count at 5am
  return age >= -5 * 60 * 1000 && age <= 36 * 60 * 60 * 1000;
}
