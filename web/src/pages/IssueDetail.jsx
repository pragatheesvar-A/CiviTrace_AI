import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, useAuth } from "../api.jsx";
import { Icon, Spinner, PriorityBadge, StatusBadge, VerificationChip, fmtAgo } from "../ui.jsx";

const FLOW = ["Reported", "Verified", "Assigned", "In Progress", "Resolved"];

export default function IssueDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [i, setI] = useState(null);
  const [comment, setComment] = useState("");

  const load = useCallback(() => api(`/issues/${id}`).then(setI).catch(() => setI(false)), [id]);
  useEffect(load, [load]);

  if (i === false) return <p className="py-20 text-center text-on-variant">Issue not found.</p>;
  if (!i) return <Spinner />;

  async function vote(kind) {
    await api(`/issues/${id}/vote?kind=${kind}`, { method: "POST" });
    load();
  }
  async function send(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    await api(`/issues/${id}/comments`, { method: "POST", body: { body: comment } });
    setComment("");
    load();
  }
  async function setStatus(s) {
    await api(`/authority/issues/${id}/status`, { method: "POST", body: { status: s } });
    load();
  }

  return (
    <div className="space-y-5 pb-6">
      <button onClick={() => nav(-1)} className="text-on-variant flex items-center gap-1 text-sm font-semibold">
        <Icon name="arrow_back" className="text-lg" /> Back
      </button>

      {i.photo_url && <img src={i.photo_url} alt="" className="w-full h-56 object-cover rounded-lg" />}

      <div className="flex gap-2 flex-wrap items-center">
        <PriorityBadge p={i.priority} />
        <StatusBadge s={i.status} />
        <span className="text-xs font-bold text-on-variant">{i.category}</span>
      </div>

      <h1 className="text-3xl font-bold leading-tight">{i.title}</h1>
      <p className="text-on-variant flex items-center gap-1 text-sm">
        <Icon name="location_on" className="text-sm" /> {i.address || `${i.lat}, ${i.lng}`} · reported by {i.reporter} · {fmtAgo(i.created_at)}
      </p>
      {i.description && <p className="text-on-surface">{i.description}</p>}

      <div className="bg-white rounded-lg p-4 space-y-2 shadow-sm">
        <VerificationChip issue={i} />
        <p className="text-sm text-on-variant border-l-2 border-primary/30 pl-3">{i.verification_note}</p>
        {i.cluster_count > 1 && (
          <p className="text-sm font-semibold flex items-center gap-1">
            <Icon name="group_work" className="text-base text-primary" />
            {i.cluster_count} citizen reports clustered here
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={() => vote("up")}
          className={`flex-1 py-3 rounded-full font-bold flex items-center justify-center gap-2 ${
            i.has_voted ? "bg-primary text-white" : "bg-white text-on-variant shadow-sm"
          }`}>
          <Icon name="arrow_upward" className="text-lg" /> {i.upvotes}
        </button>
        <button onClick={() => vote("adopt")}
          className={`flex-1 py-3 rounded-full font-bold flex items-center justify-center gap-2 ${
            i.has_adopted ? "bg-secondary text-white" : "bg-white text-on-variant shadow-sm"
          }`}>
          <Icon name="favorite" className="text-lg" /> {i.has_adopted ? "Adopted" : "Adopt"}
        </button>
      </div>

      <div className="bg-white rounded-lg p-4 shadow-sm">
        <div className="flex justify-between">
          {FLOW.map((s, n) => {
            const done = FLOW.indexOf(i.status) >= n;
            return (
              <div key={s} className="flex flex-col items-center gap-1 flex-1">
                <div className={`w-3 h-3 rounded-full ${done ? "bg-primary" : "bg-slate-300"}`} />
                <span className={`text-[9px] font-bold uppercase text-center ${done ? "text-primary" : "text-slate-400"}`}>
                  {s}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {user.role === "authority" && (
        <div className="bg-primary/5 rounded-lg p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Authority controls</p>
          <div className="flex flex-wrap gap-2">
            {FLOW.map((s) => (
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
          <p className="text-xs font-bold uppercase tracking-widest text-secondary mb-2">After — proof of fix</p>
          <img src={i.after_photo_url} alt="" className="w-full h-48 object-cover rounded-lg" />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Comments ({i.comments.length})</h2>
        {i.comments.map((c) => (
          <div key={c.id} className="bg-white rounded-lg p-3 shadow-sm">
            <p className="text-sm">{c.body}</p>
            <p className="text-xs text-on-variant mt-1">{c.user} · {fmtAgo(c.created_at)}</p>
          </div>
        ))}
        <form onSubmit={send} className="flex gap-2">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…"
            className="flex-1 bg-white border-none rounded-full py-3 px-4 focus:ring-2 focus:ring-primary shadow-sm" />
          <button className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center">
            <Icon name="send" />
          </button>
        </form>
      </section>
    </div>
  );
}
