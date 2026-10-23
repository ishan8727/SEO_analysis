import { cn } from "cn";
import { Check, Download, Minus, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { ReactNode } from "react";
import { FixList } from "@/components/scan/FixList";
import { PillarBars } from "@/components/scan/PillarBars";
import { ScoreRing } from "@/components/scan/ScoreRing";
import { Screenshots } from "@/components/scan/Screenshots";
import { TONE_TEXT, toneFor } from "@/components/scan/labels";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { rankTable } from "@/lib/scoring";
import type { DomAuditResult, GbpResult, PsiResult, PsiStrategyResult, ScanReport, SentimentResult, StepState } from "@/types";
import { CompetitorMap, type MapPin } from "./CompetitorMap";

// The full report. Server-renderable; the print page (Phase 5) reuses it for the PDF.

export function ReportView({ report }: { report: ScanReport }) {
  const local = report.mode === "local";
  const step = (s: keyof ScanReport["progress"]): StepState => report.progress[s] ?? "pending";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Overall score</CardTitle>
          {report.score?.rank && (
            <CardDescription>
              You rank <span className="font-medium text-foreground">#{report.score.rank.position}</span> of{" "}
              {report.score.rank.of} nearby on rating and reviews
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <ScoreRing score={report.score?.total ?? null} grade={report.score?.grade ?? null} className="shrink-0" />
          <PillarBars pillars={report.score?.pillars ?? {}} mode={report.mode} />
        </CardContent>
        {report.pdfUrl && (
          <CardContent className="print:hidden">
            <a href={report.pdfUrl} className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden /> Download PDF
            </a>
          </CardContent>
        )}
      </Card>

      <Section title="What to fix first" description="Ranked by points gained for the effort. Points are out of 100.">
        {report.fixes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing major to fix. Nice work.</p>
        ) : (
          <FixList fixes={report.fixes} />
        )}
      </Section>

      {(report.screenshots.mobile || report.screenshots.desktop) && (
        <Section title="Your homepage" description="As Google's speed test saw it.">
          <Screenshots shots={report.screenshots} psiState="done" />
        </Section>
      )}

      {local && <CompetitorsSection report={report} state={step("competitors")} />}
      {local && <SentimentSection sentiment={report.sentiment} state={step("sentiment")} />}
      {local && <GbpSection gbp={report.gbp} />}
      <WebsiteSection psi={report.psi} dom={report.domAudit} local={local} hasWebsite={!!report.business.websiteUrl} />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/* ---------- Competitors ---------- */

function CompetitorsSection({ report, state }: { report: ScanReport; state: StepState }) {
  const items = report.competitors?.items ?? [];
  if (items.length === 0) {
    return (
      <Section title="Nearby competitors">
        <Muted>
          {state === "failed"
            ? "We couldn't look up nearby competitors this time."
            : "We didn't find businesses of the same type nearby."}
        </Muted>
      </Section>
    );
  }
  const rows = rankTable(report.business.name, report.gbp, report.competitors);
  const pins: MapPin[] = [
    ...(report.location ? [{ ...report.location, label: report.business.name, self: true }] : []),
    ...items.flatMap((c) => (c.location ? [{ ...c.location, label: c.name, self: false }] : [])),
  ];
  const radiusKm = (report.competitors?.radiusM ?? 0) / 1000;
  return (
    <Section title="Nearby competitors" description={`Same type of business within ${radiusKm} km, ranked by rating and review count.`}>
      <div className="print:hidden">
        <CompetitorMap pins={pins} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Business</th>
              <th className="py-2 pr-2 text-right font-medium">Rating</th>
              <th className="py-2 pr-2 text-right font-medium">Reviews</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Distance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.placeId ?? "self"} className={cn("border-t", r.self && "bg-blue-50 font-medium")}>
                <td className="py-2 pr-2 tabular-nums">{i + 1}</td>
                <td className="py-2 pr-2">{r.self ? `${r.name} (you)` : r.name}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{r.rating?.toFixed(1) ?? "–"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{r.reviewCount}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">{r.self ? "–" : formatDistance(r.distanceM)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function formatDistance(m: number | null): string {
  if (m === null) return "–";
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/* ---------- Reviews ---------- */

function SentimentSection({ sentiment, state }: { sentiment: SentimentResult | null; state: StepState }) {
  if (!sentiment) {
    return (
      <Section title="What your reviews say">
        <Muted>
          {state === "skipped"
            ? "Your Google profile has no reviews with text for us to read yet."
            : "We couldn't analyse your reviews this time."}
        </Muted>
      </Section>
    );
  }
  const positive = Math.round(sentiment.positiveRatio * 100);
  return (
    <Section
      title="What your reviews say"
      description={`Based on the ${sentiment.reviewCount} most relevant reviews Google shows. ${positive}% positive.`}
    >
      <p className="text-sm">{sentiment.summary}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TagList icon={<ThumbsUp className="size-4 text-emerald-600" aria-hidden />} title="Customers love" items={sentiment.loves} />
        <TagList icon={<ThumbsDown className="size-4 text-red-600" aria-hidden />} title="Customers complain about" items={sentiment.complaints} />
      </div>
    </Section>
  );
}

function TagList({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </h3>
      {items.length === 0 ? (
        <Muted>Nothing stood out.</Muted>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Google profile ---------- */

function GbpSection({ gbp }: { gbp: GbpResult | null }) {
  if (!gbp) {
    return (
      <Section title="Google profile checklist">
        <Muted>We couldn&apos;t read your Google profile this time.</Muted>
      </Section>
    );
  }
  const c = gbp.checks;
  return (
    <Section title="Google profile checklist">
      <ul className="grid gap-2 sm:grid-cols-2">
        <CheckRow ok={c.hasWebsite}>Website link</CheckRow>
        <CheckRow ok={c.hasPhone}>Phone number</CheckRow>
        <CheckRow ok={c.hasHours}>Opening hours</CheckRow>
        <CheckRow ok={c.hasDescription}>Business description</CheckRow>
        <CheckRow ok={c.photosCount >= 10} partial={c.photosCount > 0}>
          Photos ({c.photosCount}
          {c.photosCount >= 10 ? "+" : ""})
        </CheckRow>
        <CheckRow ok={c.isOperational}>Marked as open</CheckRow>
        <CheckRow ok={c.hasPrimaryType}>Primary category</CheckRow>
        <CheckRow ok={gbp.reviewCount > 0}>
          Reviews ({gbp.reviewCount}
          {gbp.rating !== null ? `, ${gbp.rating.toFixed(1)}★` : ""})
        </CheckRow>
      </ul>
    </Section>
  );
}

function CheckRow({ ok, partial = false, children }: { ok: boolean | null; partial?: boolean; children: ReactNode }) {
  const Icon = ok ? Check : partial ? Minus : X;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon
        className={cn("size-4 shrink-0", ok ? "text-emerald-600" : partial ? "text-amber-600" : "text-red-600")}
        aria-label={ok ? "Yes" : partial ? "Partly" : "No"}
      />
      <span>{children}</span>
    </li>
  );
}

/* ---------- Website ---------- */

function WebsiteSection({
  psi,
  dom,
  local,
  hasWebsite,
}: {
  psi: PsiResult | null;
  dom: DomAuditResult | null;
  local: boolean;
  hasWebsite: boolean;
}) {
  if (!psi && !dom) {
    return (
      <Section title="Your website">
        <Muted>
          {hasWebsite
            ? "We couldn't test your website this time. Check that it loads and doesn't block search engines."
            : "There's no website on your Google profile, so there was nothing to test."}
        </Muted>
      </Section>
    );
  }
  return (
    <Section title="Your website" description={psi?.url ?? dom?.finalUrl}>
      {psi && (
        <div className="grid gap-4 sm:grid-cols-2">
          <PsiCard label="On phones" run={psi.mobile} />
          <PsiCard label="On computers" run={psi.desktop} />
        </div>
      )}
      {psi?.mobile && psi.mobile.failingSeoAudits.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Google&apos;s SEO checks that failed</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {psi.mobile.failingSeoAudits.map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ul>
        </div>
      )}
      {dom && <DomFacts dom={dom} local={local} https={psi?.https ?? dom.finalUrl.startsWith("https:")} />}
    </Section>
  );
}

const pct = (x: number | null) => (x === null ? null : Math.round(x * 100));

function PsiCard({ label, run }: { label: string; run: PsiStrategyResult | null }) {
  if (!run) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <h3 className="text-sm font-medium">{label}</h3>
        <Muted>The speed test didn&apos;t finish for this device.</Muted>
      </div>
    );
  }
  const scores: [string, number | null][] = [
    ["Performance", pct(run.performance)],
    ["SEO", pct(run.seo)],
    ["Best practices", pct(run.bestPractices)],
    ["Accessibility", pct(run.accessibility)],
  ];
  const vitals: [string, string | null][] = [
    ["Largest paint", run.cwv.lcpMs === null ? null : `${(run.cwv.lcpMs / 1000).toFixed(1)} s`],
    ["Layout shift", run.cwv.cls === null ? null : run.cwv.cls.toFixed(2)],
    ["Blocking time", run.cwv.tbtMs === null ? null : `${Math.round(run.cwv.tbtMs)} ms`],
    ["Interaction (real users)", run.cwv.inpMs === null ? null : `${Math.round(run.cwv.inpMs)} ms`],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <dl className="grid grid-cols-4 gap-2 text-center">
        {scores.map(([name, value]) => (
          <div key={name} className="flex flex-col items-center gap-0.5">
            <dd className={cn("text-xl font-semibold tabular-nums", value !== null && TONE_TEXT[toneFor(value)])}>
              {value ?? "–"}
            </dd>
            <dt className="text-[0.7rem] leading-tight text-muted-foreground">{name}</dt>
          </div>
        ))}
      </dl>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {vitals.map(([name, value]) => (
          <div key={name} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="tabular-nums">{value ?? "–"}</dd>
          </div>
        ))}
      </dl>
      {run.cwvPass !== null && (
        <p className="text-xs">
          Core Web Vitals (real users):{" "}
          <span className={run.cwvPass ? "text-emerald-600" : "text-red-600"}>{run.cwvPass ? "passed" : "failed"}</span>
        </p>
      )}
    </div>
  );
}

function DomFacts({ dom, local, https }: { dom: DomAuditResult; local: boolean; https: boolean }) {
  const noindex = /noindex/i.test(dom.robotsMeta ?? "");
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">On-page checks</h3>
      <dl className="flex flex-col gap-2 text-sm">
        <Fact label="Page title" value={dom.title} />
        <Fact label="Meta description" value={dom.metaDescription} />
      </dl>
      <ul className="grid gap-2 sm:grid-cols-2">
        <CheckRow ok={https}>Secure (HTTPS)</CheckRow>
        <CheckRow ok={dom.viewport}>Mobile viewport tag</CheckRow>
        <CheckRow ok={dom.h1Count > 0}>Main heading (H1 × {dom.h1Count})</CheckRow>
        <CheckRow ok={local ? dom.hasLocalSchema : dom.jsonLdTypes.length > 0}>
          {local ? "LocalBusiness schema" : "Structured data"}
          {dom.jsonLdTypes.length > 0 && ` (${dom.jsonLdTypes.slice(0, 3).join(", ")})`}
        </CheckRow>
        <CheckRow ok={dom.images.missingAlt === 0} partial={dom.images.missingAlt < dom.images.total}>
          Image alt text ({dom.images.total - dom.images.missingAlt}/{dom.images.total})
        </CheckRow>
        <CheckRow ok={dom.links.tel + dom.links.whatsapp > 0}>Tap-to-call / WhatsApp link</CheckRow>
        <CheckRow ok={!!dom.canonical && !noindex}>{noindex ? "Blocked from Google (noindex)" : "Canonical tag"}</CheckRow>
        <CheckRow ok={dom.robotsTxt}>robots.txt</CheckRow>
        <CheckRow ok={dom.sitemapXml}>sitemap.xml</CheckRow>
        {local && dom.napMatch && (
          <CheckRow ok={dom.napMatch.score >= 1} partial={dom.napMatch.score > 0}>
            Name, address & phone match Google ({Math.round(dom.napMatch.score * 100)}%)
          </CheckRow>
        )}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", !value && "text-red-600")}>{value ?? "Missing"}</dd>
    </div>
  );
}
