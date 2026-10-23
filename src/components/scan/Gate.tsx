"use client";

import { AsYouType, getCountries, getCountryCallingCode, isSupportedCountry, type CountryCode } from "libphonenumber-js";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DotsLoader } from "@/components/loader/DotsLoader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
// Select popups render in a portal outside the page's dark scope, hence className="dark".
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { allowedPhoneCountries, isAllowedPhoneCountry, parsePhone } from "@/lib/phone";

// Lead gate (SPEC.md section 9): role → phone → SMS code from Firebase → POST the ID token to
// /api/verify/confirm, which sets the unlock cookie. Follows
// https://firebase.google.com/docs/auth/web/phone-auth (invisible reCAPTCHA, signInWithPhoneNumber).

type FirebaseClient = typeof import("@/lib/firebase-client");
type Confirmation = import("@/lib/firebase-client").ConfirmationResult;
type Verifier = InstanceType<FirebaseClient["RecaptchaVerifier"]>;

const ROLES = [
  { value: "owner", label: "I own the business" },
  { value: "founder", label: "Founder / partner" },
  { value: "marketing", label: "Marketing team" },
  { value: "agency", label: "Agency / consultant" },
  { value: "other", label: "Something else" },
] as const;
type Role = (typeof ROLES)[number]["value"];

const RESEND_AFTER_SEC = 60;
const SLOW_DOWN = "Woah, slow down. Try again in a few minutes.";

const FIREBASE_ERRORS: Record<string, string> = {
  "auth/invalid-phone-number": "That number doesn't look right. Check it and try again.",
  "auth/missing-phone-number": "Enter your phone number.",
  "auth/too-many-requests": SLOW_DOWN,
  "auth/quota-exceeded": SLOW_DOWN,
  "auth/operation-not-allowed": "We can't text numbers in that country yet.",
  "auth/invalid-verification-code": "That code isn't right. Check the text message and try again.",
  "auth/missing-verification-code": "Enter the 6-digit code from the text message.",
  "auth/code-expired": "That code has expired. Send a new one.",
  "auth/captcha-check-failed": "We couldn't check you're human. Please try again.",
  // reCAPTCHA token rejected; usually a blocker (Brave Shields, uBlock) breaking reCAPTCHA.
  "auth/invalid-app-credential": "We couldn't check you're human. Turn off ad or tracker blocking for this page and try again.",
  "auth/network-request-failed": "We couldn't reach the server. Check your connection and try again.",
};

const API_ERRORS: Record<string, string> = {
  RATE_LIMITED: SLOW_DOWN,
  VERIFY_FAILED: "We couldn't verify your number. Please send a new code.",
  COUNTRY_NOT_SUPPORTED: "We can't verify numbers from that country yet.",
};

function messageFor(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  // Only the error code: Firebase's error object can carry the phone number in customData.
  if (!FIREBASE_ERRORS[code]) console.warn("phone verification failed:", code || "unknown error");
  return FIREBASE_ERRORS[code] ?? "Something went wrong. Please try again.";
}

