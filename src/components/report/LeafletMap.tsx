"use client";

import "leaflet/dist/leaflet.css";
import { latLngBounds } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  self: boolean;
}

// OpenStreetMap tiles; no Google Maps JS on the report. Circle markers avoid Leaflet's
// default icon images, which bundlers don't resolve.
export default function LeafletMap({ pins }: { pins: MapPin[] }) {
  const bounds = latLngBounds(pins.map((p) => [p.lat, p.lng]));
  // Self drawn last so it sits on top.
  const ordered = [...pins.filter((p) => !p.self), ...pins.filter((p) => p.self)];
  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24], maxZoom: 16 }}
      scrollWheelZoom={false}
      className="z-0 h-72 w-full rounded-lg border"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      {ordered.map((p, i) => (
        <CircleMarker
          key={`${p.lat},${p.lng},${i}`}
          center={[p.lat, p.lng]}
          radius={p.self ? 10 : 7}
          pathOptions={
            p.self
              ? { color: "#ffffff", weight: 3, fillColor: "#FB2B2F", fillOpacity: 1 }
              : { color: "#ffffff", weight: 2, fillColor: "#71717a", fillOpacity: 0.9 }
          }
        >
          <Tooltip direction="top" offset={[0, -6]} permanent={p.self}>
            {p.self ? `You: ${p.label}` : p.label}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
