// Converted from stitch mockup: report_issue/
import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fileToBase64, reverseGeocode } from "../api.jsx";
import { Icon, VerificationChip, PriorityBadge, SectionLabel, EditorialTitle, GeoInput } from "../ui.jsx";

const CATS = ["Roads", "Water", "Waste", "Electricity", "Safety", "Flooding", "Traffic"];

export default function Report() {
  const nav = useNavigate();
  const fileRef = useRef();
  const [f, setF] = useState({ title: "", description: "", category: "Roads", lat: 13.0604, lng: 80.2496, address: "" });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [gps, setGps] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  function locate() {
    setGps("locating…");
    navigator.geolocation.getCurrentPosition(async (p) => {
      const lat = +p.coords.latitude.toFixed(6), lng = +p.coords.longitude.toFixed(6);
      const addr = await reverseGeocode(lat, lng);
      setF((s) => ({ ...s, lat, lng, address: addr || s.address }));
      setGps("GPS location tagged");
    }, () => setGps("permission denied — pick a place below"), { timeout: 8000, enableHighAccuracy: true });
  }

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";           // allow re-selecting the same file
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErr("Image must be under 10 MB"); return; }
    setErr("");
    setPhoto(await fileToBase64(file));
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
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
        <div className="w-16 h-16 rounded-[20px] bg-secondary/15 flex items-center justify-center text-secondary">
          <Icon name="task_alt" className="text-4xl" fill />
        </div>
        <EditorialTitle top="Report" accent="Submitted." />
        <div className="bg-white rounded-3xl p-5 space-y-3 shadow-sm">
          <h3 className="font-bold text-lg">{result.title}</h3>
          <div className="flex gap-2 items-center flex-wrap">
            <PriorityBadge p={result.priority} />
            <span className="text-xs font-bold text-on-variant">
              {result.cluster_count > 1 ? `Merged into cluster of ${result.cluster_count}` : "New cluster"}
            </span>
          </div>
          <VerificationChip issue={result} />
          <p className="text-sm text-on-variant border-l-2 border-primary/30 pl-3">{result.verification_note}</p>
          {result.verification_method === "pending" && (
            <p className="text-xs text-primary flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              AI is verifying your photo — the result will appear on the issue page shortly.
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={() => nav(`/issues/${result.id}`)} className="flex-1 py-3.5 rounded-full bg-primary text-white font-bold">View issue</button>
          <button onClick={() => { setResult(null); setF((s) => ({ ...s, title: "", description: "" })); setPhoto(null); setPreview(null); }}
            className="flex-1 py-3.5 rounded-full bg-white font-bold shadow-sm">Report another</button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-7">
      <EditorialTitle top="Report" accent="An Issue." sub="Help keep your neighbourhood safe and pristine." />

      <section className="relative">
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full aspect-[4/3] rounded-3xl glass border border-white/50 flex flex-col items-center justify-center active:scale-[0.99] transition-all overflow-hidden">
          {preview
            ? <img src={preview} alt="" className="w-full h-full object-cover" />
            : (
              <span className="flex flex-col items-center gap-3 text-primary">
                <span className="p-5 rounded-full bg-primary/10"><Icon name="add_a_photo" className="text-4xl" fill /></span>
                <span className="font-semibold tracking-widest uppercase text-xs">Upload evidence</span>
              </span>
            )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
        {preview && (
          <button type="button" onClick={() => { setPhoto(null); setPreview(null); }}
            className="absolute top-3 right-3 w-9 h-9 rounded-full glass-strong flex items-center justify-center text-error active:scale-90">
            <Icon name="delete" className="text-lg" />
          </button>
        )}
        <button type="button" onClick={locate}
          className="absolute -bottom-5 right-5 w-14 h-14 rounded-full glass-strong shadow-xl shadow-primary/15 flex items-center justify-center text-primary active:scale-90 transition-transform">
          <Icon name="my_location" className="text-2xl" fill />
        </button>
      </section>

      <section>
        <SectionLabel>Select category</SectionLabel>
        <div className="flex flex-wrap gap-2.5">
          {CATS.map((c) => (
            <button type="button" key={c} onClick={() => setF((s) => ({ ...s, category: c }))}
              className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-all ${f.category === c ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-white text-on-variant shadow-sm"}`}>
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
            <Icon name="my_location" className="text-sm" /> Use GPS
          </button>
        </div>
        <GeoInput value={f.address} onChange={(v) => setF((s) => ({ ...s, address: v }))}
          onPick={(r) => setF((s) => ({ ...s, address: r.label, lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6) }))}
          near={{ lat: f.lat, lng: f.lng }} placeholder="Search street / landmark…" />
        <p className="text-xs text-on-variant mt-2">
          {gps || `Pin: ${(+f.lat).toFixed(4)}, ${(+f.lng).toFixed(4)}`}
          {f.category === "Roads" && " · a road photo runs the 2-stage CLIP→YOLO vision pipeline"}
          {f.category === "Flooding" && " · verified from the photo + live rainfall at this GPS point"}
          {f.category === "Traffic" && " · a junction/signal photo runs the CLIP scene classifier"}
        </p>
      </section>

      {err && <p className="text-error text-sm font-medium">{err}</p>}
      <button type="submit" disabled={busy}
        className="w-full py-5 rounded-full bg-gradient-to-br from-primary to-primary-container text-white font-headline text-lg font-bold shadow-xl shadow-primary/30 active:scale-95 transition-all disabled:opacity-60">
        {busy ? "Submitting…" : "Submit issue"}
      </button>
    </form>
  );
}
