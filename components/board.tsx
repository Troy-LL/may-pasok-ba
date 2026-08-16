"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import appIcon from "@/app/icon.png";
import type { Kind, Verdict } from "@/lib/classify";
import type { Confidence } from "@/lib/news";
import {
  DEFAULT_PLACE_ID,
  filterPlaces,
  getPlace,
  labelOf,
  resolvePlace,
  type Place,
} from "@/lib/places";

type HeadlineHit = { title: string; link: string; source: string };
type StatusResult =
  | {
      ok: true;
      verdicts: Record<Kind, Verdict>;
      confidence: Record<Kind, Confidence>;
      asOf: string;
      headlines: HeadlineHit[];
    }
  | { ok: false; error: string };

type WeeklyDay = {
  date: string;
  verdicts: Record<Kind, Verdict>;
};

type WeeklyResult =
  | { ok: true; days: WeeklyDay[] }
  | { ok: false; error: string };

function isConfidence(value: unknown): value is Confidence {
  return value === "none" || value === "reported" || value === "confirmed";
}

function isVerdict(value: unknown): value is Verdict {
  return value === "WALA" || value === "MERON";
}

function readStatus(value: unknown): StatusResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "could not load news right now" };
  }
  if ("ok" in value && value.ok === false) {
    const error =
      "error" in value && typeof value.error === "string"
        ? value.error
        : "could not load news right now";
    return { ok: false, error };
  }
  if (
    !("ok" in value) ||
    value.ok !== true ||
    !("verdicts" in value) ||
    !("headlines" in value) ||
    !("confidence" in value) ||
    !("asOf" in value)
  ) {
    return { ok: false, error: "could not load news right now" };
  }
  const { verdicts, headlines, confidence, asOf } = value;
  if (
    typeof verdicts !== "object" ||
    verdicts === null ||
    !Array.isArray(headlines) ||
    typeof confidence !== "object" ||
    confidence === null ||
    typeof asOf !== "string"
  ) {
    return { ok: false, error: "could not load news right now" };
  }
  const classes = "classes" in verdicts ? verdicts.classes : undefined;
  const work = "work" in verdicts ? verdicts.work : undefined;
  const government = "government" in verdicts ? verdicts.government : undefined;
  const classesConf = "classes" in confidence ? confidence.classes : undefined;
  const workConf = "work" in confidence ? confidence.work : undefined;
  const governmentConf =
    "government" in confidence ? confidence.government : undefined;
  if (
    !isVerdict(classes) ||
    !isVerdict(work) ||
    !isVerdict(government) ||
    !isConfidence(classesConf) ||
    !isConfidence(workConf) ||
    !isConfidence(governmentConf)
  ) {
    return { ok: false, error: "could not load news right now" };
  }
  const hits: HeadlineHit[] = [];
  for (const h of headlines) {
    if (typeof h !== "object" || h === null) continue;
    if (!("title" in h) || typeof h.title !== "string") continue;
    hits.push({
      title: h.title,
      link: "link" in h && typeof h.link === "string" ? h.link : "",
      source: "source" in h && typeof h.source === "string" ? h.source : "",
    });
  }
  return {
    ok: true,
    verdicts: { classes, work, government },
    confidence: {
      classes: classesConf,
      work: workConf,
      government: governmentConf,
    },
    asOf,
    headlines: hits,
  };
}

function readWeekly(value: unknown): WeeklyResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "could not load weekly news right now" };
  }
  if ("ok" in value && value.ok === false) {
    return {
      ok: false,
      error:
        "error" in value && typeof value.error === "string"
          ? value.error
          : "could not load weekly news right now",
    };
  }
  if (!("ok" in value) || value.ok !== true || !("days" in value)) {
    return { ok: false, error: "could not load weekly news right now" };
  }
  if (!Array.isArray(value.days)) {
    return { ok: false, error: "could not load weekly news right now" };
  }

  const days: WeeklyDay[] = [];
  for (const day of value.days) {
    if (
      typeof day !== "object" ||
      day === null ||
      !("date" in day) ||
      typeof day.date !== "string" ||
      !("verdicts" in day) ||
      typeof day.verdicts !== "object" ||
      day.verdicts === null
    ) {
      continue;
    }
    const classes =
      "classes" in day.verdicts ? day.verdicts.classes : undefined;
    const work = "work" in day.verdicts ? day.verdicts.work : undefined;
    const government =
      "government" in day.verdicts ? day.verdicts.government : undefined;
    if (
      isVerdict(classes) &&
      isVerdict(work) &&
      isVerdict(government)
    ) {
      days.push({
        date: day.date,
        verdicts: { classes, work, government },
      });
    }
  }

  return days.length === 7
    ? { ok: true, days }
    : { ok: false, error: "weekly news summary was incomplete" };
}

