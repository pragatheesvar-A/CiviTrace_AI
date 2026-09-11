// Converted from stitch mockup: user_profile_settings/
// Citizen profile keeps the gamified reports/leaderboard/proof-wall view.
// Authority gets a lean account + oversight profile — no citizen-only screens.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useAuth } from "../api.jsx";
import { Icon, Spinner, StatusBadge, SectionLabel, LangPicker, fmtAgo } from "../ui.jsx";

const PREF_KEY = "civicpulse_prefs";
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } };

export default function Profile() {
  const { user, logout } = useAuth();
  return user.role === "authority"
    ? <AuthorityProfile user={user} logout={logout} />
    : <CitizenProfile user={user} logout={logout} />;
}

function AvatarHeader({ user, sub }) {
  return (
    <section className="flex flex-col items-center text-center space-y-4 pt-2">
      <div className="relative">
        <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white text-4xl font-black font-headline rotate-3 shadow-2xl ring-4 ring-white">
          {user.name[0]}
        </div>
      </div>
      <div>
        <h1 className="text-3xl font-bold font-headline tracking-tight">{user.name}</h1>
        <p className="text-on-variant font-medium capitalize">{sub || user.role}</p>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- Authority ---
function AuthorityProfile({ user, logout }) {
  const [audit, setAudit] = useState(null);
  useEffect(() => { api("/authority/audit?limit=200").then((r) => setAudit(r.length)).catch(() => setAudit(0)); }, []);
  return (
    <div className="space-y-8">
      <AvatarHeader user={user} sub="Authority · Verification & Resolution" />

      <section className="bg-gradient-to-br from-primary/5 to-primary-container/10 p-6 rounded-2xl relative overflow-hidden">
        <div className="absolute top-2 right-2 opacity-10"><Icon name="verified_user" className="text-[90px]" /></div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-4">Account</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-on-variant">Email</span><span className="font-semibold">{user.email}</span></div>
          <div className="flex justify-between"><span className="text-on-variant">Two-factor auth</span>
            <span className={`font-semibold ${user.totp_enabled ? "text-secondary" : "text-orange-600"}`}>{user.totp_enabled ? "Enabled" : "Recommended — not set up"}</span></div>
          <div className="flex justify-between"><span className="text-on-variant">Audit trail entries</span><span className="font-semibold">{audit ?? "…"}</span></div>
        </div>
      </section>

      <Link to="/authority"
        className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-br from-primary to-primary-container text-white shadow-lg shadow-primary/20">
        <span className="flex items-center gap-3 font-bold"><Icon name="monitoring" fill /> Open Authority Hub</span>
        <Icon name="chevron_right" />
      </Link>

      <section className="space-y-4">
        <SectionLabel>Preferences</SectionLabel>
        <div className="bg-white rounded-2xl px-3.5 py-3 shadow-sm flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-2"><Icon name="translate" className="text-primary text-lg" /> Language</span>
          <LangPicker compact />
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm text-sm text-on-variant space-y-2">
          <p>Authority accounts see the <b>Analytics</b>, <b>Triage</b>, <b>Human Review</b>, <b>Fairness</b> and
            <b> AI Audit</b> tabs in the Hub — everything needed to verify and resolve citizen reports.</p>
          <p>Enable two-factor authentication for account security (Account security is enforced via TOTP where required).</p>
        </div>
        <button onClick={logout}
          className="w-full py-4 rounded-full border border-outline-variant/20 text-error font-bold hover:bg-error/5 transition-colors">
          Sign out
        </button>
        <p className="text-center text-[10px] text-slate-400 uppercase tracking-[0.3em]">CiviTrace AI v1.0</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Citizen ---
function CitizenProfile({ user, logout }) {
  const [tab, setTab] = useState("mine");
  const [panel, setPanel] = useState(null);   // which preference row is expanded
  const [prefs, setPrefs] = useState(loadPrefs);
  const setPref = (k, v) => setPrefs((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(PREF_KEY, JSON.stringify(n)); } catch {} return n; });
  const [mine, setMine] = useState(null);
  const [board, setBoard] = useState(null);
  const [wall, setWall] = useState(null);

  useEffect(() => {
    api("/issues?mine=true").then(setMine).catch(() => setMine([]));
    api("/leaderboard").then(setBoard).catch(() => setBoard([]));
    api("/proof-wall").then(setWall).catch(() => setWall([]));
  }, []);

  const reported = mine?.length ?? 0;
  const resolved = mine?.filter((i) => ["Resolved", "Verified Closed"].includes(i.status)).length ?? 0;
  const rank = board?.find((r) => r.name === user.name)?.rank;

  return (
    <div className="space-y-8">
      <AvatarHeader user={user} sub={rank ? `${user.role} · #${rank} in your city` : user.role} />
      <div className="-mt-6 flex justify-center">
        <div className="bg-gradient-to-br from-primary to-primary-container text-white px-3 py-1 rounded-full text-[11px] font-bold shadow-lg flex items-center gap-1">
          <Icon name="verified" className="text-xs" fill />{user.points} pts
        </div>
      </div>

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
        <div className="bg-white rounded-2xl px-3.5 py-3 shadow-sm flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-2">
            <Icon name="translate" className="text-primary text-lg" /> Language / voice
          </span>
          <LangPicker compact />
        </div>
        <div className="bg-white rounded-2xl p-2 shadow-sm divide-y divide-surface-high/60">
          {[
            ["folder_open", "My reports", "mine"],
            ["account_balance", "Civic services & payments", "payments"],
            ["shield_person", "Privacy", "privacy"],
            ["notifications_active", "Notifications", "notif"],
            ["verified_user", "Account security", "security"],
            ["help", "Help & support", "help"],
          ].map(([ic, lbl, key]) => (
            <div key={key}>
              <button type="button"
                onClick={() => {
                  if (key === "mine") { setTab("mine"); window.scrollTo({ top: 0, behavior: "smooth" }); }
                  else if (key === "payments") { window.location.assign("/payments"); }
                  else setPanel(panel === key ? null : key);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-xl active:bg-surface-low">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface-low flex items-center justify-center text-primary"><Icon name={ic} className="text-lg" /></div>
                  <span className="font-semibold text-sm">{lbl}</span>
                </div>
                <Icon name={key === "mine" ? "chevron_right" : panel === key ? "expand_less" : "expand_more"} className="text-slate-300" />
              </button>

              {panel === key && key === "privacy" && (
                <div className="px-3.5 pb-3.5 space-y-2 text-sm text-on-variant">
                  <p>Your phone number and email are <b>never</b> shown on public maps, dashboards or to other citizens.</p>
                  <p>Each report has its own privacy control on the issue page:</p>
                  <ul className="list-disc ml-4 space-y-0.5 text-xs">
                    <li><b>Public / private</b> — a private report is visible only to you and the authority.</li>
                    <li><b>Exact location</b> — off by default; the public map shows an approximate (~150 m) pin.</li>
                  </ul>
                  <p className="text-xs">Photos are EXIF-stripped and faces blurred before storage.</p>
                </div>
              )}
              {panel === key && key === "notif" && (
                <div className="px-3.5 pb-3.5 space-y-2">
                  {[["status_updates", "Status updates on my reports"], ["nearby_alerts", "New critical issues near me"], ["resolved", "When an issue I follow is fixed"]].map(([k, t]) => (
                    <label key={k} className="flex items-center justify-between text-sm py-1.5">
                      <span className="text-on-variant">{t}</span>
                      <button type="button" onClick={() => setPref(k, !(prefs[k] ?? true))}
                        className={`w-11 h-6 rounded-full transition-colors relative ${(prefs[k] ?? true) ? "bg-primary" : "bg-surface-high"}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${(prefs[k] ?? true) ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                    </label>
                  ))}
                  <p className="text-[11px] text-slate-400">Saved on this device.</p>
                </div>
              )}
              {panel === key && key === "security" && (
                <div className="px-3.5 pb-3.5 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-on-variant">Email</span><span className="font-semibold">{user.email}</span></div>
                  <div className="flex justify-between"><span className="text-on-variant">Role</span><span className="font-semibold capitalize">{user.role}</span></div>
                  <div className="flex justify-between"><span className="text-on-variant">Two-factor auth</span>
                    <span className={`font-semibold ${user.totp_enabled ? "text-secondary" : "text-on-variant"}`}>{user.totp_enabled ? "Enabled" : "Not required"}</span></div>
                  <div className="flex justify-between"><span className="text-on-variant">Sessions</span><span className="font-semibold">Rotating refresh tokens</span></div>
                  <button onClick={logout} className="mt-1 text-error font-bold text-xs">Sign out of this device</button>
                </div>
              )}
              {panel === key && key === "help" && (
                <div className="px-3.5 pb-3.5 space-y-2 text-sm text-on-variant">
                  <p>• Use the <b>Assistant</b> tab — ask “how does verification work”.</p>
                  <p>• Emergencies: use the SOS screen or call <b>112</b>.</p>
                  <p>• Data & privacy: photos are EXIF-stripped and faces blurred before storage.</p>
                  <a href="mailto:support@civicpulse.app" className="text-primary font-bold inline-block pt-1">Email support</a>
                </div>
              )}
            </div>
          ))}
        </div>
        <button onClick={logout}
          className="w-full py-4 rounded-full border border-outline-variant/20 text-error font-bold hover:bg-error/5 transition-colors">
          Sign out
        </button>
        <p className="text-center text-[10px] text-slate-400 uppercase tracking-[0.3em]">CiviTrace AI v1.0</p>
      </section>
    </div>
  );
}
