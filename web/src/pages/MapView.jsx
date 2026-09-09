import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { api, useLiveFeed } from "../api.jsx";
import { Spinner, Icon } from "../ui.jsx";

const CATS = ["All", "Roads", "Sanitation", "Utilities", "Drainage", "Public Property"];
const COLOR = { critical: "#ba1a1a", high: "#ea580c", medium: "#0058bc", low: "#94a3b8" };

export default function MapView() {
  const [issues, setIssues] = useState(null);
  const [cat, setCat] = useState("All");
  const nav = useNavigate();

  const load = useCallback(() => api("/issues").then(setIssues).catch(() => setIssues([])), []);
  useEffect(load, [load]);
  useLiveFeed(useCallback(() => load(), [load]));

  const shown = useMemo(
    () => (issues || []).filter((i) => cat === "All" || i.category === cat),
    [issues, cat]
  );
  const center = useMemo(() => {
    if (shown.length) return [shown[0].lat, shown[0].lng];
    return [13.0604, 80.2496];
  }, [shown]);

  if (!issues) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Live Map</h1>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${
              cat === c ? "bg-primary text-white" : "bg-white text-on-variant"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="h-[60vh] rounded-lg overflow-hidden shadow-sm">
        <MapContainer center={center} zoom={13} className="w-full h-full" scrollWheelZoom>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          {shown.map((i) => (
            <CircleMarker
              key={i.id}
              center={[i.lat, i.lng]}
              radius={9 + Math.min(i.cluster_count, 6) * 1.5}
              pathOptions={{ color: COLOR[i.priority] || COLOR.low, fillOpacity: 0.55 }}
            >
              <Popup>
                <b>{i.title}</b>
                <br />
                {i.category} · {i.priority}
                {i.cluster_count > 1 && ` · ${i.cluster_count} reports`}
                <br />
                <button
                  onClick={() => nav(`/issues/${i.id}`)}
                  className="text-primary font-bold mt-1"
                >
                  Open →
                </button>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-on-variant flex items-center gap-1">
        <Icon name="info" className="text-sm" />
        Marker size grows with the number of clustered reports. Color = priority.
      </p>
    </div>
  );
}
