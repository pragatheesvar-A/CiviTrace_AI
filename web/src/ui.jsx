// Converted from stitch mockup: offline_mode_state/ (OfflineBanner) + shared design-system primitives
import React, { useEffect, useRef, useState } from "react";
import { geocode } from "./api.jsx";

export const Icon = ({ name, className = "", fill = false }) => (
  <span className={`material-symbols-outlined ${fill ? "fill" : ""} ${className}`}>{name}</span>
);

const PRIORITY = {
  critical: "bg-error/10 text-error",
  high: "bg-orange-500/10 text-orange-600",
  medium: "bg-primary/10 text-primary",
  low: "bg-slate-400/15 text-slate-500",
};
const STATUS = {
  Verifying: "bg-primary/10 text-primary",
  Reported: "bg-slate-400/15 text-slate-600",
  Verified: "bg-primary/10 text-primary",
  Assigned: "bg-indigo-500/10 text-indigo-600",
  "In Progress": "bg-amber-500/10 text-amber-600",
  Resolved: "bg-secondary/10 text-secondary",
  Rejected: "bg-error/10 text-error",
};

export const Badge = ({ children, tone }) => (
  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${tone}`}>
    {children}
  </span>
);
export const PriorityBadge = ({ p }) => <Badge tone={PRIORITY[p] || PRIORITY.low}>{p}</Badge>;
export const StatusBadge = ({ s }) => <Badge tone={STATUS[s] || STATUS.Reported}>{s}</Badge>;

export const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-2xl p-5 shadow-sm shadow-blue-900/5 ${className}`}>{children}</div>
);

export const SectionLabel = ({ children }) => (
  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-variant mb-3">{children}</h3>
);

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-on-variant gap-3">
      <div className="w-8 h-8 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function VerificationChip({ issue }) {
  const m = issue.verification_method;
  const pct = Math.round((issue.verification_confidence || 0) * 100);
  if (m === "pending")
    return (
      <div className="flex items-center gap-1.5 text-primary text-xs font-semibold">
        <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        AI verifying…
      </div>
    );
  if (m === "vision")
    return (
      <div className="flex items-center gap-1.5 text-secondary text-xs font-semibold">
        <Icon name="verified" className="text-sm" fill />
        AI Verified · vision {pct}%
        {issue.detection_count > 1 && ` · ${issue.detection_count} detections`}
      </div>
    );
  if (m === "text")
    return (
      <div className="flex items-center gap-1.5 text-on-variant text-xs font-semibold">
        <Icon name="rule" className="text-sm" />
        Text-classified {pct}% · weaker signal
      </div>
    );
  return (
    <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold">
      <Icon name="pending" className="text-sm" /> Not verified
    </div>
  );
}

// Prominent 0–100 AI confidence meter (used on the issue page).
export function ConfidenceMeter({ issue }) {
  const m = issue.verification_method;
  if (m === "pending" || m === "none" || !m) return null;
  const score = Math.round((issue.verification_confidence || 0) * 100);
  const tone = score >= 75 ? "#059669" : score >= 55 ? "#0058bc" : "#ea580c";
  const label = m === "vision" ? "Vision-verified" : "Text-classified";
  const R = 26, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-4 bg-white rounded-2xl p-4 shadow-sm">
      <svg width="64" height="64" viewBox="0 0 64 64" className="flex-shrink-0 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} />
      </svg>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-variant">AI confidence</p>
        <p className="text-2xl font-black font-headline leading-none mt-1" style={{ color: tone }}>
          {score}<span className="text-sm text-on-variant font-bold">/100</span>
        </p>
        <p className="text-xs text-on-variant mt-0.5">
          {label}{issue.detection_count > 0 ? ` · ${issue.detection_count} detection(s)` : ""}
        </p>
      </div>
    </div>
  );
}

export function fmtAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="mx-4 mt-3 rounded-2xl p-3.5 flex items-center justify-between"
      style={{ background: "rgba(251,191,36,0.15)", backdropFilter: "blur(16px)" }}>
      <div className="flex items-center gap-3">
        <div className="bg-amber-500/20 p-2 rounded-full">
          <Icon name="cloud_off" className="text-amber-600" />
        </div>
        <div>
          <p className="text-amber-900 font-bold text-sm">Offline mode</p>
          <p className="text-amber-800/80 text-xs">Showing cached data — reports sync when you reconnect.</p>
        </div>
      </div>
      <div className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 rounded-full">
        <Icon name="sync" className="text-amber-600 text-sm" />
        <span className="text-[10px] font-black text-amber-700 uppercase">Queued</span>
      </div>
    </div>
  );
}

// Place-name search with live autocomplete (Photon geocoder).
export function GeoInput({ value, onChange, onPick, near, placeholder = "Search a place…", className = "" }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const t = useRef();
  const box = useRef();

  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function type(v) {
    onChange(v);
    clearTimeout(t.current);
    if (!v || v.trim().length < 3) { setResults([]); return; }
    setLoading(true);
    t.current = setTimeout(async () => {
      const r = await geocode(v, near?.lat, near?.lng);
      setResults(r); setOpen(true); setLoading(false);
    }, 320);
  }

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Icon name="location_on" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={value}
          onChange={(e) => type(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className={className || "w-full bg-white shadow-sm border-none rounded-2xl py-4 pl-12 pr-10 focus:ring-2 focus:ring-primary/30 outline-none"}
        />
        {loading && <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-[999] mt-1 left-0 right-0 bg-white rounded-2xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
          {results.map((r, n) => (
            <button key={n} type="button"
              onClick={() => { onChange(r.label); onPick?.(r); setOpen(false); }}
              className="w-full text-left px-4 py-3 hover:bg-surface-low flex items-start gap-2 border-b border-surface-high last:border-0">
              <Icon name="place" className="text-primary text-lg mt-0.5" />
              <span className="text-sm">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Editorial oversized headline: "Report" + accent "An Issue."
export const EditorialTitle = ({ top, accent, sub }) => (
  <div className="mb-8">
    <h1 className="text-[2.75rem] leading-[1.05] font-bold tracking-tight text-on-surface">
      {top}
      {accent && (
        <>
          <br />
          <span className="text-primary">{accent}</span>
        </>
      )}
    </h1>
    {sub && <p className="mt-3 text-on-variant font-medium">{sub}</p>}
  </div>
);