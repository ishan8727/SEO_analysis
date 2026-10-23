import type { Metadata } from "next";
import Link from "next/link";

// Privacy policy (linked from the phone gate's consent line and the landing page).
// Keep it in step with what the code actually does: data model in prisma/schema.prisma,
// retention in SPEC.md section 10, outside services in architecture.md.

export const metadata: Metadata = {
  title: "Privacy policy · Free Local SEO Audit",
  description: "What we collect when you run an audit, why, who else sees it and how long we keep it.",
};

const CONTACT = "grow@thesalesinc.com";
const UPDATED = "24 October 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 text-sm leading-6 sm:py-16 [&_a]:underline [&_a]:underline-offset-2 [&_li]:ml-5 [&_li]:list-disc">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground">Last updated {UPDATED}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Privacy policy</h1>
        <p className="text-muted-foreground">
          This free local SEO audit is run by The Sales Inc (
          <a href="https://www.thesalesinc.com">thesalesinc.com</a>). This page explains what we collect when you
          use it, why, who else handles it and how long we keep it. Questions or requests:{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </header>

      <Section title="What we collect">
        <ul className="flex flex-col gap-1">
          <li>
            <strong>The business you search for.</strong> Its public Google listing (name, address, rating, reviews,
            opening hours, website) and its nearby competitors, fetched from Google.
          </li>
          <li>
            <strong>That business&apos;s public website.</strong> We load its homepage, take screenshots and run
            Google PageSpeed Insights to measure speed and on-page SEO.
          </li>
          <li>
            <strong>Your mobile number and role</strong>, only if you unlock the full report. Google Firebase sends
            the text message and confirms the code; we then store the verified number, its country, the role you
            picked and which report you unlocked.
          </li>
          <li>
            <strong>Technical data.</strong> A one-way scrambled (hashed) version of your IP address, used to stop
            abuse and rate-limit requests. We don&apos;t store your IP address itself.
          </li>
        </ul>
      </Section>

      <Section title="Why we use it">
        <ul className="flex flex-col gap-1">
          <li>To build your audit report and the PDF.</li>
          <li>To keep the service safe: bot checks, rate limits and abuse prevention.</li>
          <li>
            To follow up with you. When you unlock a report, our team receives your number and may contact you
            about your audit and how we can help. You can ask us to stop at any time.
          </li>
        </ul>
        <p>We don&apos;t sell your personal data.</p>
      </Section>

      <Section title="Who else handles it">
        <p>We use these providers to run the service. Each only gets what it needs for its part:</p>
        <ul className="flex flex-col gap-1">
          <li>
            <strong>Google</strong>: business search and listing data (Places), website speed tests (PageSpeed
            Insights), a summary of public reviews (Gemini), the phone text message and bot check (Firebase
            Authentication and reCAPTCHA).
          </li>
          <li>
            <strong>Cloudflare</strong>: the bot check before an audit starts (Turnstile).
          </li>
          <li>
            <strong>Make.com</strong>: passes your verified number and report details to our team&apos;s tools.
          </li>
          <li>
            <strong>Railway</strong>: hosts the app and its database.
          </li>
          <li>
            <strong>OpenStreetMap</strong>: your browser loads the map images in the report from OpenStreetMap&apos;s
            servers.
          </li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <ul className="flex flex-col gap-1">
          <li>Google listing data (rating, reviews, hours): up to 30 days.</li>
          <li>Website screenshots: up to 90 days.</li>
          <li>Audit scores and results: kept, so we can show how a business changes over time.</li>
          <li>
            Your number and role: until you ask us to delete them. Google Firebase also keeps a sign-in record for
            the number.
          </li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          We set one cookie of our own: it keeps a report unlocked in your browser for 7 days. Google reCAPTCHA and
          Cloudflare Turnstile may set their own cookies to tell people from bots. We don&apos;t use advertising
          cookies.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can ask for a copy of the data we hold about you, ask us to correct or delete it, or ask us not to
          contact you. Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from any address and include the mobile
          number you used. We reply within 30 days.
        </p>
      </Section>

      <Section title="Changes">
        <p>If we change how we use your data, we&apos;ll update this page and the date at the top.</p>
      </Section>

      <p>
        <Link href="/">Back to the free audit</Link>
      </p>
    </main>
  );
}
