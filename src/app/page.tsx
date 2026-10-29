import { Logo } from "@/components/brand/Logo";
import { PaperBackground } from "@/components/brand/PaperBackground";
import { IntakeForm } from "@/components/intake/IntakeForm";
import { CATEGORIES } from "@/lib/categories";

// Static page: ONLINE_MODE is read at build time (Docker build arg), the same value the API reads at runtime.
const onlineEnabled = process.env.ONLINE_MODE !== "off";

export default function Home() {
  return (
    <>
      {/* Here, not in the root layout: the layout also wraps the report print page that becomes the PDF. */}
      <PaperBackground />
      {/* Sketch theme (globals.css .sketch-theme): ink on paper, hand-drawn outlines. */}
      <main className="sketch-theme mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16 text-foreground">
        <Logo />
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl tracking-tight sm:text-5xl">Check your business&apos;s SEO</h1>
          <p className="text-muted-foreground">
            See how you show up on Google, how fast your website is, and what to fix first. Takes
            about a minute.
          </p>
        </div>
        <IntakeForm categories={CATEGORIES} onlineEnabled={onlineEnabled} />
      </main>
    </>
  );
}
