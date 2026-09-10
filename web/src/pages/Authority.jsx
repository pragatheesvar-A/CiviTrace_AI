// Authority Hub — Triage · Human Review · Fairness · AI Audit
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api, useLiveFeed, reviewQueue, reviewDecide, fairnessReport, authorityAudit,
  authorityAnalytics,
} from "../api.jsx";
import {
  Icon, Spinner, PriorityBadge, StatusBadge, VerificationChip, ConsistencyBadge,
  AuditTimeline, fmtAgo,
} from "../ui.jsx";
import { Panel, Empty, KpiCard, LineChart, BarChart, DonutChart } from "../charts.jsx";

const TABS = [
  ["analytics", "Analytics", "monitoring"],
  ["triage", "Triage", "inbox"],
  ["review", "Review Queue", "gavel"],
  ["fairness", "Fairness", "balance"],
  ["audit", "AI Audit", "history"],
];
const RANGES = [["today", "Today"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"], ["all", "All"]];
const CAT_COLOR = "#0d5c63";
const STATUS_COLORS = {
  Reported: "#8a8b83", Verifying: "#8a8b83", Verified: "#0d5c63", Assigned: "#3f6f8f",
  "In Progress": "#c2703d", "AI Verified — Awaiting Confirmation": "#12868f",
  Resolved: "#1f7a4d", "Verified Closed": "#1f7a4d", Rejected: "#c0362c",
};

export default function Authority() {
  const [tab, setTab] = useState("analytics");
  const [kpis, setKpis] = useState(null);
  const [queue, setQueue] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [fair, setFair] = useState(null);
  const [audit, setAudit] = useState(null);
  const [rain, setRain] = useState(40);
  const [twin, setTwin] = useState(null);
  const [range, setRange] = useState("30d");
  const [ana, setAna] = useState(null);

  const load = useCallback(() => {
    api("/authority/kpis").then(setKpis).catch(() => {});
    api("/authority/queue").then(setQueue).catch(() => {});
    reviewQueue().then(setReviews).catch(() => setReviews([]));
  }, []);
  const loadAna = useCallback((r) => {
    setAna(null);
    authorityAnalytics(r).then(setAna).catch(() => setAna({ error: true }));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAna(range); }, [range, loadAna]);
  useLiveFeed(useCallback(() => { load(); loadAna(range); }, [load, loadAna, range]));
  useEffect(() => { if (tab === "fairness" && !fair) fairnessReport().then(setFair).catch(() => setFair({ wards: [] })); }, [tab, fair]);
  useEffect(() => { if (tab === "audit" && !audit) authorityAudit().then(setAudit).catch(() => setAudit([])); }, [tab, audit]);
  useEffect(() => {
    const t = setTimeout(() => api("/authority/rainfall-twin", { method: "POST", body: { rainfall_mm: +rain } }).then(setTwin), 250);
    return () => clearTimeout(t);
  }, [rain]);

  const setStatus = async (id, status) => { await api(`/authority/issues/${id}/status`, { method: "POST", body: { status } }); load(); };
  const decide = async (rid, decision) => { await reviewDecide(rid, decision); load(); setAudit(null); };

  if (!kpis || !queue || !reviews) return <Spinner />;

  return (
    <div className="space-y-5 pb-6">
      <div>
        <h1 className="text-[2.3rem] leading-[1.05] font-bold tracking-tight">Authority<br /><span className="text-primary">Hub.</span></h1>
        <p className="text-on-variant text-xs mt-1">Evidence-Aware Civic Intelligence &amp; Resolution Platform</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Open" value={kpis.open} />
        <Kpi label="Human review" value={kpis.human_review_open} warn={kpis.human_review_open > 0} />
        <Kpi label="Awaiting citizen" value={kpis.awaiting_citizen_confirmation} />
        <Kpi label="Resolution rate" value={`${Math.round(kpis.resolution_rate * 100)}%`} />
        <Kpi label="Avg fix" value={kpis.avg_resolution_days != null ? `${kpis.avg_resolution_days}d` : "—"} />
        <Kpi label="Evid. trust" value={`${kpis.avg_evidence_trust || "—"}`} />
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {TABS.map(([k, label, ic]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5 ${tab === k ? "bg-primary text-white" : "bg-white shadow-sm card-line text-on-variant"}`}>
            <Icon name={ic} className="text-sm" />{label}
            {k === "review" && kpis.human_review_open > 0 && (
              <span className="bg-error text-white rounded-full text-[9px] px-1.5">{kpis.human_review_open}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "analytics" && (
        <AnalyticsView data={ana} range={range} setRange={setRange} />
      )}

      {tab === "triage" && (
        <>
          <div className="bg-white rounded-2xl p-4 shadow-sm card-line">
            <p className="text-xs font-bold uppercase tracking-widest text-on-variant mb-3">Open by category</p>
            {Object.entries(kpis.by_category).map(([c, n]) => (
              <div key={c} className="flex items-center gap-3 mb-2">
                <span className="text-sm w-24">{c}</span>
                <div className="flex-1 h-2 bg-surface-high rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, n * 20)}%` }} />
                </div>
                <span className="text-sm font-bold w-6 text-right">{n}</span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm card-line space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-on-variant">Rainfall digital twin <span className="text-slate-400">(surrogate)</span></p>
            <input type="range" min="0" max="150" value={rain} onChange={(e) => setRain(e.target.value)} className="w-full accent-primary" />
            <div className="flex justify-between text-sm">
              <span className="font-bold">{rain} mm rainfall</span>
              {twin && <span className="text-on-variant">risk: <b className="capitalize">{twin.flood_risk_level}</b></span>}
            </div>
            {twin && (
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-surface-low rounded-2xl p-3"><p className="text-2xl font-bold">{twin.projected_reports}</p><p className="text-xs text-on-variant">projected reports</p></div>
                <div className="bg-surface-low rounded-2xl p-3"><p className="text-2xl font-bold">{twin.recommended_crews}</p><p className="text-xs text-on-variant">recommended crews</p></div>
              </div>
            )}
          </div>

          <section className="space-y-3">
            <h2 className="text-xl font-bold">Triage queue</h2>
            {queue.map((i) => (
              <div key={i.id} className="bg-white rounded-2xl p-4 shadow-sm card-line space-y-2">
                <div className="flex gap-2 items-center flex-wrap">
                  <PriorityBadge p={i.priority} /><StatusBadge s={i.status} />
                  <ConsistencyBadge level={i.consistency} />
                  {i.in_human_review && <Icon name="gavel" className="text-orange-500 text-sm" />}
                  <span className="text-xs text-on-variant ml-auto">{fmtAgo(i.created_at)}</span>
                </div>
                <Link to={`/issues/${i.id}`} className="font-bold text-lg leading-tight block">{i.title}</Link>
                <p className="text-xs text-on-variant">{i.address} · {i.category} · Evidence trust {i.evidence_trust}/100</p>
                <VerificationChip issue={i} />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {["Assigned", "In Progress", "Resolved"].map((s) => (
                    <button key={s} onClick={() => setStatus(i.id, s)} className="px-2.5 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary">→ {s}</button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {tab === "review" && (
        <section className="space-y-3">
          <p className="text-sm text-on-variant">Cases where the AI was uncertain or signals conflicted. The citizen is never auto-rejected.</p>
          {reviews.length === 0 && <p className="text-sm text-on-variant py-6 text-center">Nothing waiting for review.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm card-line space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-orange-500/10 text-orange-600">{r.kind}</span>
                <ConsistencyBadge level={r.issue.consistency} />
                <span className="text-xs text-on-variant ml-auto">{fmtAgo(r.created_at)}</span>
              </div>
              <Link to={`/issues/${r.issue_id}`} className="font-bold leading-tight block">{r.issue.title}</Link>
              <div className="text-xs text-on-variant grid grid-cols-2 gap-1">
                <span>AI confidence: {r.ai_confidence}/100</span>
                <span>Evidence trust: {r.evidence_trust}/100</span>
              </div>
              {r.conflicts?.length > 0 && (
                <ul className="text-xs text-orange-600 space-y-0.5">
                  {r.conflicts.map((c, n) => <li key={n} className="flex gap-1"><Icon name="warning" className="text-xs mt-px" />{c}</li>)}
                </ul>
              )}
              <p className="text-xs text-on-variant border-l-2 border-orange-300 pl-2">{r.reason}</p>
              <p className="text-[11px] text-slate-400">Recommended: {r.recommended_action.replace(/_/g, " ")}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[["approve", "Approve"], ["reject", "Reject"], ["request_evidence", "Request evidence"], ["reopen", "Reopen"], ["escalate", "Escalate"]].map(([d, l]) => (
                  <button key={d} onClick={() => decide(r.id, d)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${d === "approve" ? "bg-secondary/15 text-secondary" : d === "reject" ? "bg-error/10 text-error" : "bg-primary/10 text-primary"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "fairness" && (!fair ? <Spinner /> : (
        <section className="space-y-3">
          <p className="text-sm text-on-variant">{fair.note}</p>
          {(fair.wards || []).map((w) => (
            <div key={w.ward} className={`bg-white rounded-2xl p-4 shadow-sm card-line ${w.possible_inequality ? "ring-1 ring-orange-400" : ""}`}>
              <div className="flex justify-between items-center">
                <p className="font-bold">{w.ward}</p>
                {w.possible_inequality && (
                  <span className="text-[10px] font-bold uppercase bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full">Possible service inequality</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-on-variant mt-2">
                <span>Total: <b className="text-on-surface">{w.total}</b></span>
                <span>Unresolved: <b className="text-on-surface">{w.unresolved}</b></span>
                <span>Critical open: <b className="text-on-surface">{w.critical_open}</b></span>
                <span>SLA breaches: <b className="text-on-surface">{w.sla_breaches}</b></span>
                <span>Avg response: <b className="text-on-surface">{w.avg_response_hours ?? "—"}h</b></span>
                <span>Avg resolution: <b className="text-on-surface">{w.avg_resolution_hours ?? "—"}h</b></span>
              </div>
            </div>
          ))}
        </section>
      ))}

      {tab === "audit" && (!audit ? <Spinner /> : (
        <section>
          <p className="text-sm text-on-variant mb-3">Every AI decision and human override — what, why, when, who.</p>
          <AuditTimeline rows={[...audit].reverse()} />
        </section>
      ))}
    </div>
  );
}

const Kpi = ({ label, value, warn }) => (
  <div className={`rounded-2xl p-3 shadow-sm card-line ${warn ? "bg-orange-500/10" : "bg-white"}`}>
    <p className={`text-xl font-black font-headline ${warn ? "text-orange-600" : ""}`}>{value}</p>
    <p className="text-[10px] text-on-variant uppercase tracking-wide">{label}</p>
  </div>
);

const day = (d) => d == null ? "—" : `${d}d`;
const pct = (v) => v == null ? "—" : `${v}%`;

function AnalyticsView({ data, range, setRange }) {
  const [areaOpen, setAreaOpen] = useState(null);
  if (data?.error) return <Empty text="Could not load analytics." />;
  if (!data) return <Spinner label="Crunching the numbers…" />;

  const k = data.kpis, ra = data.resolution_analytics, ts = data.time_series;
  const catRows = Object.entries(data.by_category).sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: CAT_COLOR }));
  const statusSlices = Object.entries(data.by_status)
    .map(([label, value]) => ({ label, value, color: STATUS_COLORS[label] || "#8a8b83" }));
  const priRows = Object.entries(data.by_priority)
    .map(([label, value]) => ({ label: label[0].toUpperCase() + label.slice(1), value }));
  const perfRows = Object.entries(data.resolution_perf).sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: "#c2703d" }));

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {RANGES.map(([v, l]) => (
          <button key={v} onClick={() => setRange(v)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${range === v ? "bg-primary text-white" : "bg-white card-line text-on-variant"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Total reports" value={k.total} />
        <KpiCard label="Verified" value={k.verified} tone="#0d5c63" />
        <KpiCard label="Resolved" value={k.resolved} tone="#1f7a4d" />
        <KpiCard label="Reopened" value={k.reopened} tone={k.reopened ? "#c2703d" : undefined} />
        <KpiCard label="Open" value={k.open} />
        <KpiCard label="In progress" value={k.in_progress} />
        <KpiCard label="High priority" value={k.high_priority} tone={k.high_priority ? "#c0362c" : undefined} />
        <KpiCard label="Community confirmations" value={k.community_confirmations} />
        <KpiCard label="Avg resolution" value={day(k.avg_resolution_days)} />
        <KpiCard label="Avg evidence trust" value={k.avg_evidence_trust ?? "—"} sub="/100" />
      </div>

      <Panel title="Issues reported over time" hint={`${ts.labels.length} days`}>
        <LineChart labels={ts.labels} series={[{ name: "Reported", data: ts.reported }]} />
      </Panel>

      <Panel title="Resolution trend" hint="resolved vs reopened">
        <LineChart labels={ts.labels} series={[
          { name: "Resolved", data: ts.resolved, color: "#1f7a4d" },
          { name: "Reopened", data: ts.reopened, color: "#c0362c" },
        ]} />
      </Panel>

      <Panel title="Issues by category">
        <BarChart rows={catRows} />
      </Panel>

      <Panel title="Status distribution">
        <DonutChart slices={statusSlices} />
      </Panel>

      <Panel title="Priority distribution">
        <BarChart rows={priRows.map((r) => ({
          ...r, color: { Critical: "#c0362c", High: "#c2703d", Medium: "#0d5c63", Low: "#8a8b83" }[r.label],
        }))} />
      </Panel>

      <Panel title="Resolution performance" hint="avg days to resolve, by category">
        <BarChart rows={perfRows} unit="d" />
      </Panel>

      <Panel title="Community validation" hint="citizen confirmations over time">
        <LineChart labels={data.community_validation.labels}
          series={[{ name: "Confirmations", data: data.community_validation.confirmations, color: "#12868f" }]} />
      </Panel>

      <Panel title="Resolution Analytics">
        {ra.total_resolved === 0 ? <Empty /> : (
          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
            <Stat2 label="Resolution rate" value={pct(ra.resolution_rate)} big />
            <Stat2 label="Avg resolution time" value={day(ra.avg_resolution_days)} big />
            <Stat2 label="AI-verified resolutions" value={ra.ai_verified_resolutions} />
            <Stat2 label="Citizen-confirmed" value={ra.citizen_confirmed_resolutions} />
            <Stat2 label="Successfully closed" value={ra.successfully_closed} />
            <Stat2 label="Reopened after resolution" value={ra.reopened_after_resolution} />
            <Stat2 label="Fastest resolution" value={day(ra.fastest_resolution_days)} />
            <Stat2 label="Slowest resolution" value={day(ra.slowest_resolution_days)} />
            <Stat2 label="Avg resolution confidence" value={ra.avg_resolution_confidence == null ? "—" : `${ra.avg_resolution_confidence}/100`} />
          </div>
        )}
      </Panel>

      <Panel title="Area-wise civic intelligence" hint="click an area for its breakdown">
        {data.area_performance.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto no-scrollbar -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-on-variant text-left">
                  <th className="py-1 pl-1">Area</th><th>Total</th><th>Open</th><th>Res.</th><th>Reop.</th><th className="pr-1 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.area_performance.map((a) => (
                  <React.Fragment key={a.area}>
                    <tr onClick={() => setAreaOpen(areaOpen === a.area ? null : a.area)}
                      className="border-t border-surface-high/60 active:bg-surface-low cursor-pointer">
                      <td className="py-1.5 pl-1 font-semibold">{a.area}</td>
                      <td>{a.total}</td><td>{a.open}</td><td>{a.resolved}</td>
                      <td className={a.reopened ? "text-orange-600 font-bold" : ""}>{a.reopened}</td>
                      <td className="pr-1 text-right font-bold" style={{ color: a.resolution_rate >= 70 ? "#1f7a4d" : a.resolution_rate >= 40 ? "#c2703d" : "#c0362c" }}>
                        {a.resolution_rate}%
                      </td>
                    </tr>
                    {areaOpen === a.area && (
                      <tr className="bg-surface-low">
                        <td colSpan={6} className="p-2 text-on-variant">
                          {a.total} issues · {a.open} open · {a.resolved} resolved · {a.reopened} reopened ·
                          avg fix {day(a.avg_resolution_days)} · mostly {a.dominant_priority} priority
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="AI Insights" hint="rule-based (prototype), generated from the data above">
        {data.insights.length === 0
          ? <Empty text="Not enough data for insights yet." />
          : (
            <ul className="space-y-2">
              {data.insights.map((ins, n) => (
                <li key={n} className="flex items-start gap-2 text-sm">
                  <Icon name="lightbulb" className="text-accent text-base mt-px" fill />
                  <span className="text-on-surface">{ins.text}</span>
                </li>
              ))}
            </ul>
          )}
      </Panel>

      <p className="text-[10px] text-slate-400 text-center">{data.note}</p>
    </div>
  );
}

const Stat2 = ({ label, value, big }) => (
  <div>
    <p className={`font-black font-headline ${big ? "text-2xl" : "text-lg"}`}>{value}</p>
    <p className="text-[11px] text-on-variant">{label}</p>
  </div>
);
