"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlacesSearch, type PickedPlace } from "@/components/intake/PlacesSearch";
import { Turnstile } from "@/components/intake/Turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Category } from "@/lib/categories";
import { cn } from "@/lib/utils";

type Mode = "local" | "online";
type Payload = { mode: "local"; placeId: string } | { mode: "online"; url: string };

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

const ERROR_COPY: Record<string, string> = {
  RATE_LIMITED: "Woah, slow down. Try again in a few minutes.",
};

export function IntakeForm({
  categories,
  onlineEnabled,
}: {
  categories: Category[];
  onlineEnabled: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("local");
  const [categoryId, setCategoryId] = useState("other");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState<Payload | null>(null); // waiting for a Turnstile token
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = categories.find((c) => c.id === categoryId);

  async function submit(payload: Payload, currentToken = token) {
    if (!currentToken) {
      setPending(payload);
      return;
    }
    setPending(null);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, turnstileToken: currentToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { scanId?: string; code?: string; error?: string };
      if (res.ok && data.scanId) {
        router.push(`/scan/${data.scanId}`);
        return;
      }
      setError(ERROR_COPY[data.code ?? ""] ?? data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    }
    setSubmitting(false);
    setResetKey((k) => k + 1); // tokens are single-use
  }

  function handleToken(next: string | null) {
    setToken(next);
    // A pick made before Turnstile finished: send it as soon as the token arrives.
    if (next && pending && !submitting) void submit(pending, next);
  }

  const busy = submitting || pending !== null;

  return (
    <div className="flex flex-col gap-4">
      {onlineEnabled && (
        <div role="tablist" aria-label="What should we audit?" className="inline-flex w-fit rounded-lg bg-muted p-1">
          {(
            [
              ["local", "Local business"],
              ["online", "Website only"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === "local" ? (
        <div className="flex flex-col gap-3">
          <Select
            items={categories.map((c) => ({ value: c.id, label: c.label }))}
            value={categoryId}
            onValueChange={(v) => setCategoryId(v ?? "other")}
          >
            <SelectTrigger aria-label="Business category" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            {/* "dark": the popup renders in a portal outside the landing page's dark scope. */}
            <SelectContent className="dark">
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PlacesSearch
            primaryTypes={category?.primaryTypes ?? []}
            disabled={busy}
            onPick={(place) => {
              setPicked(place);
              void submit({ mode: "local", placeId: place.placeId });
            }}
          />
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void submit({ mode: "online", url: url.trim() });
          }}
        >
          <Input
            aria-label="Website address"
            placeholder="yourbusiness.com"
            inputMode="url"
            autoComplete="url"
            className="h-11 text-base"
            value={url}
            maxLength={2048}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" size="lg" className="h-11 px-5" disabled={busy || !url.trim()}>
            Audit my website
          </Button>
        </form>
      )}

      {turnstileSiteKey ? (
        <Turnstile
          siteKey={turnstileSiteKey}
          resetKey={resetKey}
          onToken={handleToken}
          onError={() => setError("The human check didn't load. Please refresh the page.")}
        />
      ) : (
        <p className="text-sm text-destructive">{"The human check isn't configured yet."}</p>
      )}

      <div aria-live="polite" className="min-h-6 text-sm">
        {busy && (
          <p className="text-muted-foreground">
            {pending ? "Checking you're human…" : `Starting your audit${picked && mode === "local" ? ` for ${picked.name}` : ""}…`}
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </div>
    </div>
  );
}
