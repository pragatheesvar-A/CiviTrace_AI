import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fileToBase64 } from "../api.jsx";
import { Icon, VerificationChip, PriorityBadge } from "../ui.jsx";

const CATS = ["Roads", "Sanitation", "Utilities", "Drainage", "Public Property"];

export default function Report() {
  const nav = useNavigate();
  const [f, setF] = useState({
    title: "", description: "", category: "Roads",
    lat: 13.0604, lng: 80.2496, address: "",
  });
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
      (p) => {
        setF((s) => ({ ...s, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }));
        setGps("location tagged");
      },
      () => setGps("permission denied — using default"),
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
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (result)
    return (
      <div className="space-y-6 py-6">
        <div className="w-16 h-16 rounded-full bg-secondary/15 flex items-center justify-center text-secondary">
          <Icon name="task_alt" className="text-4xl" />
        </div>
        <h1 className="text-3xl font-bold">Report submitted</h1>
        <div className="bg-white rounded-lg p-5 space-y-3 shadow-sm">
          <h3 className="font-bold text-lg">{result.title}</h3>
          <div className="flex gap-2 items-center flex-wrap">
            <PriorityBadge p={result.priority} />
            <span className="text-xs font-bold text-on-variant">
              {result.cluster_count > 1 ? `Merged into cluster of ${result.cluster_count}` : "New cluster"}
            </span>
          </div>
          <VerificationChip issue={result} />
          <p className="text-sm text-on-variant border-l-2 border-primary/30 pl-3">
            {result.verification_note}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => nav(`/issues/${result.id}`)}
            className="flex-1 py-3 rounded-full bg-primary text-white font-bold">View issue</button>
          <button onClick={() => { setResult(null); setF({ ...f, title: "", description: "" }); setPhoto(null); setPreview(null); }}
            className="flex-1 py-3 rounded-full bg-white font-bold">Report another</button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-5 pb-6">
      <h1 className="text-3xl font-bold">Report an Issue</h1>

      <div className="grid grid-cols-3 gap-2">
        {CATS.map((c) => (
          <button type="button" key={c} onClick={() => setF({ ...f, category: c })}
            className={`py-2.5 rounded-lg text-xs font-bold ${
              f.category === c ? "bg-primary text-white" : "bg-white text-on-variant"
            }`}>
            {c}
          </button>
        ))}
      </div>

      <input required placeholder="Short title (e.g. Deep pothole on Anna Salai)" value={f.title} onChange={set("title")}
        className="w-full bg-white border-none rounded-lg py-4 px-5 focus:ring-2 focus:ring-primary shadow-sm" />
      <textarea placeholder="Describe what you see and how urgent it is…" value={f.description} onChange={set("description")}
        rows={3} className="w-full bg-white border-none rounded-lg py-4 px-5 focus:ring-2 focus:ring-primary shadow-sm" />
      <input placeholder="Address / landmark" value={f.address} onChange={set("address")}
        className="w-full bg-white border-none rounded-lg py-4 px-5 focus:ring-2 focus:ring-primary shadow-sm" />

      <div className="flex gap-3">
        <button type="button" onClick={locate}
          className="flex-1 py-3 rounded-lg bg-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm">
          <Icon name="my_location" className="text-lg" /> Tag GPS
        </button>
        <label className="flex-1 py-3 rounded-lg bg-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer">
          <Icon name="photo_camera" className="text-lg" /> {photo ? "Photo added" : "Add photo"}
          <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
        </label>
      </div>
      {gps && <p className="text-xs text-on-variant">{gps} · {(+f.lat).toFixed(4)}, {(+f.lng).toFixed(4)}</p>}
      {preview && <img src={preview} alt="" className="w-full h-48 object-cover rounded-lg" />}
      {f.category === "Roads" && (
        <p className="text-xs text-on-variant flex items-center gap-1">
          <Icon name="verified" className="text-sm" />
          A road photo runs the 2-stage vision pipeline (scene gate → pothole detector).
        </p>
      )}

      {err && <p className="text-error text-sm font-medium">{err}</p>}
      <button disabled={busy}
        className="w-full py-4 rounded-full bg-gradient-to-r from-primary to-primary-container text-white font-bold text-lg disabled:opacity-60">
        {busy ? "Verifying…" : "Submit report"}
      </button>
    </form>
  );
}