function readGeo(value: unknown): { ok: true; place: Place } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "hindi makuha ang location" };
  }
  if ("ok" in value && value.ok === false) {
    const error =
      "error" in value && typeof value.error === "string"
        ? value.error
        : "hindi makuha ang location";
    return { ok: false, error };
  }
  if (!("ok" in value) || value.ok !== true || !("place" in value) || typeof value.place !== "object" || value.place === null) {
    return { ok: false, error: "hindi makuha ang location" };
  }
  const { place } = value;
  if (
    !("id" in place) ||
    typeof place.id !== "string" ||
    !("name" in place) ||
    typeof place.name !== "string" ||
    !("province" in place) ||
    typeof place.province !== "string"
  ) {
    return { ok: false, error: "hindi makuha ang location" };
  }
  return { ok: true, place: getPlace(place.id) ?? resolvePlace(place.id) };
}

const KINDS: { id: Kind; label: string }[] = [
  { id: "classes", label: "classes" },
  { id: "work", label: "work" },
  { id: "government", label: "government" },
];

function confidenceCaption(confidence: Confidence): string {
  if (confidence === "confirmed") return "2 outlets";
  if (confidence === "reported") return "1 outlet";
  return "no matching news";
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function Board({ initialPlaceId }: { initialPlaceId?: string }) {
  const router = useRouter();
  const place =
    getPlace(initialPlaceId ?? DEFAULT_PLACE_ID) ??
    resolvePlace(initialPlaceId ?? "Quezon City");
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const query = typed ?? labelOf(place);
  const suggestions = useMemo(() => filterPlaces(typed ?? ""), [typed]);
  const [result, setResult] = useState<{
    id: string;
    status: StatusResult;
  } | null>(null);
  const [weeklyResult, setWeeklyResult] = useState<{
    id: string;
    status: WeeklyResult;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);

  function applyPlace(next: Place) {
    window.localStorage.setItem("wala-meron-place", next.id);
    setTyped(null);
    setLocNote(null);
    router.replace(`/?place=${encodeURIComponent(next.id)}`);
  }

  useEffect(() => {
    if (initialPlaceId) {
      window.localStorage.setItem("wala-meron-place", initialPlaceId);
      return;
    }
    const saved = window.localStorage.getItem("wala-meron-place");
    if (saved) {
      router.replace(`/?place=${encodeURIComponent(saved)}`);
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `/api/geo?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
          );
          const geo = readGeo(await res.json());
          if (geo.ok) applyPlace(geo.place);
        } catch {
          /* keep default city */
        }
      },
      () => {
        /* keep default city */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
    // applyPlace/router are used as navigation, not render state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlaceId, router]);

  useEffect(() => {
    const id = place.id;
    let cancelled = false;
    fetch(`/api/status?place=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body: unknown = await res.json();
        if (cancelled) return;
        setResult({ id, status: readStatus(body) });
        setWeeklyResult({ id, status: readWeekly(body) });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({
          id,
          status: { ok: false, error: "could not load news right now" },
        });
        setWeeklyResult({
          id,
          status: { ok: false, error: "could not load weekly news right now" },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [place.id]);

  async function locate() {
    if (!navigator.geolocation) {
      setLocNote("walang geolocation sa browser na ito");
      return;
    }
    setLocating(true);
    setLocNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `/api/geo?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
          );
          const geo = readGeo(await res.json());
          if (geo.ok) applyPlace(geo.place);
          else setLocNote(geo.error);
        } catch {
          setLocNote("hindi makuha ang location");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocNote("hindi pinayagan ang location");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }

  const status = result?.id === place.id ? result.status : null;
  const verdicts = status && status.ok ? status.verdicts : null;
  const confidence = status && status.ok ? status.confidence : null;
  const asOf = status && status.ok ? status.asOf : null;
  const weekly =
    weeklyResult?.id === place.id ? weeklyResult.status : null;
  const loading = status === null;

  return (
    <div className="flex min-h-full flex-1 flex-col px-4 py-6 sm:px-8 sm:py-10">
      <header className="mx-auto w-full max-w-5xl">
        <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight">
          <Image
            src={appIcon}
            alt=""
            width={36}
            height={36}
            className="rounded-lg"
            priority
          />
          May Pasok Ba?
        </h1>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Lungsod o bayan</span>
            <input
              role="combobox"
              aria-expanded={open}
              aria-controls="place-list"
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setTyped(e.target.value);
                setOpen(true);
              }}
              onFocus={(e) => {
                e.currentTarget.select();
                setOpen(true);
              }}
              onBlur={() => {
                setOpen(false);
                if (typed !== null) applyPlace(resolvePlace(typed));
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTyped(null);
                  setOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  setOpen(false);
                  applyPlace(resolvePlace(query));
                }
              }}
              placeholder="Metro Manila, NCR"
              className="w-full border-b-2 border-ink bg-transparent pb-2 text-2xl font-medium tracking-tight outline-none placeholder:text-ink/30 focus:border-red"
            />
            {open ? (
              <ul
                id="place-list"
                role="listbox"
                className="absolute z-10 mt-1 max-h-64 w-full overflow-auto border-2 border-ink bg-paper"
              >
                {suggestions.map((p) => (
                  <li key={p.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-base hover:bg-ink hover:text-paper"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpen(false);
                        applyPlace(p);
                      }}
                    >
                      {labelOf(p)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
          <button
            type="button"
            onClick={() => void locate()}
            className="shrink-0 border-2 border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper"
          >
            {locating ? "hinahanap…" : "gamitin ang location ko"}
          </button>
        </div>
        {locNote ? <p className="mt-2 text-sm text-ink/70">{locNote}</p> : null}
      </header>

      <main className="mx-auto mt-10 grid w-full max-w-5xl flex-1 grid-cols-1 gap-10 md:grid-cols-3 md:gap-6">
        {KINDS.map((k, i) => (
          <VerdictBlock
            key={k.id}
            label={k.label}
            value={loading ? null : verdicts ? verdicts[k.id] : null}
            caption={
              loading || !confidence
                ? null
                : confidenceCaption(confidence[k.id])
            }
            featured={i === 0}
          />
        ))}
      </main>

      <section className="mx-auto mt-14 w-full max-w-5xl border-t-2 border-ink pt-6">
        <h2 className="text-sm uppercase tracking-[0.25em] text-ink/50">
          7-day news evidence
        </h2>
        <p className="mt-2 text-sm text-ink/55">
          WALA means an allowlisted suspension headline matched that day.
          MERON means no matching headline, not an official all-clear.
        </p>
        {weekly === null ? (
          <p className="mt-5 text-sm text-ink/55">loading week…</p>
        ) : weekly.ok ? (
          <div className="mt-5 overflow-x-auto">
            <div className="grid min-w-[36rem] grid-cols-[9rem_repeat(3,1fr)] border-b border-ink/25 pb-2 text-xs uppercase tracking-wider text-ink/50">
              <span>date</span>
              {KINDS.map((kind) => (
                <span key={kind.id}>{kind.label}</span>
              ))}
            </div>
            {weekly.days.map((day) => (
              <div
                key={day.date}
                className="grid min-w-[36rem] grid-cols-[9rem_repeat(3,1fr)] border-b border-ink/15 py-3 text-sm"
              >
                <time dateTime={day.date}>{formatDay(day.date)}</time>
                {KINDS.map((kind) => {
                  const verdict = day.verdicts[kind.id];
                  return (
                    <span
                      key={kind.id}
                      className={
                        verdict === "WALA" ? "text-red" : "text-green"
                      }
                    >
                      {verdict}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm text-red">{weekly.error}</p>
        )}
      </section>

      <footer className="mx-auto mt-12 w-full max-w-5xl text-sm text-ink/55">
        {status && !status.ok ? <p className="text-red">{status.error}</p> : null}
        {status && status.ok ? (
          <details className="mb-4" open={status.headlines.length > 0}>
            <summary className="cursor-pointer select-none">why?</summary>
            {status.headlines.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {status.headlines.map((h) => (
                  <li key={h.link || h.title}>
                    <a
                      href={h.link}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-ink/30 hover:decoration-ink"
                    >
                      {h.title}
                    </a>
                    {h.source ? <span> · {h.source}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3">
                No matching headlines in the last 36 hours.
              </p>
            )}
          </details>
        ) : null}
        <p>
          {asOf ? `As of ${formatAsOf(asOf)} (Manila). ` : null}
          From allowlisted local news. This is not an official LGU announcement.
        </p>
      </footer>
    </div>
  );
}

function VerdictBlock({
  label,
  value,
  caption,
  featured,
}: {
  label: string;
  value: Verdict | null;
  caption: string | null;
  featured: boolean;
}) {
  const color =
    value === "WALA" ? "text-red" : value === "MERON" ? "text-green" : "text-ink/30";
  return (
    <section className={featured ? "md:col-span-3" : ""}>
      <h2 className="text-sm uppercase tracking-[0.25em] text-ink/50">{label}</h2>
      <p
        className={`font-display leading-none ${color} ${
          featured
            ? "mt-2 text-[clamp(5rem,22vw,11rem)]"
            : "mt-2 text-[clamp(3.5rem,14vw,7rem)]"
        }`}
      >
        {value ?? "···"}
      </p>
      {caption ? (
        <p className="mt-2 text-sm text-ink/55">{caption}</p>
      ) : null}
    </section>
  );
}
