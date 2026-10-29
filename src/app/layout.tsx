import type { Metadata } from "next";
import { Alfa_Slab_One, Geist, Geist_Mono, Kalam } from "next/font/google";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Sketch look: Kalam for handwritten headings, Alfa Slab One for the logo's "SEO".
const kalam = Kalam({
  variable: "--font-hand",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const slab = Alfa_Slab_One({
  variable: "--font-slab",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Pages set a short title; the template adds the site name.
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: "See how your business shows up on Google and what to fix first.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${kalam.variable} ${slab.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
