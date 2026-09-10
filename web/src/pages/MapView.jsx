// Converted from stitch mockup: live_map/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { api, useLiveFeed, issuesAround, useArea } from "../api.jsx";
import { Spinner, Icon, PriorityBadge, GeoInput, NearbyList } from "../ui.jsx";

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

const RADIUS_M = 3000;

export default function MapView() {
  const [area, setArea] = useArea();
  const [issues, setIssues] = useState(null);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState(area ? area.label.split(",")[0] : "");
  const [fly, setFly] = useState(null);
  const [place, setPlace] = useState(null);   // { label, lat, lng, around, loading }
  const reqId = useRef(0);
  const nav = useNavigate();

  const loadAround = useCallback(async (r, saveAsArea) => {
    const mine = ++reqId.current;
    setFly({ lat: r.lat, lng: r.lng });
    setPlace({ label: r.label, lat: r.lat, lng: r.lng, around: null, loading: true });
    if (saveAsArea) setArea({ label: r.label, lat: r.lat, lng: r.lng });
    const around = await issuesAround(r.lat, r.lng, { radius: RADIUS_M });
    if (reqId.current === mine) setPlace({ label: r.label, lat: r.lat, lng: r.lng, around, loading: false });
  }, [setArea]);

  const load = useCallback(() => api("/issues").then(setIssues).catch(() => setIssues([])), []);
  useEffect(() => { load(); }, [load]);
  useLiveFeed(useCallback((ev) => {
    if (ev.type?.startsWith("issue")) {
      load();
      setPlace((p) => { if (p && !p.loading) loadAround(p); return p; });
    }
  }, [load, loadAround]));

  // if the citizen already chose an area, scope the map to it on open
  useEffect(() => { if (area && !place) loadAround(area); /* eslint-disable-next-line */ }, [area]);

  const shown = useMemo(() => {
    let list = issues || [];
    if (place && place.around) {
      const ids = new Set([...(place.around.open || []), ...(place.around.resolved || [])].map((x) => x.id));
      list = list.filter((i) => ids.has(i.id));
    }
    return list.filter((i) => cat === "All" || i.category === cat);
  }, [issues, cat, place]);
  const center = useMemo(
    () => (area ? [area.lat, area.lng]
      : issues && issues.length ? [issues[0].lat, issues[0].lng] : [13.0604, 80.2496]),
    [area, issues]);

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
        <GeoInput value={q} onChange={(v) => { setQ(v); if (!v) { setPlace(null); setArea(null); } }}
          onPick={(r) => loadAround(r, true)}
          placeholder="Search your area / any place…"
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
                <p className="text-[10px] font-bold text-primary tracking-widest uppercase">
                  {place ? "Community feed" : "Live feed"}
                </p>
                <h2 className="text-lg font-black font-headline truncate max-w-[220px]">
                  {place ? (place.label?.split(",")[0] || "Searched area") : "All issues"}
                </h2>
              </div>
              {place
                ? <button onClick={() => { setPlace(null); setQ(""); setArea(null); }} className="text-xs font-bold text-primary">Clear</button>
                : <span className="text-xs font-semibold text-slate-400">{shown.length} shown</span>}
            </div>

            {place ? (
              place.loading ? (
                <p className="text-sm text-on-variant py-3 flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  Loading {place.label?.split(",")[0]} feed…
                </p>
              ) : (
                <NearbyList
                  items={[...(place.around?.open || []), ...(place.around?.resolved || [])].slice(0, 15)}
                  onOpen={(i) => { setFly({ lat: i.lat, lng: i.lng }); nav(`/issues/${i.id}`); }}
                  emptyText={`No civic issues reported near ${place.label?.split(",")[0] || "here"} yet. Be the first — tap the ﹢ Report button.`}
                />
              )
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
