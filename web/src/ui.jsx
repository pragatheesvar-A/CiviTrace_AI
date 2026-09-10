// Converted from stitch mockup: offline_mode_state/ (OfflineBanner) + shared design-system primitives
import React, { useEffect, useRef, useState } from "react";
import { geocode, reverseGeocode, useArea, useLang, getLang, useConfig } from "./api.jsx";

export const Icon = ({ name, className = "", fill = false, ...rest }) => (
  <span className={`material-symbols-outlined ${fill ? "fill" : ""} ${className}`} {...rest}>{name}</span>
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
  "AI Verified — Awaiting Confirmation": "bg-teal-500/10 text-primary",
  Resolved: "bg-secondary/10 text-secondary",
  "Verified Closed": "bg-secondary/15 text-secondary",
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
  <div className={`bg-white rounded-2xl p-5 shadow-sm card-line ${className}`}>{children}</div>
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

// Report-authenticity ("is this real?") chip.
export function AuthenticityChip({ issue }) {
  const a = issue.authenticity || {};
  const score = Math.round((issue.authenticity_score || 0) * 100);
  if (!score && !a.label) return null;
  const tone = score >= 70 ? { c: "#059669", b: "bg-secondary/10", i: "shield_person" }
    : score >= 45 ? { c: "#0058bc", b: "bg-primary/10", i: "gpp_maybe" }
      : { c: "#ea580c", b: "bg-orange-500/10", i: "gpp_bad" };
  return (
    <div className={`rounded-2xl p-3.5 ${tone.b}`}>
      <div className="flex items-center gap-2">
        <Icon name={tone.i} className="text-lg" style={{ color: tone.c }} fill />
        <span className="text-sm font-bold" style={{ color: tone.c }}>
          Authenticity {score}/100 · {a.label || "—"}
        </span>
      </div>
      {Array.isArray(a.flags) && a.flags.length > 0 && (
        <ul className="mt-1.5 ml-1 space-y-0.5">
          {a.flags.map((f, n) => (
            <li key={n} className="text-xs text-on-variant flex items-start gap-1">
              <Icon name="chevron_right" className="text-xs mt-0.5" />{f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecurrenceBanner({ issue }) {
  if (!issue.recurrence) return null;
  return (
    <div className="rounded-2xl p-4 flex items-start gap-3"
      style={{ background: "rgba(234,88,12,0.10)" }}>
      <Icon name="history" className="text-orange-600 text-xl mt-0.5" fill />
      <div>
        <p className="font-bold text-orange-700 text-sm">Chronic location</p>
        <p className="text-xs text-orange-800/80 mt-0.5">
          This spot has been reported {issue.recurrence_count || 2}× and fixed before
          {issue.recurrence_of ? ` (last: #${issue.recurrence_of})` : ""}. Priority was escalated automatically.
        </p>
      </div>
    </div>
  );
}

export function EtaChip({ days }) {
  if (days == null) return null;
  const txt = days <= 1 ? "~1 day" : days < 14 ? `~${Math.round(days)} days` : `~${Math.round(days / 7)} weeks`;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-on-variant">
      <Icon name="schedule" className="text-sm" /> Est. fix {txt}
    </span>
  );
}

// Compact list of nearby issues with distance — reused on Map + Report.
export function NearbyList({ items, onOpen, emptyText = "No issues reported here yet." }) {
  if (!items || items.length === 0)
    return <p className="text-sm text-on-variant py-2">{emptyText}</p>;
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={() => onOpen?.(i)}
          className="w-full text-left bg-white/80 rounded-xl p-3 flex gap-3 items-center active:scale-[0.99] transition-transform">
          {i.photo_url
            ? <img src={i.photo_url} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" alt="" />
            : <div className="w-11 h-11 rounded-lg bg-surface-high grid place-items-center flex-shrink-0"><Icon name="place" className="text-slate-400" /></div>}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <PriorityBadge p={i.priority} />
              {i.status === "Resolved" && <span className="text-[10px] font-bold text-secondary uppercase">fixed</span>}
              {i.likely_duplicate && <span className="text-[10px] font-bold text-orange-600 uppercase">likely same</span>}
            </div>
            <p className="text-sm font-bold leading-tight truncate mt-0.5">{i.title}</p>
            <p className="text-xs text-on-variant">{i.distance_m} m away · {i.category}</p>
          </div>
          <Icon name="chevron_right" className="text-slate-300" />
        </button>
      ))}
    </div>
  );
}

// Horizontal step indicator for a guided flow.
export function Stepper({ steps, current }) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, n) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold transition-colors ${
              n < current ? "bg-secondary text-white" : n === current ? "bg-primary text-white" : "bg-surface-high text-slate-400"}`}>
              {n < current ? "✓" : n + 1}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-wide ${n === current ? "text-primary" : "text-slate-400"}`}>{s}</span>
          </div>
          {n < steps.length - 1 && <div className={`flex-1 h-0.5 rounded ${n < current ? "bg-secondary" : "bg-surface-high"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---- Evidence Trust Score (0–100) + checklist ----
const _CHK = { pass: ["check_circle", "#1f7a4d"], warn: ["warning", "#c2703d"], info: ["info", "#565750"], unknown: ["help", "#565750"] };
export function EvidenceTrust({ data }) {
  if (!data) return null;
  const s = data.trust_score ?? 0;
  const tone = s >= 70 ? "#1f7a4d" : s >= 45 ? "#0d5c63" : "#c2703d";
  const R = 26, C = 2 * Math.PI * R;
  const review = data.verdict === "needs_human_review";
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm card-line space-y-3">
      <div className="flex items-center gap-4">
        <svg width="64" height="64" viewBox="0 0 64 64" className="flex-shrink-0 -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="#e2e0d6" strokeWidth="6" />
          <circle cx="32" cy="32" r={R} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - s / 100)} />
        </svg>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-variant">Evidence Trust</p>
          <p className="text-2xl font-black font-headline leading-none mt-1" style={{ color: tone }}>
            {s}<span className="text-sm text-on-variant font-bold">/100</span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: review ? "#c2703d" : "#565750" }}>
            {review ? "Needs Human Review" : "Evidence looks consistent"}
            {data.consistency ? ` · ${data.consistency} consistency` : ""}
          </p>
        </div>
      </div>
      {Array.isArray(data.checklist) && data.checklist.length > 0 && (
        <ul className="space-y-1.5">
          {data.checklist.map((c, n) => {
            const [ic, col] = _CHK[c.status] || _CHK.info;
            return (
              <li key={n} className="flex items-start gap-2 text-xs">
                <Icon name={ic} className="text-sm mt-px" style={{ color: col }} fill />
                <span><span className="text-on-surface">{c.label}</span>
                  {c.detail ? <span className="text-on-variant"> — {c.detail}</span> : null}</span>
              </li>
            );
          })}
        </ul>
      )}
      {data.prototype && <p className="text-[10px] text-slate-400">Heuristic prototype · scores illustrative (Not Yet Measured)</p>}
    </div>
  );
}

export function ConsistencyBadge({ level }) {
  if (!level) return null;
  const m = { high: ["bg-secondary/10 text-secondary", "High consistency"],
    medium: ["bg-primary/10 text-primary", "Medium consistency"],
    low: ["bg-orange-500/10 text-orange-600", "Low consistency"] }[level] || ["bg-surface-high text-on-variant", level];
  return <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${m[0]}`}>{m[1]}</span>;
}

export function ResolutionCard({ issue }) {
  if (!issue.resolution_confidence && !issue.resolution_note) return null;
  const c = issue.resolution_confidence || 0;
  const tone = c >= 70 ? "#1f7a4d" : "#c2703d";
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm card-line">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-variant">Resolution Confidence</p>
        <span className="text-lg font-black font-headline" style={{ color: tone }}>{c}/100</span>
      </div>
      <p className="text-xs text-on-variant mt-1.5">{issue.resolution_note}</p>
    </div>
  );
}

// Explainable priority breakdown for authority users.
export function PriorityBreakdown({ issue }) {
  const pe = issue.priority_explanation || {};
  const score = Math.round((issue.priority_score || 0) * 100);
  const sev = issue.severity ? Math.round(issue.severity * 100)
    : issue.detection_count >= 2 ? 75 : issue.verified ? 55 : 35;
  const evid = issue.evidence_trust || Math.round((issue.verification_confidence || 0) * 100) || 40;
  const community = Math.min(100, (issue.upvotes || 0) * 12 + Math.max(0, (issue.cluster_count || 1) - 1) * 18);
  const ageDays = pe.contributions?.issue_age_days || 0;
  const persistence = Math.min(100, 30 + ageDays * 4 + (issue.recurrence ? 40 : 0));
  const impact = /school|hospital|child|market|junction|highway/i.test(
    `${issue.title} ${issue.description} ${issue.address}`) ? 92
    : ["Flooding", "Electricity", "Safety", "Traffic"].includes(issue.category) ? 78 : 55;
  const rows = [
    ["Severity", sev], ["Evidence confidence", evid], ["Community confirmation", community],
    ["Persistence / age", persistence], ["Public impact", impact],
  ];
  const tone = (v) => v >= 75 ? "#c0362c" : v >= 50 ? "#c2703d" : "#0d5c63";
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm card-line">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-variant">Priority breakdown</p>
        <span className="text-lg font-black font-headline">{score}<span className="text-xs text-on-variant">/100</span></span>
      </div>
      <div className="space-y-1.5">
        {rows.map(([label, v]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[11px] w-32 shrink-0 text-on-variant">{label}</span>
            <div className="flex-1 h-2.5 bg-surface-high rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${v}%`, background: tone(v) }} />
            </div>
            <span className="text-[11px] font-bold w-7 text-right">{Math.round(v)}</span>
          </div>
        ))}
      </div>
      {Array.isArray(pe.rule_overrides) && pe.rule_overrides.length > 0 && (
        <ul className="mt-2 pt-2 border-t border-surface-high space-y-0.5">
          {pe.rule_overrides.map((r, n) => (
            <li key={n} className="text-[11px] text-on-variant flex items-start gap-1">
              <Icon name="rule" className="text-xs mt-px text-primary" />{r}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-400 mt-2">
        {pe.method || "model+rules"} · transparent scoring (prototype — components illustrative)
      </p>
    </div>
  );
}

export function AuditTimeline({ rows }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-on-variant">No history yet.</p>;
  const icon = (a) => a.startsWith("ai.") ? "smart_toy" : a.includes("status") ? "flag"
    : a.includes("review") ? "gavel" : a.includes("confirm") ? "how_to_reg" : a.includes("reopen") ? "replay" : "bolt";
  return (
    <ol className="relative border-l-2 border-surface-high ml-2 space-y-4">
      {rows.map((r, n) => (
        <li key={n} className="ml-4">
          <span className="absolute -left-[9px] w-4 h-4 rounded-full bg-white border-2 border-primary/50 flex items-center justify-center" />
          <div className="flex items-center gap-2">
            <Icon name={icon(r.action)} className="text-sm text-primary" fill />
            <span className="text-sm font-bold">{r.what}</span>
          </div>
          {r.why && <p className="text-xs text-on-variant mt-0.5">Why: {r.why}</p>}
          <p className="text-[11px] text-slate-400 mt-0.5">
            {new Date(r.ts).toLocaleString()} · {r.actor}
            {r.overruled_by ? ` · overruled by ${r.overruled_by}` : ""}
          </p>
        </li>
      ))}
    </ol>
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

// Language picker — sets the speech-recognition language + a few UI strings.
export function LangPicker({ compact }) {
  const cfg = useConfig();
  const [lang, setLang] = useLang();
  const langs = cfg?.languages || [{ code: "en-IN", label: "English", native: "English" }];
  const cur = langs.find((l) => l.code === lang) || langs[0];
  return (
    <label className={`inline-flex items-center gap-1.5 ${compact ? "" : "bg-white card-line rounded-full px-3 py-2"}`}>
      <Icon name="translate" className="text-primary text-base" />
      <select value={lang} onChange={(e) => setLang(e.target.value)}
        className="bg-transparent border-none text-sm font-semibold outline-none focus:ring-0 pr-1"
        aria-label="Language">
        {langs.map((l) => (
          <option key={l.code} value={l.code}>{l.native}{l.native !== l.label ? ` · ${l.label}` : ""}</option>
        ))}
      </select>
      {compact && cur && <span className="sr-only">{cur.label}</span>}
    </label>
  );
}

// Voice capture button — uses the browser's on-device Web Speech API.
// onResult(finalText) fires when the user stops speaking.
export function VoiceButton({ onResult, onInterim, label = "Speak", className = "" }) {
  const [lang] = useLang();
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.lang = lang || getLang();
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onresult = (e) => {
      let finalT = "", interimT = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalT += tr; else interimT += tr;
      }
      if (interimT) onInterim?.(interimT);
      if (finalT) onResult?.(finalT.trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, [lang, onResult, onInterim]);

  if (!supported) {
    return (
      <p className="text-xs text-on-variant flex items-center gap-1">
        <Icon name="mic_off" className="text-sm" /> Voice input isn't available in this browser — please type instead.
      </p>
    );
  }
  const toggle = () => {
    const r = recRef.current;
    if (!r) return;
    if (listening) { try { r.stop(); } catch {} setListening(false); return; }
    try { r.lang = getLang(); r.start(); setListening(true); } catch {}
  };
  return (
    <button type="button" onClick={toggle}
      className={className || `flex items-center gap-2 px-4 py-2.5 rounded-full font-bold text-sm transition-colors ${
        listening ? "bg-error text-white" : "bg-primary text-white"}`}>
      <span className={`relative flex items-center justify-center ${listening ? "sos-pulse rounded-full" : ""}`}>
        <Icon name={listening ? "graphic_eq" : "mic"} className="text-lg" fill />
      </span>
      {listening ? "Listening…" : label}
    </button>
  );
}

// "My area" selector — the community whose civic feed the citizen is viewing.
export function AreaBar() {
  const [area, setArea] = useArea();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function useGps() {
    setBusy(true);
    navigator.geolocation?.getCurrentPosition(async (p) => {
      const lat = +p.coords.latitude.toFixed(6), lng = +p.coords.longitude.toFixed(6);
      const label = (await reverseGeocode(lat, lng)) || "My location";
      setArea({ label, lat, lng }); setBusy(false); setOpen(false);
    }, () => setBusy(false), { timeout: 8000 });
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-white card-line rounded-full px-4 py-2.5 active:scale-[0.99] transition-transform">
        <Icon name="pin_drop" className="text-primary text-lg" fill />
        <span className="flex-1 text-left text-sm font-semibold truncate">
          {area ? area.label.split(",").slice(0, 2).join(", ") : "Choose your area"}
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-[900] left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl card-line p-3 space-y-2">
          <GeoInput value={q} onChange={setQ}
            onPick={(r) => { setArea({ label: r.label, lat: r.lat, lng: r.lng }); setOpen(false); setQ(""); }}
            placeholder="Search your locality / community…"
            className="w-full bg-surface-low border-none rounded-xl py-3 pl-11 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={useGps} disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-bold">
            <Icon name="my_location" className="text-base" /> {busy ? "Locating…" : "Use my current location"}
          </button>
          {area && (
            <button onClick={() => { setArea(null); setOpen(false); }}
              className="w-full py-2 text-xs font-bold text-on-variant">Show all areas</button>
          )}
        </div>
      )}
    </div>
  );
}

// distance in metres between two lat/lng points (haversine)
export function metresBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
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