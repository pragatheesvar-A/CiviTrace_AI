// Converted from stitch mockup: emergency_sos/
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.jsx";
import { Icon, EditorialTitle } from "../ui.jsx";

const QUICK = [
  { icon: "car_crash", label: "Accident", cat: "Traffic" },
  { icon: "local_fire_department", label: "Fire", cat: "Safety" },
  { icon: "water_drop", label: "Flooding", cat: "Flooding" },
];

export default function Emergency() {
  const nav = useNavigate();
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);

  async function trigger(kind, category) {
    setBusy(true);
    let lat = 13.0604, lng = 80.2496;
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
      );
      lat = +pos.coords.latitude.toFixed(6);
      lng = +pos.coords.longitude.toFixed(6);
    } catch {}
    try {
      const issue = await api("/issues", {
        method: "POST",
        body: {
          title: `SOS — ${kind}`,
          description: `Emergency alert raised from the CiviTrace AI app (${kind}). Immediate attention requested.`,
          category, lat, lng, address: "Live GPS location",
        },
      });
      setSent({ kind, issue });
    } catch (e) {
      setSent({ kind, error: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <EditorialTitle top="Emergency" accent="Help." sub="Help is one tap away. Your live location is shared with responders." />

      <div className="flex flex-col items-center">
        <div className="relative w-60 h-60 flex items-center justify-center">
          <div className="absolute inset-4 bg-error/10 rounded-full animate-ping" />
          <button
            disabled={busy}
            onClick={() => trigger("General SOS", "Safety")}
            className="sos-pulse relative w-48 h-48 rounded-full bg-gradient-to-br from-error to-[#e2241f] flex flex-col items-center justify-center text-white z-10 active:scale-95 transition-transform shadow-2xl disabled:opacity-70"
          >
            <Icon name="e911_emergency" className="text-5xl mb-1" fill />
            <span className="font-headline font-black text-4xl tracking-tighter">
              {busy ? "…" : "SOS"}
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {QUICK.map((q) => (
          <button key={q.label} disabled={busy} onClick={() => trigger(q.label, q.cat)}
            className="flex flex-col items-center justify-center bg-white rounded-2xl p-5 shadow-sm active:scale-95 transition-transform disabled:opacity-60">
            <Icon name={q.icon} className="text-error text-2xl mb-2" />
            <span className="font-semibold text-[11px] tracking-widest uppercase">{q.label}</span>
          </button>
        ))}
      </div>

      {sent && (
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3 fadeup">
          {sent.error ? (
            <p className="text-error text-sm font-medium">Could not send: {sent.error}</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-secondary font-bold">
                <Icon name="check_circle" fill /> Alert #{sent.issue.id} dispatched
              </div>
              <p className="text-sm text-on-variant">
                Logged as <b>{sent.kind}</b> · priority {sent.issue.priority}. Authorities see it at the top of the triage queue.
              </p>
              <button onClick={() => nav(`/issues/${sent.issue.id}`)}
                className="text-primary font-bold text-sm flex items-center gap-1">
                Track this alert <Icon name="arrow_forward" className="text-sm" />
              </button>
            </>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 flex justify-between items-center bg-surface-high/40">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-variant">Live tracking</span>
          </div>
          <span className="text-xs font-medium text-primary">GPS active</span>
        </div>
        <a href="tel:112" className="w-full py-4 flex items-center justify-center gap-3 font-headline font-bold text-on-surface active:bg-surface-low">
          <Icon name="call" className="text-error" /> Call emergency services (112)
        </a>
      </div>
    </div>
  );
}