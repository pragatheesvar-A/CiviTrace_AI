// Converted from stitch mockup: issue_details/
import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  api, useAuth, useLiveFeed, fileToBase64,
  evidenceTrust, issueAudit, citizenConfirm, reopenIssue, setIssuePrivacy,
} from "../api.jsx";
import {
  Icon, Spinner, PriorityBadge, StatusBadge, VerificationChip, ConfidenceMeter,
  AuthenticityChip, RecurrenceBanner, EtaChip, EvidenceTrust, ConsistencyBadge,
  ResolutionCard, AuditTimeline, PriorityBreakdown, fmtAgo,
} from "../ui.jsx";

const FLOW = ["Verifying", "Verified", "Assigned", "In Progress", "AI Verified — Awaiting Confirmation", "Verified Closed"];
const FLOW_SHORT = ["Filed", "Verified", "Assigned", "Fixing", "AI check", "Closed"];

export default function IssueDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [i, setI] = useState(null);
  const [comment, setComment] = useState("");
  const [ev, setEv] = useState(null);
  const [audit, setAudit] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    api(`/issues/${id}`).then(setI).catch(() => setI(false));
    evidenceTrust(id).then(setEv).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useLiveFeed(useCallback((e) => {
    if (e.type === "issue.updated" && String(e.issue?.id) === String(id)) { setI(e.issue); evidenceTrust(id).then(setEv).catch(() => {}); }
  }, [id]));
  useEffect(() => { if (showAudit && !audit) issueAudit(id).then(setAudit).catch(() => setAudit([])); }, [showAudit, audit, id]);

  const confirm = async (result) => {
    setConfirming(true);
    try { await citizenConfirm(id, result); } finally { setConfirming(false); load(); setAudit(null); }
  };
  const reopen = async () => { await reopenIssue(id); load(); setAudit(null); };
  const togglePrivacy = async (k) => { await setIssuePrivacy(id, { [k]: !i[k] }); load(); };

  if (i === false) return <p className="py-24 text-center text-on-variant">Issue not found.</p>;
  if (!i) return <Spinner />;

  const vote = async (kind) => { await api(`/issues/${id}/vote?kind=${kind}`, { method: "POST" }); load(); };
  const send = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api(`/issues/${id}/comments`, { method: "POST", body: { body: comment } });
    setComment(""); load();
  };
  const setStatus = async (s) => {
    let body = { status: s };
    if (s === "Resolved") {
      const pick = document.createElement("input");
      pick.type = "file"; pick.accept = "image/*";
      const file = await new Promise((res) => { pick.onchange = () => res(pick.files?.[0]); pick.click(); });
      if (file) body.after_photo_base64 = await fileToBase64(file);
    }
    await api(`/authority/issues/${id}/status`, { method: "POST", body });
    load();
  };

  return (
    <div className="-mx-5 -mt-5">
      <section className="relative h-72 w-full overflow-hidden bg-surface-high">
        {i.photo_url ? (
          <img src={i.photo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-slate-300">
            <Icon name="image" className="text-6xl" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
        <button onClick={() => nav(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full glass-strong flex items-center justify-center active:scale-90">
          <Icon name="arrow_back" />
        </button>
        <div className="absolute bottom-4 left-5 right-5 flex flex-wrap gap-2">
          <div className="glass-strong px-4 py-1.5 rounded-full flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-primary font-bold text-xs uppercase tracking-wide">{i.status}</span>
          </div>
          <div className="bg-error/90 px-4 py-1.5 rounded-full flex items-center gap-1.5">
            <Icon name="priority_high" className="text-white text-sm" fill />
            <span className="text-white font-bold text-xs uppercase tracking-wide">{i.priority} priority</span>
          </div>
        </div>
      </section>

      <div className="px-5 -mt-4 relative z-10 space-y-5 pb-32">
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-start gap-3 mb-3">
            <h1 className="text-2xl font-black font-headline leading-tight">{i.title}</h1>
            <button onClick={() => vote("up")}
              className={`flex flex-col items-center justify-center w-14 h-14 rounded-full flex-shrink-0 active:scale-90 transition-all ${
                i.has_voted ? "bg-primary text-white" : "bg-primary/5 text-primary"
              }`}>
              <Icon name="thumb_up" className="text-lg" fill={i.has_voted} />
              <span className="text-[11px] font-bold">{i.upvotes}</span>
            </button>
          </div>
          <p className="text-on-variant text-sm flex items-center gap-1 mb-1">
            <Icon name="location_on" className="text-sm" />
            {i.address || `${i.lat}, ${i.lng}`} · by {i.reporter} · {fmtAgo(i.created_at)}
          </p>
          {i.status !== "Resolved" && <EtaChip days={i.eta_days} />}
          {i.description && <p className="text-on-surface leading-relaxed mt-3">{i.description}</p>}

          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <ConsistencyBadge level={i.consistency} />
            {i.in_human_review && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-orange-500/10 text-orange-600">
                In human review
              </span>
            )}
            {i.reopen_count > 0 && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-error/10 text-error">
                Reopened ×{i.reopen_count}
              </span>
            )}
            {!i.location_exact && (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Icon name="lock" className="text-xs" /> approximate location
              </span>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-surface-high space-y-3">
            <RecurrenceBanner issue={i} />
            {i.dedupe_matched_id && (
              <button onClick={() => nav(`/issues/${i.dedupe_matched_id}`)}
                className="text-xs font-bold text-primary flex items-center gap-1">
                <Icon name="merge" className="text-sm" /> Clustered with report #{i.dedupe_matched_id}
              </button>
            )}
            <EvidenceTrust data={ev} />
            <ConfidenceMeter issue={i} />
            <AuthenticityChip issue={i} />
            <VerificationChip issue={i} />
            <p className="text-sm text-on-variant border-l-2 border-primary/30 pl-3">{i.verification_note}</p>
            <ResolutionCard issue={i} />
            {i.cluster_count > 1 && (
              <p className="text-sm font-semibold flex items-center gap-1">
                <Icon name="group_work" className="text-base text-primary" />
                {i.cluster_count} citizen reports clustered here
              </p>
            )}
          </div>
        </div>

        {i.awaiting_confirmation && user.id === i.reporter_id && (
          <div className="bg-white rounded-2xl p-5 shadow-sm card-line space-y-3 fadeup">
            <p className="text-sm font-bold flex items-center gap-1.5">
              <Icon name="how_to_reg" className="text-primary" fill /> Is this issue actually fixed?
            </p>
            <p className="text-xs text-on-variant">
              The authority uploaded proof and our AI verified it ({i.resolution_confidence}/100). Your confirmation closes it.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button disabled={confirming} onClick={() => confirm("fixed")}
                className="py-2.5 rounded-xl bg-secondary text-white text-xs font-bold">✓ Fixed</button>
              <button disabled={confirming} onClick={() => confirm("partial")}
                className="py-2.5 rounded-xl bg-amber-500/15 text-amber-700 text-xs font-bold">⚠ Partly</button>
              <button disabled={confirming} onClick={() => confirm("still_exists")}
                className="py-2.5 rounded-xl bg-error/10 text-error text-xs font-bold">✗ Still there</button>
            </div>
          </div>
        )}

        {(i.status === "Verified Closed" || i.citizen_confirmation === "fixed") && (
          <div className="bg-secondary/5 rounded-2xl p-4 flex items-center gap-3">
            <Icon name="verified" className="text-secondary text-2xl" fill />
            <div>
              <p className="font-bold text-secondary text-sm">AI Verified + Citizen Confirmed</p>
              <p className="text-xs text-on-variant">This issue is closed with full evidence.</p>
            </div>
          </div>
        )}

        {["Resolved", "Verified Closed"].includes(i.status) && user.id === i.reporter_id && (
          <button onClick={reopen} className="w-full py-3 rounded-full bg-white shadow-sm card-line text-error font-bold text-sm">
            The problem is back — reopen this issue
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Category" value={i.category} sub={i.ward || i.verification_method} />
          <Stat label="Evidence Trust" value={`${i.evidence_trust || "—"}/100`} sub={i.evidence_verdict?.replace(/_/g, " ")} />
        </div>

        {user.id === i.reporter_id && (
          <div className="bg-white rounded-2xl p-4 shadow-sm card-line space-y-2.5">
            <p className="text-xs font-bold uppercase tracking-widest text-on-variant flex items-center gap-1.5">
              <Icon name="shield_person" className="text-sm text-primary" /> Privacy for this report
            </p>
            {[["is_public", "Visible to the public", i.is_public],
              ["precise_location_public", "Show my exact location publicly", i.precise_location_public]].map(([k, label, on]) => (
              <label key={k} className="flex items-center justify-between text-sm">
                <span className="text-on-variant">{label}</span>
                <button type="button" onClick={() => togglePrivacy(k)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${on ? "bg-primary" : "bg-surface-high"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </label>
            ))}
          </div>
        )}

        <button onClick={() => vote("adopt")}
          className={`w-full py-3.5 rounded-full font-bold flex items-center justify-center gap-2 ${
            i.has_adopted ? "bg-secondary text-white" : "bg-white text-on-variant shadow-sm"
          }`}>
          <Icon name="favorite" className="text-lg" fill={i.has_adopted} />
          {i.has_adopted ? "Adopted — tracking this" : "Adopt this issue"}
        </button>

        <div className="bg-white rounded-2xl p-4 shadow-sm card-line">
          <div className="flex justify-between">
            {FLOW.map((s, n) => {
              const cur = ["Reported", "Verifying"].includes(i.status) ? (i.status === "Verifying" ? 0 : 1) : FLOW.indexOf(i.status);
              const done = cur >= n;
              return (
                <div key={s} className="flex flex-col items-center gap-1 flex-1">
                  <div className={`w-3 h-3 rounded-full ${done ? "bg-primary" : "bg-slate-300"}`} />
                  <span className={`text-[9px] font-bold uppercase text-center ${done ? "text-primary" : "text-slate-400"}`}>{FLOW_SHORT[n]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {user.role === "authority" && <PriorityBreakdown issue={i} />}

        {user.role === "authority" && (
          <div className="bg-primary/5 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Authority controls</p>
            <div className="flex flex-wrap gap-2">
              {["Verified", "Assigned", "In Progress", "Resolved", "Rejected"].map((s) => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    i.status === s ? "bg-primary text-white" : "bg-white text-on-variant"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {i.after_photo_url && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-secondary mb-2">Before → After</p>
            <div className="grid grid-cols-2 gap-2">
              {i.photo_url
                ? <img src={i.photo_url} alt="before" className="w-full h-40 object-cover rounded-xl" />
                : <div className="h-40 bg-surface-high rounded-xl grid place-items-center text-xs text-on-variant">no before photo</div>}
              <img src={i.after_photo_url} alt="after" className="w-full h-40 object-cover rounded-xl" />
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 shadow-sm card-line">
          <button onClick={() => setShowAudit((v) => !v)}
            className="w-full flex items-center justify-between">
            <span className="text-sm font-bold flex items-center gap-1.5">
              <Icon name="history" className="text-primary" fill /> AI Decision & Audit History
            </span>
            <Icon name={showAudit ? "expand_less" : "expand_more"} className="text-slate-400" />
          </button>
          {showAudit && (
            <div className="mt-4">{audit ? <AuditTimeline rows={audit} /> : <Spinner label="Loading history…" />}</div>
          )}
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Community updates ({i.comments.length})</h2>
          {i.comments.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl rounded-tl-md p-4 shadow-sm">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-sm">{c.user}</span>
                <span className="text-[10px] text-slate-400">{fmtAgo(c.created_at)}</span>
              </div>
              <p className="text-sm text-on-variant">{c.body}</p>
            </div>
          ))}
          <form onSubmit={send} className="flex gap-2 sticky bottom-24">
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share an update…"
              className="flex-1 bg-white border-none rounded-full py-3.5 px-5 focus:ring-2 focus:ring-primary/30 outline-none shadow-sm" />
            <button className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center flex-shrink-0">
              <Icon name="send" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

const Stat = ({ label, value, sub }) => (
  <div className="bg-white rounded-2xl p-4 shadow-sm">
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">{label}</span>
    <p className="font-bold text-on-surface capitalize">{value}</p>
    {sub && <p className="text-xs text-on-variant capitalize">{sub}</p>}
  </div>
);