import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useAuth, useLiveFeed } from "../api.jsx";
import { Icon, Card, Spinner, PriorityBadge, StatusBadge, VerificationChip, fmtAgo } from "../ui.jsx";

export default function Home() {
  const { user } = useAuth();
  const [issues, setIssues] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    api("/issues").then(setIssues).catch(() => setIssues([]));
  }, []);
  useEffect(load, [load]);
  useLiveFeed(useCallback(() => load(), [load]));

  if (!issues) return <Spinner />;

  const open = issues.filter((i) => i.status !== "Resolved");
  const resolved = issues.filter((i) => i.status === "Resolved");
  const filtered = open.filter(
    (i) =>
      !q ||
      i.title.toLowerCase().includes(q.toLowerCase()) ||
      i.address.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-4xl font-bold leading-tight">Hi, {user.name.split(" ")[0]} 👋</h1>
        <p className="text-on-variant mt-1 opacity-70">
          {open.length} open issues in your city · {user.points} civic points
        </p>
      </section>

      <div className="relative">
        <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search issues or locations…"
          className="w-full bg-surface-high/60 border-none rounded-lg py-4 pl-12 pr-4 focus:ring-2 focus:ring-primary"
        />
      </div>

      <section className="grid grid-cols-2 gap-3">
        <Link to="/report" className="p-5 bg-primary rounded-lg text-white h-32 flex flex-col justify-between">
          <Icon name="add_circle" className="text-3xl" />
          <span className="font-bold text-lg leading-none">Report Issue</span>
        </Link>
        <Link to="/map" className="p-5 glass rounded-lg h-32 flex flex-col justify-between border border-white/50">
          <Icon name="map" className="text-3xl text-primary" />
          <span className="font-bold text-lg leading-none">Live Map</span>
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
              {i.photo_url && (
                <img src={i.photo_url} alt="" className="w-full h-40 object-cover rounded-lg" />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge p={i.priority} />
                <StatusBadge s={i.status} />
                {i.cluster_count > 1 && (
                  <span className="text-xs font-bold text-on-variant flex items-center gap-1">
                    <Icon name="group_work" className="text-sm" />
                    {i.cluster_count} reports
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">{i.title}</h3>
                <p className="text-on-variant text-sm mt-1 flex items-center gap-1">
                  <Icon name="location_on" className="text-sm" />
                  {i.address || `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`} · {fmtAgo(i.created_at)}
                </p>
              </div>
              <div className="flex justify-between items-center">
                <VerificationChip issue={i} />
                <span className="text-sm font-bold text-on-variant flex items-center gap-1">
                  <Icon name="arrow_upward" className="text-sm" />
                  {i.upvotes}
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
              <div className="bg-secondary/5 rounded-lg p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-secondary/15 flex items-center justify-center text-secondary flex-shrink-0">
                  <Icon name="check_circle" />
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
