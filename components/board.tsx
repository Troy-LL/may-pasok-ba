"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { sanitizeUrl } from "@/lib/security";

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
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
    setOpen(false);
    setHighlightedIndex(-1);
    setLocNote(null);
    router.replace(`/?place=${encodeURIComponent(next.id)}`);
  }

  // Scroll highlighted item into view on keyboard navigation
  useEffect(() => {
    if (open && highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as
        | HTMLElement
        | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [open, highlightedIndex]);

  // Click outside to cleanly close without accidental submission
  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setTyped(null);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        const currentIndex = suggestions.findIndex((p) => p.id === place.id);
        setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
      } else if (suggestions.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        const currentIndex = suggestions.findIndex((p) => p.id === place.id);
        setHighlightedIndex(
          currentIndex >= 0 ? currentIndex : suggestions.length - 1,
        );
      } else if (suggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev <= 0 ? suggestions.length - 1 : prev - 1,
        );
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        applyPlace(suggestions[highlightedIndex]);
      } else {
        applyPlace(resolvePlace(query));
      }
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setTyped(null);
      setOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      setTyped(null);
      setHighlightedIndex(-1);
    }
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
    fetch(`/api/status?place=${encodeURIComponent(id)}`, { cache: "no-store" })
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
          <div ref={containerRef} className="relative min-w-0 flex-1">
            <div className="flex items-center justify-between border-b-2 border-ink pb-1 focus-within:border-red transition-colors">
              <label htmlFor="place-combobox" className="sr-only">
                Lungsod o bayan
              </label>
              <input
                id="place-combobox"
                ref={inputRef}
                role="combobox"
                aria-expanded={open}
                aria-controls="place-list"
                aria-autocomplete="list"
                aria-activedescendant={
                  highlightedIndex >= 0 && suggestions[highlightedIndex]
                    ? `place-option-${suggestions[highlightedIndex].id}`
                    : undefined
                }
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={(e) => {
                  e.currentTarget.select();
                  setOpen(true);
                  const currentIndex = suggestions.findIndex(
                    (p) => p.id === place.id,
                  );
                  setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
                }}
                onClick={() => {
                  if (!open) {
                    setOpen(true);
                    inputRef.current?.select();
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="Metro Manila, NCR"
                className="w-full bg-transparent text-2xl font-medium tracking-tight outline-none placeholder:text-ink/30 cursor-pointer focus:cursor-text"
              />
              <div className="flex items-center gap-1 pl-2">
                {typed !== null && typed !== "" && (
                  <button
                    type="button"
                    aria-label="Burahin ang paghahanap"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink/40 hover:bg-ink/10 hover:text-ink transition-colors"
                    onClick={() => {
                      setTyped("");
                      setOpen(true);
                      setHighlightedIndex(0);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="text-base leading-none">✕</span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={
                    open
                      ? "Isara ang listahan"
                      : "Buksan ang listahan ng mga lungsod"
                  }
                  tabIndex={-1}
                  className="flex h-7 w-7 items-center justify-center text-ink/60 hover:text-ink transition-transform"
                  onClick={() => {
                    if (open) {
                      setOpen(false);
                      setTyped(null);
                    } else {
                      setOpen(true);
                      inputRef.current?.focus();
                      inputRef.current?.select();
                    }
                  }}
                >
                  <svg
                    className={`h-4 w-4 transition-transform duration-200 ${
                      open ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {open && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-hidden border-2 border-ink bg-paper shadow-lg">
                <ul
                  id="place-list"
                  ref={listRef}
                  role="listbox"
                  className="max-h-72 overflow-y-auto divide-y divide-ink/10"
                >
                  {suggestions.length > 0 ? (
                    suggestions.map((p, index) => {
                      const isSelected = p.id === place.id;
                      const isHighlighted = index === highlightedIndex;
                      return (
                        <li
                          key={p.id}
                          id={`place-option-${p.id}`}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left text-base transition-colors ${
                              isHighlighted
                                ? "bg-ink text-paper"
                                : isSelected
                                  ? "bg-ink/5 font-semibold text-ink"
                                  : "text-ink hover:bg-ink/10"
                            }`}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onClick={() => applyPlace(p)}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{p.name}</span>
                              <span
                                className={`text-xs ${
                                  isHighlighted
                                    ? "text-paper/70"
                                    : "text-ink/60"
                                }`}
                              >
                                {p.province === "NCR"
                                  ? "Rehiyon (Pangkalahatan)"
                                  : p.province}
                              </span>
                            </div>
                            {isSelected && (
                              <span
                                className={`text-sm font-bold ${
                                  isHighlighted ? "text-paper" : "text-green"
                                }`}
                                aria-label="Kasalukuyang napili"
                              >
                                ✓
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })
                  ) : (
                    <li className="px-4 py-5 text-center text-sm text-ink/70">
                      <p>Walang nahanap na lungsod sa NCR.</p>
                      <button
                        type="button"
                        className="mt-2 inline-block border border-ink px-3 py-1 text-xs font-medium hover:bg-ink hover:text-paper"
                        onClick={() => {
                          setTyped("");
                          setHighlightedIndex(0);
                          inputRef.current?.focus();
                        }}
                      >
                        Ipakita ang lahat ng mga lungsod
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
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
                {status.headlines.map((h) => {
                  const safeLink = sanitizeUrl(h.link);
                  return (
                    <li key={h.link || h.title}>
                      {safeLink ? (
                        <a
                          href={safeLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-ink/30 hover:decoration-ink"
                        >
                          {h.title}
                        </a>
                      ) : (
                        <span>{h.title}</span>
                      )}
                      {h.source ? <span> · {h.source}</span> : null}
                    </li>
                  );
                })}
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
