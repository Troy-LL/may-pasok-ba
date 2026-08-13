"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Kind, Verdict } from "@/lib/classify";
import {
  DEFAULT_PLACE_ID,
  getPlace,
  labelOf,
  pickerPlaces,
  resolvePlace,
  type Place,
} from "@/lib/places";

type HeadlineHit = { title: string; link: string; source: string };
type StatusResult =
  | {
      ok: true;
      verdicts: Record<Kind, Verdict>;
      headlines: HeadlineHit[];
    }
  | { ok: false; error: string };

function isVerdict(value: unknown): value is Verdict {
  return value === "WALA" || value === "MERON";
}

function readStatus(value: unknown): StatusResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "hindi makuha ang news ngayon" };
  }
  if ("ok" in value && value.ok === false) {
    const error =
      "error" in value && typeof value.error === "string"
        ? value.error
        : "hindi makuha ang news ngayon";
    return { ok: false, error };
  }
  if (!("ok" in value) || value.ok !== true || !("verdicts" in value) || !("headlines" in value)) {
    return { ok: false, error: "hindi makuha ang news ngayon" };
  }
  const { verdicts, headlines } = value;
  if (typeof verdicts !== "object" || verdicts === null || !Array.isArray(headlines)) {
    return { ok: false, error: "hindi makuha ang news ngayon" };
  }
  const classes = "classes" in verdicts ? verdicts.classes : undefined;
  const work = "work" in verdicts ? verdicts.work : undefined;
  const government = "government" in verdicts ? verdicts.government : undefined;
  if (!isVerdict(classes) || !isVerdict(work) || !isVerdict(government)) {
    return { ok: false, error: "hindi makuha ang news ngayon" };
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
    headlines: hits,
  };
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
  { id: "classes", label: "klase" },
  { id: "work", label: "trabaho" },
  { id: "government", label: "gobyerno" },
];

export function Board({ initialPlaceId }: { initialPlaceId?: string }) {
  const router = useRouter();
  const options = useMemo(() => pickerPlaces(), []);
  const place =
    getPlace(initialPlaceId ?? DEFAULT_PLACE_ID) ??
    resolvePlace(initialPlaceId ?? "Quezon City");
  const [typed, setTyped] = useState<string | null>(null);
  const query = typed ?? labelOf(place);
  const [result, setResult] = useState<{
    id: string;
    status: StatusResult;
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
        if (!cancelled) setResult({ id, status: readStatus(body) });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            id,
            status: { ok: false, error: "hindi makuha ang news ngayon" },
          });
        }
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
  const loading = status === null;

  return (
    <div className="flex min-h-full flex-1 flex-col px-4 py-6 sm:px-8 sm:py-10">
      <header className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-medium tracking-tight">May Pasok Ba?</h1>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="sr-only">Lungsod o bayan</span>
            <input
              list="places"
              value={query}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => applyPlace(resolvePlace(query))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPlace(resolvePlace(query));
                }
              }}
              placeholder="Quezon City, Metro Manila"
              className="w-full border-b-2 border-ink bg-transparent pb-2 text-2xl font-medium tracking-tight outline-none placeholder:text-ink/30 focus:border-red"
            />
            <datalist id="places">
              {options.map((p) => (
                <option key={p.id} value={labelOf(p)} />
              ))}
            </datalist>
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
            featured={i === 0}
          />
        ))}
      </main>

      <footer className="mx-auto mt-12 w-full max-w-5xl text-sm text-ink/55">
        {status && !status.ok ? <p className="text-red">{status.error}</p> : null}
        {status && status.ok && status.headlines.length > 0 ? (
          <details className="mb-4">
            <summary className="cursor-pointer select-none">bakit?</summary>
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
          </details>
        ) : null}
        <p>
          kuha sa local news tuwing 5:00 AM (PHT). hindi ito opisyal na anunsyo
          ng LGU.
        </p>
      </footer>
    </div>
  );
}

function VerdictBlock({
  label,
  value,
  featured,
}: {
  label: string;
  value: Verdict | null;
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
    </section>
  );
}
