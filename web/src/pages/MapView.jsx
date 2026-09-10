// Converted from stitch mockup: live_map/
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { api, useLiveFeed } from "../api.jsx";
import { Spinner, Icon, PriorityBadge, GeoInput } from "../ui.jsx";

const CATS = ["All", "Roads", "Water", "Waste", "Electricity", "Safety", "Flooding", "Traffic"];
const COLOR = { critical: "#ba1a1a", high: "#ea580c", medium: "#0058bc", low: "#94a3b8" };

function MapController({ fly }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);   // fix grey tiles on mount
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => { if (fly) map.flyTo([fly.lat, fly.lng], 16); }, [fly, map]);
  return null;
}

export default function MapView() {
  const [issues, setIssues] = useState(null);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [fly, setFly] = useState(null);
  const nav = useNavigate();

  const load = useCallback(() => api("/issues").then(setIssues).catch(() => setIssues([])), []);
  useEffect(() => { load(); }, [load]);
  useLiveFeed(useCallback((ev) => { if (ev.type?.startsWith("issue")) load(); }, [load]));

  const shown = useMemo(
    () => (issues || []).filter((i) => cat === "All" || i.category === cat), [issues, cat]);
  const center = useMemo(
    () => (issues && issues.length ? [issues[0].lat, issues[0].lng] : [13.0604, 80.2496]), [issues]);

  if (!issues) return <Spinner />;

  return (
    <div className="-mx-5 -mt-5 relative" style={{ height: "calc(100dvh - 8.5rem)" }}>
      <MapContainer center={center} zoom={13} zoomControl={false} scrollWheelZoom
        className="absolute inset-0 w-full h-full" style={{ borderRadius: 0 }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <MapController fly={fly} />
        {shown.map((i) => (
          <CircleMarker key={i.id} center={[i.lat, i.lng]}
            radius={9 + Math.min(i.cluster_count, 6) * 1.5}
            pathOptions={{ color: COLOR[i.priority] || COLOR.low, fillColor: COLOR[i.priority] || COLOR.low, fillOpacity: 0.5, weight: 2 }}>
            <Popup>
              <b>{i.title}</b><br />{i.category} · {i.priority}
              {i.cluster_count > 1 && ` · ${i.cluster_count} reports`}<br />
              <button onClick={() => nav(`/issues/${i.id}`)} className="text-primary font-bold mt-1">Open →</button>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="absolute top-4 left-4 right-4 z-[600] space-y-2">
        <GeoInput value={q} onChange={setQ} onPick={(r) => setFly({ lat: r.lat, lng: r.lng })}
          placeholder="Search any place…"
          className="w-full glass-strong border-none rounded-full py-3 pl-12 pr-10 shadow-xl shadow-blue-900/10 focus:ring-2 focus:ring-primary/30 outline-none" />
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shadow-sm ${cat === c ? "bg-primary text-white" : "glass-strong text-on-variant"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => navigator.geolocation?.getCurrentPosition((p) => setFly({ lat: p.coords.latitude, lng: p.coords.longitude }))}
        className="absolute right-4 top-32 z-[600] w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary-container text-white flex items-center justify-center shadow-xl shadow-primary/20 active:scale-90">
        <Icon name="my_location" fill />
      </button>

      <div className="absolute bottom-3 left-0 right-0 z-[600] px-3">
        <div className="glass-strong rounded-t-3xl shadow-[0_-20px_50px_rgba(0,0,0,0.12)] pt-3 pb-3 max-h-56 overflow-y-auto no-scrollbar">
          <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3" />
          <div className="px-4">
            <div className="flex justify-between items-end mb-3">
              <div>
                <p className="text-[10px] font-bold text-primary tracking-widest uppercase">Live feed</p>
                <h2 className="text-lg font-black font-headline">Nearby Issues</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">{shown.length} shown</span>
            </div>
            <div className="space-y-2">
              {shown.map((i) => (
                <button key={i.id} onClick={() => { setFly({ lat: i.lat, lng: i.lng }); nav(`/issues/${i.id}`); }}
                  className="w-full bg-white/70 p-2.5 rounded-xl flex gap-3 items-center text-left">
                  {i.photo_url
                    ? <img src={i.photo_url} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" alt="" />
                    : <div className="w-12 h-12 rounded-lg bg-surface-high flex items-center justify-center flex-shrink-0"><Icon name="place" className="text-slate-400" /></div>}
                  <div className="flex-1 min-w-0">
                    <PriorityBadge p={i.priority} />
                    <h3 className="text-sm font-bold leading-tight truncate mt-0.5">{i.title}</h3>
                    <p className="text-xs text-on-variant truncate">{i.address || `${i.lat.toFixed(3)}, ${i.lng.toFixed(3)}`}</p>
                  </div>
                  <Icon name="chevron_right" className="text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
