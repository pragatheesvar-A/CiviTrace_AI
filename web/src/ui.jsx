import React from "react";

export const Icon = ({ name, className = "" }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
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
  <div className={`bg-white rounded-lg p-5 shadow-sm shadow-blue-900/5 ${className}`}>{children}</div>
);

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-on-variant gap-3">
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function VerificationChip({ issue }) {
  const m = issue.verification_method;
  if (m === "vision")
    return (
      <div className="flex items-center gap-1.5 text-secondary text-xs font-semibold">
        <Icon name="verified" className="text-sm" />
        AI Verified · vision {Math.round(issue.verification_confidence * 100)}%
        {issue.detection_count > 1 && ` · ${issue.detection_count} detections`}
      </div>
    );
  if (m === "text")
    return (
      <div className="flex items-center gap-1.5 text-on-variant text-xs font-semibold">
        <Icon name="rule" className="text-sm" />
        Text-classified {Math.round(issue.verification_confidence * 100)}% (weaker signal)
      </div>
    );
  return (
    <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold">
      <Icon name="pending" className="text-sm" /> Not verified
    </div>
  );
}

export function fmtAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
