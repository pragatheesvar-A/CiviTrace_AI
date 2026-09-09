// Converted from stitch mockup: report_issue/
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fileToBase64 } from "../api.jsx";
import { Icon, VerificationChip, PriorityBadge, SectionLabel, EditorialTitle } from "../ui.jsx";

const CATS = ["Roads", "Sanitation", "Utilities", "Drainage", "Public Property"];

export default function Report() {
  const nav = useNavigate();
  const [f, setF] = useState({ title: "", description: "", category: "Roads", lat: 13.0604, lng: 80.2496, address: "" });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [gps, setGps] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function locate() {
    setGps("locating…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setF((s) => ({ ...s, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })); setGps("location tagged"); },
      () => setGps("permission denied — using city centre"),
      { timeout: 8000 }
    );
  }
  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(await fileToBase64(file));
    setPreview(URL.createObjectURL(file));
  }
  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const issue = await api("/issues", {
        method: "POST",
        body: { ...f, lat: +f.lat, lng: +f.lng, photo_base64: photo || undefined },
      });
      setResult(issue);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (result)
    return (
      <div className="space-y-6 py-4 fadeup">
        <div className="w-16 h-16 rounded-2xl bg-secondary/15 flex items-center justify-center text-secondary">
          <Icon name="task_alt" className="text-4xl" fill />
        </div>
        <EditorialTitle top="Report" accent="Submitted." />
        <div className="bg-white rounded-2xl p-5 space-y-3 shadow-sm">
          <h3 className="font-bold text-lg">{result.title}</h3>
          <div className="flex gap-2 items-center flex-wrap">
            <PriorityBadge p={result.priority} />
            <span className="text-xs font-bold text-on-variant">
              {result.cluster_count > 1 ? `Merged into cluster of ${result.cluster_count}` : "New cluster"}
            </span>
          </div>
          <VerificationChip issue={result} />
          <p className="text-sm text-on-variant border-l-2 border-primary/30 pl-3">{result.verification_note}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => nav(`/issues/${result.id}`)}
            className="flex-1 py-3.5 rounded-full bg-primary text-white font-bold">View issue</button>
          <button onClick={() => { setResult(null); setF({ ...f, title: "", description: "" }); setPhoto(null); setPreview(null); }}
            className="flex-1 py-3.5 rounded-full bg-white font-bold shadow-sm">Report another</button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-8">
      <EditorialTitle top="Report" accent="An Issue." sub="Help keep your neighbourhood safe and pristine." />

      <section className="relative">
        <label className="w-full aspect-[4/3] rounded-2xl glass border border-white/50 flex flex-col items-center justify-center cursor-pointer active:scale-[0.99] transition-all overflow-hidden">
          {preview ? (
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-primary">
              <div className="p-5 rounded-full bg-primary/10">
                <Icon name="add_a_photo" className="text-4xl" fill />
              </div>
              <span className="font-semibold tracking-widest uppercase text-xs">Upload evidence</span>
            </div>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
        </label>
        <button type="button" onClick={locate}
          className="absolute -bottom-5 right-5 w-14 h-14 rounded-full glass-strong shadow-xl shadow-primary/15 flex items-center justify-center text-primary active:scale-90 transition-transform">
          <Icon name="my_location" className="text-2xl" fill />
        </button>
      </section>

      <section>
        <SectionLabel>Select category</SectionLabel>
        <div className="flex flex-wrap gap-2.5">
          {CATS.map((c) => (
            <button type="button" key={c} onClick={() => setF({ ...f, category: c })}
              className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-all ${
                f.category === c ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-white text-on-variant shadow-sm"
              }`}>
              {c}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Title</SectionLabel>
        <input required value={f.title} onChange={set("title")} placeholder="e.g. Deep pothole on Anna Salai"
          className="w-full bg-white shadow-sm border-none rounded-2xl py-4 px-5 focus:ring-2 focus:ring-primary/30 outline-none" />
      </section>

      <section>
        <SectionLabel>Description</SectionLabel>
        <textarea value={f.description} onChange={set("description")} rows={4} placeholder="Describe the problem and how urgent it is…"
          className="w-full bg-white shadow-sm border-none rounded-2xl py-4 px-5 focus:ring-2 focus:ring-primary/30 outline-none resize-none" />
      </section>

      <section>
        <div className="flex justify-between items-end mb-3">
          <SectionLabel>Location</SectionLabel>
          <button type="button" onClick={locate}
            className="flex items-center gap-1.5 text-primary font-bold text-xs bg-primary/10 px-3 py-1.5 rounded-full">
            <Icon name="my_location" className="text-sm" /> Auto-detect
          </button>
        </div>
        <input value={f.address} onChange={set("address")} placeholder="Address / landmark"
          className="w-full bg-white shadow-sm border-none rounded-2xl py-4 px-5 focus:ring-2 focus:ring-primary/30 outline-none" />
        {gps && <p className="text-xs text-on-variant mt-2">{gps} · {(+f.lat).toFixed(4)}, {(+f.lng).toFixed(4)}</p>}
        {f.category === "Roads" && (
          <p className="text-xs text-on-variant mt-2 flex items-center gap-1">
            <Icon name="verified" className="text-sm" />
            A road photo runs the 2-stage vision pipeline (scene gate → pothole detector).
          </p>
        )}
      </section>

      {err && <p className="text-error text-sm font-medium">{err}</p>}
      <button disabled={busy}
        className="w-full py-5 rounded-full bg-gradient-to-br from-primary to-primary-container text-white font-headline text-lg font-bold shadow-xl shadow-primary/30 active:scale-95 transition-all">
        {busy ? "Verifying…" : "Submit issue"}
      </button>
    </form>
  );
}