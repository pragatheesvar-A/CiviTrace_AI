import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useAuth } from "../api.jsx";
import { Icon, Spinner, StatusBadge, fmtAgo } from "../ui.jsx";

export default function Profile() {
  const { user } = useAuth();
  const [tab, setTab] = useState("mine");
  const [mine, setMine] = useState(null);
  const [board, setBoard] = useState(null);
  const [wall, setWall] = useState(null);

  useEffect(() => {
    api("/issues?mine=true").then(setMine).catch(() => setMine([]));
    api("/leaderboard").then(setBoard).catch(() => setBoard([]));
    api("/proof-wall").then(setWall).catch(() => setWall([]));
  }, []);

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white text-2xl font-bold">
          {user.name[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <p className="text-on-variant text-sm capitalize">{user.role}</p>
        </div>
      </div>

      <div className="bg-gradient-to-br from-primary to-primary-container rounded-lg p-5 text-white">
        <p className="text-white/70 text-xs uppercase tracking-widest font-bold">Civic points</p>
        <p className="text-4xl font-bold mt-1">{user.points}</p>
        <p className="text-white/80 text-sm mt-1">Redeemable against city rewards</p>
      </div>

      <div className="flex gap-2">
        {["mine", "leaderboard", "proof"].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-sm font-bold capitalize ${
              tab === t ? "bg-primary text-white" : "bg-white text-on-variant"
            }`}>
            {t === "mine" ? "My reports" : t}
          </button>
        ))}
      </div>

      {tab === "mine" && (!mine ? <Spinner /> : (
        <div className="space-y-3">
          {mine.length === 0 && <p className="text-on-variant text-sm">No reports yet.</p>}
          {mine.map((i) => (
            <Link key={i.id} to={`/issues/${i.id}`}>
              <div className="bg-white rounded-lg p-4 shadow-sm flex justify-between items-center">
                <div>
                  <h3 className="font-bold">{i.title}</h3>
                  <p className="text-xs text-on-variant">{i.category} · {fmtAgo(i.created_at)}</p>
                </div>
                <StatusBadge s={i.status} />
              </div>
            </Link>
          ))}
        </div>
      ))}

      {tab === "leaderboard" && (!board ? <Spinner /> : (
        <div className="space-y-2">
          {board.map((r) => (
            <div key={r.rank} className={`rounded-lg p-4 flex items-center gap-4 ${
              r.name === user.name ? "bg-primary/10" : "bg-white shadow-sm"
            }`}>
              <span className="text-lg font-bold text-on-variant w-6">{r.rank}</span>
              <span className="flex-1 font-semibold">{r.name}</span>
              <span className="font-bold text-primary">{r.points}</span>
            </div>
          ))}
        </div>
      ))}

      {tab === "proof" && (!wall ? <Spinner /> : (
        <div className="space-y-4">
          {wall.length === 0 && <p className="text-on-variant text-sm">No resolved issues yet.</p>}
          {wall.map((w) => (
            <div key={w.id} className="bg-white rounded-lg p-4 shadow-sm space-y-2">
              <div className="flex items-center gap-2">
                <Icon name="check_circle" className="text-secondary" />
                <h3 className="font-bold">{w.title}</h3>
              </div>
              <p className="text-xs text-on-variant">{w.address} · fixed {w.resolved_at && fmtAgo(w.resolved_at)}</p>
              <div className="grid grid-cols-2 gap-2">
                {w.before ? <img src={w.before} className="h-24 w-full object-cover rounded" alt="before" />
                  : <div className="h-24 bg-surface-high rounded grid place-items-center text-xs text-on-variant">no before photo</div>}
                {w.after ? <img src={w.after} className="h-24 w-full object-cover rounded" alt="after" />
                  : <div className="h-24 bg-secondary/10 rounded grid place-items-center text-xs text-secondary">awaiting after photo</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
