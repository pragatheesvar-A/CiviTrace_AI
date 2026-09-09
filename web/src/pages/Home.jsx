// Converted from stitch mockup: home_dashboard/
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useAuth, useLiveFeed } from "../api.jsx";
import { Icon, Card, Spinner, PriorityBadge, StatusBadge, VerificationChip, fmtAgo } from "../ui.jsx";

export default function Home() {
  const { user } = useAuth();
  const [issues, setIssues] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => api("/issues").then(setIssues).catch(() => setIssues([])), []);
  useEffect(load, [load]);
  useLiveFeed(useCallback(() => load(), [load]));

  if (!issues) return <Spinner />;

  const open = issues.filter((i) => i.status !== "Resolved");
  const resolved = issues.filter((i) => i.status === "Resolved");
  const filtered = open.filter(
    (i) => !q || i.title.toLowerCase().includes(q.toLowerCase()) || i.address.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-[2.5rem] leading-[1.05] font-bold tracking-tight">
          Hi, {user.name.split(" ")[0]} <span className="inline-block">👋</span>
        </h1>
        <p className="text-on-variant mt-2 font-medium opacity-75">
          {open.length} open issues nearby · {user.points} civic points
        </p>
      </section>

      <div className="relative">
        <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues or locations…"
          className="w-full bg-white shadow-sm border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-primary/30 outline-none" />
      </div>

      <section className="grid grid-cols-2 gap-3">
        <Tile to="/report" icon="add_circle" label="Report Issue" solid />
        <Tile to="/map" icon="map" label="Live Map" />
        <Link to="/assistant"
          className="col-span-2 p-5 rounded-2xl bg-gradient-to-br from-primary to-primary-container text-white shadow-lg shadow-primary/20 flex items-center justify-between overflow-hidden relative">
          <div className="absolute -right-8 -top-8 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
          <div className="flex items-center gap-3 relative">
            <Icon name="auto_awesome" className="text-3xl" fill />
            <div>
              <span className="font-bold text-lg block leading-none">AI Assistant</span>
              <span className="text-white/70 text-sm">File a report by chatting</span>
            </div>
          </div>
          <Icon name="chevron_right" />
        </Link>
        <Link to="/emergency"
          className="col-span-2 p-5 rounded-2xl bg-error text-white shadow-lg shadow-error/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon name="emergency" className="text-2xl" fill />
            <span className="font-bold text-lg">Emergency Help</span>
          </div>
          <Icon name="chevron_right" />
        </Link>
      </section>

      <section className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-2xl font-bold">Nearby Issues</h2>
          <Link to="/map" className="text-primary font-bold text-sm">View all</Link>
        </div>
        {filtered.length === 0 && <p className="text-on-variant text-sm">No matching issues.</p>}
        {filtered.map((i) => (
          <Link key={i.id} to={`/issues/${i.id}`}>
            <Card className="space-y-3">
              {i.photo_url && <img src={i.photo_url} alt="" className="w-full h-40 object-cover rounded-xl" />}
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge p={i.priority} />
                <StatusBadge s={i.status} />
                {i.cluster_count > 1 && (
                  <span className="text-xs font-bold text-on-variant flex items-center gap-1">
                    <Icon name="group_work" className="text-sm" />{i.cluster_count} reports
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">{i.title}</h3>
                <p className="text-on-variant text-sm mt-1 flex items-center gap-1">
                  <Icon name="location_on" className="text-sm" />
                  {i.address || `${i.lat.toFixed(3)}, ${i.lng.toFixed(3)}`} · {fmtAgo(i.created_at)}
                </p>
              </div>
              <div className="flex justify-between items-center">
                <VerificationChip issue={i} />
                <span className="text-sm font-bold text-on-variant flex items-center gap-1">
                  <Icon name="arrow_upward" className="text-sm" />{i.upvotes}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      {resolved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl font-bold">Resolved recently</h2>
          {resolved.slice(0, 4).map((i) => (
            <Link key={i.id} to={`/issues/${i.id}`}>
              <div className="bg-secondary/5 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-secondary/15 flex items-center justify-center text-secondary flex-shrink-0">
                  <Icon name="check_circle" fill />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">
                    Fixed {fmtAgo(i.resolved_at)}
                  </span>
                  <h3 className="font-bold">{i.title}</h3>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

const Tile = ({ to, icon, label, solid }) => (
  <Link to={to}
    className={`p-5 rounded-2xl h-32 flex flex-col justify-between active:scale-[0.98] transition-transform ${
      solid ? "bg-primary text-white shadow-lg shadow-primary/20" : "glass border border-white/50"
    }`}>
    <Icon name={icon} className={`text-3xl ${solid ? "" : "text-primary"}`} fill={solid} />
    <span className={`font-bold text-lg leading-none ${solid ? "" : "text-on-surface"}`}>{label}</span>
  </Link>
);