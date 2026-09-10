// Converted from stitch mockup: authority_admin_hub/
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useLiveFeed } from "../api.jsx";
import { Icon, Spinner, PriorityBadge, StatusBadge, VerificationChip, fmtAgo } from "../ui.jsx";

export default function Authority() {
  const [kpis, setKpis] = useState(null);
  const [queue, setQueue] = useState(null);
  const [rain, setRain] = useState(40);
  const [twin, setTwin] = useState(null);

  const load = useCallback(() => {
    api("/authority/kpis").then(setKpis).catch(() => {});
    api("/authority/queue").then(setQueue).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveFeed(useCallback(() => load(), [load]));

  useEffect(() => {
    const t = setTimeout(
      () => api("/authority/rainfall-twin", { method: "POST", body: { rainfall_mm: +rain } }).then(setTwin),
      250
    );
    return () => clearTimeout(t);
  }, [rain]);

  async function setStatus(id, status) {
    await api(`/authority/issues/${id}/status`, { method: "POST", body: { status } });
    load();
  }

  if (!kpis || !queue) return <Spinner />;

  return (
    <div className="space-y-6 pb-6">
      <h1 className="text-[2.5rem] leading-[1.05] font-bold tracking-tight">Authority<br/><span className="text-primary">Hub.</span></h1>

      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Open" value={kpis.open} icon="inbox" />
        <Kpi label="Resolved" value={kpis.resolved} icon="task_alt" />
        <Kpi label="Resolution rate" value={`${Math.round(kpis.resolution_rate * 100)}%`} icon="trending_up" />
        <Kpi label="Avg fix time" value={kpis.avg_resolution_days != null ? `${kpis.avg_resolution_days}d` : "—"} icon="schedule" />
        <Kpi label="Verified (open)" value={`${Math.round(kpis.verified_open_share * 100)}%`} icon="verified" />
        <Kpi label="Clusters" value={kpis.clusters} icon="group_work" />
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-on-variant mb-3">Open by category</p>
        {Object.entries(kpis.by_category).map(([c, n]) => (
          <div key={c} className="flex items-center gap-3 mb-2">
            <span className="text-sm w-32">{c}</span>
            <div className="flex-1 h-2 bg-surface-high rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, n * 20)}%` }} />
            </div>
            <span className="text-sm font-bold w-6 text-right">{n}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-on-variant">Rainfall digital twin</p>
        <input type="range" min="0" max="150" value={rain} onChange={(e) => setRain(e.target.value)}
          className="w-full accent-primary" />
        <div className="flex justify-between text-sm">
          <span className="font-bold">{rain} mm rainfall</span>
          {twin && <span className="text-on-variant">risk: <b className="capitalize">{twin.flood_risk_level}</b></span>}
        </div>
        {twin && (
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-surface-low rounded-2xl p-3">
              <p className="text-2xl font-bold">{twin.projected_reports}</p>
              <p className="text-xs text-on-variant">projected drainage reports</p>
            </div>
            <div className="bg-surface-low rounded-2xl p-3">
              <p className="text-2xl font-bold">{twin.recommended_crews}</p>
              <p className="text-xs text-on-variant">recommended crews</p>
            </div>
          </div>
        )}
        {twin && <p className="text-[11px] text-on-variant">{twin.note}</p>}
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold">Triage queue</h2>
        {queue.map((i) => (
          <div key={i.id} className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <PriorityBadge p={i.priority} />
              <StatusBadge s={i.status} />
              {i.cluster_count > 1 && (
                <span className="text-xs font-bold text-on-variant flex items-center gap-1">
                  <Icon name="group_work" className="text-sm" /> {i.cluster_count}
                </span>
              )}
              <span className="text-xs text-on-variant ml-auto">{fmtAgo(i.created_at)}</span>
            </div>
            <Link to={`/issues/${i.id}`} className="font-bold text-lg leading-tight block">{i.title}</Link>
            <p className="text-xs text-on-variant">{i.address} · {i.category} · ▲ {i.upvotes}</p>
            <VerificationChip issue={i} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["Assigned", "In Progress", "Resolved"].map((s) => (
                <button key={s} onClick={() => setStatus(i.id, s)}
                  className="px-2.5 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary">
                  → {s}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const Kpi = ({ label, value, icon }) => (
  <div className="bg-white rounded-2xl p-4 shadow-sm">
    <Icon name={icon} className="text-primary text-xl" />
    <p className="text-2xl font-bold mt-1">{value}</p>
    <p className="text-xs text-on-variant">{label}</p>
  </div>
);