function countryOptions(): { code: CountryCode; label: string }[] {
  const allowed = allowedPhoneCountries();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return getCountries()
    .filter((c) => isAllowedPhoneCountry(c, allowed))
    .map((code) => ({ code, label: `${names.of(code) ?? code} (+${getCountryCallingCode(code)})` }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
}

export function Gate({
  scanId,
  countryCode,
  defaultCountry,
}: {
  scanId: string;
  countryCode: string | null; // the business's country, from Google
  defaultCountry: string;
}) {
  const router = useRouter();
  const countries = useMemo(() => countryOptions(), []);
  const initialCountry =
    [countryCode, defaultCountry].find((c) => c && countries.some((o) => o.code === c)) ?? countries[0]?.code ?? "IN";

  const [role, setRole] = useState<Role>("owner");
  const [country, setCountry] = useState<string>(initialCountry);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const recaptchaRef = useRef<HTMLDivElement>(null);
  const client = useRef<FirebaseClient | null>(null);
  const verifier = useRef<Verifier | null>(null);
  const confirmation = useRef<Confirmation | null>(null);

  const parsed = isSupportedCountry(country) ? parsePhone(phone, country) : null;

  // Countdown for "Resend code".
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Tear down reCAPTCHA when the gate goes away.
  useEffect(() => () => verifier.current?.clear(), []);

  async function sendCode() {
    if (!parsed) {
      setError("That number doesn't look right. Check it and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      client.current ??= await import("@/lib/firebase-client");
      const fb = client.current;
      if (!fb.firebaseConfigured) throw Object.assign(new Error("not configured"), { code: "config" });
      const auth = fb.firebaseAuth();
      verifier.current ??= new fb.RecaptchaVerifier(auth, recaptchaRef.current!, { size: "invisible" });
      confirmation.current = await fb.signInWithPhoneNumber(auth, parsed.e164, verifier.current);
      setStep("code");
      setCode("");
      setResendIn(RESEND_AFTER_SEC);
    } catch (err) {
      // The docs reset reCAPTCHA after a failure; clearing and recreating does the same.
      verifier.current?.clear();
      verifier.current = null;
      setError((err as { code?: string }).code === "config" ? "Verification isn't set up yet." : messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!confirmation.current || !client.current) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await confirmation.current.confirm(code.trim());
      const idToken = await user.getIdToken();
      const res = await fetch("/api/verify/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId, role, idToken }),
      });
      await client.current.signOut(client.current.firebaseAuth()).catch(() => {}); // we keep only our cookie
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        setError(API_ERRORS[data.code ?? ""] ?? "Something went wrong. Please try again.");
        return;
      }
      router.push(`/report/${scanId}`); // bounces back to /scan/[id], now unlocked, if the audit is still running
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // data-busy: a faint scan line sweeps the card while a code is sent or checked (globals.css).
    <Card className="gate-card relative overflow-hidden" data-busy={busy || undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4" aria-hidden /> Unlock your full report
        </CardTitle>
        <CardDescription>
          Competitor names, every fix, what your reviews say and a PDF. Verify your mobile number to see it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "phone" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <Select items={ROLES.map((r) => ({ value: r.value, label: r.label }))} value={role} onValueChange={(v) => v && setRole(v as Role)}>
              <SelectTrigger aria-label="Your role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark">
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Select
                items={countries.map((c) => ({ value: c.code, label: c.label }))}
                value={country}
                onValueChange={(v) => {
                  if (!v) return;
                  setCountry(v);
                  setPhone((p) => (p ? new AsYouType(v as CountryCode).input(p.replace(/[^\d+]/g, "")) : p));
                }}
              >
                <SelectTrigger aria-label="Country code" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark">
                  {countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Mobile number"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="Mobile number"
                className="h-9"
                value={phone}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  // Format as they type, unless they're deleting (AsYouType re-adds separators).
                  setPhone(value.length < phone.length ? value : new AsYouType(country as CountryCode).input(value));
                }}
              />
            </div>
            <Button type="submit" disabled={busy || !parsed}>
              {busy ? (
                <>
                  <DotsLoader /> Sending
                </>
              ) : (
                "Text me a code"
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              We&apos;ll text you a 6-digit code. Standard SMS rates may apply. By continuing you agree to our{" "}
              <a href="/privacy" className="underline underline-offset-2">
                privacy policy
              </a>
              .
            </p>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmCode();
            }}
          >
            <p className="text-sm text-muted-foreground">
              We sent a code to <span className="font-medium text-foreground">{parsed?.e164}</span>.
            </p>
            <Input
              aria-label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="6-digit code"
              className="h-9 tracking-widest"
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? (
                <>
                  <DotsLoader /> Checking
                </>
              ) : (
                "Unlock my report"
              )}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                disabled={busy || resendIn > 0}
                onClick={() => void sendCode()}
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-2"
                disabled={busy}
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
              >
                Change number
              </button>
            </div>
          </form>
        )}
        <div ref={recaptchaRef} />
        <div aria-live="polite" className="mt-2 min-h-5 text-sm">
          {error && <p className="text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
