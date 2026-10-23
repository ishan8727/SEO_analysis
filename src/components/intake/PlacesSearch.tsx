"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Business search with Places Autocomplete (New) via the Maps JS SDK.
// Browser key only (NEXT_PUBLIC_GOOGLE_BROWSER_KEY). One session token per search:
// it starts with the first keystroke and ends with fetchFields on the picked place.

export interface PickedPlace {
  placeId: string;
  name: string;
  address: string | null;
}

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction;
}

const DEBOUNCE_MS = 200;
const browserKey = process.env.NEXT_PUBLIC_GOOGLE_BROWSER_KEY ?? "";

let placesPromise: Promise<google.maps.PlacesLibrary> | undefined;
function loadPlaces(): Promise<google.maps.PlacesLibrary> {
  if (!placesPromise) {
    setOptions({ key: browserKey, v: "weekly", language: "en" });
    placesPromise = importLibrary("places");
  }
  return placesPromise;
}

export function PlacesSearch({
  country,
  primaryTypes,
  disabled,
  onPick,
}: {
  country: string;
  primaryTypes: string[];
  disabled?: boolean;
  onPick: (place: PickedPlace) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(browserKey ? null : "Business search isn't configured yet.");
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const latestRequest = useRef(0); // stale-reply counter
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(debounce.current), []);

  function search(input: string) {
    clearTimeout(debounce.current);
    const requestId = ++latestRequest.current;
    if (input.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const places = await loadPlaces();
        sessionToken.current ??= new places.AutocompleteSessionToken();
        const { suggestions: results } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionToken.current,
          includedRegionCodes: [country],
          ...(primaryTypes.length ? { includedPrimaryTypes: primaryTypes } : {}),
          language: "en",
        });
        if (requestId !== latestRequest.current) return; // a newer keystroke won
        const items = results.flatMap((s) =>
          s.placePrediction
            ? [
                {
                  id: s.placePrediction.placeId,
                  main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
                  secondary: s.placePrediction.secondaryText?.text ?? "",
                  prediction: s.placePrediction,
                },
              ]
            : [],
        );
        setSuggestions(items);
        setActive(-1);
        setOpen(true);
        setError(null);
      } catch {
        if (requestId === latestRequest.current) setError("Search is unavailable right now. Please try again.");
      }
    }, DEBOUNCE_MS);
  }

  async function pick(s: Suggestion) {
    setOpen(false);
    setQuery(s.main);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location", "types"] });
      onPick({ placeId: place.id, name: place.displayName ?? s.main, address: place.formattedAddress ?? null });
    } catch {
      setError("Couldn't load that business. Please try again.");
    } finally {
      sessionToken.current = null; // fetchFields ends the billing session
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      void pick(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label="Business name"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="Type your business name"
        autoComplete="off"
        className="h-11 text-base"
        value={query}
        disabled={disabled || !browserKey}
        onChange={(e) => {
          setQuery(e.target.value);
          search(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-md"
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching businesses</li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-2",
                  i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(s)}
              >
                <div className="text-sm font-medium">{s.main}</div>
                {s.secondary && <div className="text-xs text-muted-foreground">{s.secondary}</div>}
              </li>
            ))
          )}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
