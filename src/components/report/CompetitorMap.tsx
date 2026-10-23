"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { MapPin } from "./LeafletMap";

// Leaflet touches `window` on import, so it only loads in the browser.
const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

export function CompetitorMap({ pins }: { pins: MapPin[] }) {
  if (pins.length === 0) return null;
  return <LeafletMap pins={pins} />;
}

export type { MapPin };
