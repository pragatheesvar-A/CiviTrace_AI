// Converted from stitch mockup: offline_mode_state/ (OfflineBanner) + shared design-system primitives
import React, { useEffect, useState } from "react";

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
  Reported: "bg-slate-400/15 text-slate-600",
  Verified: "bg-primary/10 text-primary",
  Assigned: "bg-indigo-500/10 text-indigo-600",
  "In Progress": "bg-amber-500/10 text-amber-600",
  Resolved: "bg-secondary/10 text-secondary",
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