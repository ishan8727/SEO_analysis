import { Poppins } from "next/font/google";
import type { CSSProperties } from "react";
import { IntakeForm } from "@/components/intake/IntakeForm";
import { SalesAsciiBackground } from "@/components/landing/SalesAsciiBackground";
import { SalesAsciiLogo } from "@/components/landing/SalesAsciiLogo";
import { CATEGORIES } from "@/lib/categories";

// Static page: ONLINE_MODE is read at build time (Docker build arg), the same value the API reads at runtime.
const onlineEnabled = process.env.ONLINE_MODE !== "off";

// The logo's typeface (the logo masks are drawn on a canvas with it).
const logoFont = Poppins({ weight: "800", subsets: ["latin"] });

// Dark theme over the ASCII background, with brand red for buttons and focus rings. Inline because the
// unlayered `.dark` rule in globals.css would beat a Tailwind utility setting the same variables.
const brandTheme = {
  "--primary": "#FB2B2F",
  "--primary-foreground": "#ffffff",
  "--ring": "#FB2B2F",
  colorScheme: "dark",
} as CSSProperties;

export default function Home() {
  return (
    <>
      {/* Here, not in the root layout: the layout also wraps the report print page that becomes the PDF. */}
      <SalesAsciiBackground />
      <main
        className="dark mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16 text-foreground"
        style={brandTheme}
      >
        <SalesAsciiLogo fontFamily={logoFont.style.fontFamily} />
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            SEO audit <span className="font-bold text-primary">powered by TSI</span>
          </h1>
          <p className="text-muted-foreground">
            See how your business shows up on Google, how fast your website is, and what to fix first. Takes
            about a minute.
          </p>
        </div>
        <IntakeForm categories={CATEGORIES} onlineEnabled={onlineEnabled} />
        <p className="text-xs text-muted-foreground">
          <a href="/privacy" className="underline underline-offset-2">
            Privacy policy
          </a>
        </p>
      </main>
    </>
  );
}
