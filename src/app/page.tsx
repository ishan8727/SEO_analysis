import { IntakeForm } from "@/components/intake/IntakeForm";
import { CATEGORIES } from "@/lib/categories";

// Static page: DEFAULT_COUNTRY and ONLINE_MODE are read at build time
// (Docker build args), the same values the API reads at runtime.
const country = process.env.DEFAULT_COUNTRY ?? "IN";
const onlineEnabled = process.env.ONLINE_MODE !== "off";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Free local SEO audit</h1>
        <p className="text-muted-foreground">
          See how your business shows up on Google, how fast your website is, and what to fix first. Takes
          about a minute.
        </p>
      </div>
      <IntakeForm categories={CATEGORIES} country={country} onlineEnabled={onlineEnabled} />
    </main>
  );
}
