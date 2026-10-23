"use client";

import { useEffect, useEffectEvent, useRef } from "react";

// Cloudflare Turnstile, explicit render. Tokens are single-use: bump `resetKey`
// after every submit to get a fresh one.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  siteKey,
  resetKey,
  onToken,
  onError,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Latest callbacks without re-rendering the widget.
  const emitToken = useEffectEvent((token: string | null) => onToken(token));
  const emitError = useEffectEvent(() => onError());

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          size: "flexible",
          callback: (token: string) => emitToken(token),
          "expired-callback": () => emitToken(null),
          "error-callback": () => emitError(),
        });
      })
      .catch(() => emitError());
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) {
      emitToken(null);
      window.turnstile?.reset(widgetId.current);
    }
  }, [resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
