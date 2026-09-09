import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useAuth } from "../api.jsx";
import { Icon, Spinner, StatusBadge, SectionLabel, fmtAgo } from "../ui.jsx";

export default function Profile() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("mine");
  const [mine, setMine] = useState(null);
  const [board, setBoard] = useState(null);
  const [wall, setWall] = useState(null);

  useEffect(() => {
    api("/issues?mine=true").then(setMine).catch(() => setMine([]));
    api("/leaderboard").then(setBoard).catch(() => setBoard([]));
    api("/proof-wall").then(setWall).catch(() => setWall([]));
  }, []);

  const reported = mine?.length ?? 0;
  const resolved = mine?.filter((i) => i.status === "Resolved").length ?? 0;
  const rank = board?.find((r) => r.name === user.name)?.rank;

  return (
    <div className="space-y-8">
      <section className="flex flex-col items-center text-center space-y-4 pt-2">
        <div className="relative">
          <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white text-4xl font-black font-headline rotate-3 shadow-2xl ring-4 ring-white">
            {user.name[0]}
          </div>
          <div className="absolute -bottom-2 -right-2 bg-gradient-to-br from-primary to-primary-container text-white px-3 py-1 rounded-full text-[11px] font-bold shadow-lg flex items-center gap-1">
            <Icon name="verified" className="text-xs" fill />
            {user.points} pts
          </div>
        </div>
        <div>
          <h1 className="text-3xl font-bold font-headline tracking-tight">{user.name}</h1>
          <p className="text-on-variant font-medium capitalize">
            {user.role}{rank ? ` · #${rank} in your city` : ""}
          </p>
        </div>
      </section>

      <section className="bg-gradient-to-br from-primary/5 to-primary-container/10 p-6 rounded-2xl relative overflow-hidden">
        <div className="absolute top-2 right-2 opacity-10">
          <Icon name="analytics" className="text-[90px]" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-4">Contribution stats</p>
        <div className="flex gap-10 items-end">
          <div><span className="block text-4xl font-bold font-headline">{reported}</span><span className="text-sm text-on-variant">Reported</span></div>
          <div><span className="block text-4xl font-bold font-headline text-secondary">{resolved}</span><span className="text-sm text-on-variant">Resolved</span></div>
        </div>
        <div className="mt-6 h-2 bg-surface-high rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
            style={{ width: `${reported ? Math.round((resolved / reported) * 100) : 0}%` }} />
        </div>
      </section>

      <div className="flex gap-2">
        {["mine", "leaderboard", "proof"].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-sm font-bold capitalize ${tab === t ? "bg-primary text-white" : "bg-white text-on-variant shadow-sm"}`}>
            {t === "mine" ? "My reports" : t}
          </button>
        ))}
      </div>

      {tab === "mine" && (!mine ? <Spinner /> : (
        <div className="space-y-3">
          {mine.length === 0 && <p className="text-on-variant text-sm">No reports yet.</p>}
          {mine.map((i) => (
            <Link key={i.id} to={`/issues/${i.id}`}>
              <div className="bg-white rounded-2xl p-4 shadow-sm flex justify-between items-center">
                <div><h3 className="font-bold">{i.title}</h3><p className="text-xs text-on-variant">{i.category} · {fmtAgo(i.created_at)}</p></div>
                <StatusBadge s={i.status} />
              </div>
            </Link>
          ))}
        </div>
      ))}

      {tab === "leaderboard" && (!board ? <Spinner /> : (
        <div className="space-y-2">
          {board.map((r) => (
            <div key={r.rank} className={`rounded-2xl p-4 flex items-center gap-4 ${r.name === user.name ? "bg-primary/10" : "bg-white shadow-sm"}`}>
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
            <div key={w.id} className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center gap-2">
                <Icon name="check_circle" className="text-secondary" fill /><h3 className="font-bold">{w.title}</h3>
              </div>
              <p className="text-xs text-on-variant">{w.address} · fixed {fmtAgo(w.resolved_at)}</p>
              <div className="grid grid-cols-2 gap-2">
                {w.before ? <img src={w.before} className="h-24 w-full object-cover rounded-xl" alt="before" />
                  : <div className="h-24 bg-surface-high rounded-xl grid place-items-center text-xs text-on-variant">no before</div>}
                {w.after ? <img src={w.after} className="h-24 w-full object-cover rounded-xl" alt="after" />
                  : <div className="h-24 bg-secondary/10 rounded-xl grid place-items-center text-xs text-secondary">awaiting after</div>}
              </div>
            </div>
          ))}
        </div>
      ))}

      <section className="space-y-4">
        <SectionLabel>Preferences</SectionLabel>
        <div className="bg-white rounded-2xl p-2 shadow-sm">
          {[["folder_open", "My reports"], ["notifications_active", "Notifications"], ["verified_user", "Account security"], ["help", "Help & support"]].map(([ic, lbl]) => (
            <div key={lbl} className="w-full flex items-center justify-between p-3.5 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface-low flex items-center justify-center text-primary"><Icon name={ic} className="text-lg" /></div>
                <span className="font-semibold text-sm">{lbl}</span>
              </div>
              <Icon name="chevron_right" className="text-slate-300" />
            </div>
          ))}
        </div>
        <button onClick={logout}
          className="w-full py-4 rounded-full border border-outline-variant/20 text-error font-bold hover:bg-error/5 transition-colors">
          Sign out
        </button>
        <p className="text-center text-[10px] text-slate-400 uppercase tracking-[0.3em]">CivicPulse v1.0</p>
      </section>
    </div>
  );
}
