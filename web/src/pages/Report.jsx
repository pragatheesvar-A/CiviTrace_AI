// Guided civic report flow — photo → details → location → review,
// with a live "already reported / recently fixed here" check before submit.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api, fileToBase64, reverseGeocode, issuesAround, useLiveFeed, getArea, parseSpokenReport,
} from "../api.jsx";
import {
  Icon, VerificationChip, ConfidenceMeter, PriorityBadge, SectionLabel,
  EditorialTitle, GeoInput, Stepper, NearbyList, VoiceButton, LangPicker,
} from "../ui.jsx";
import { t } from "../i18n.jsx";

const CATS = ["Roads", "Water", "Waste", "Electricity", "Safety", "Flooding", "Traffic"];
const VISION = { Roads: "2-stage CLIP → YOLO pothole pipeline", Flooding: "photo + live rainfall at this GPS point", Traffic: "CLIP signal / junction classifier" };

export default function Report() {
  const nav = useNavigate();
  const fileRef = useRef();
  const [f, setF] = useState(() => {
    const a = getArea();
    return {
      title: "", description: "", category: "Roads",
      lat: a?.lat ?? 13.0604, lng: a?.lng ?? 80.2496, address: a?.label || "",
    };
  });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [gps, setGps] = useState(getArea() ? `Using your area: ${getArea().label.split(",")[0]}` : "");
  const [locked, setLocked] = useState(!!getArea());   // area / GPS / picked place set
  const [near, setNear] = useState(null);
  const [heard, setHeard] = useState("");        // interim transcript
  const [understood, setUnderstood] = useState(null); // parsed NLU result
  const [parsing, setParsing] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function onVoice(text) {
    setHeard(text);
    setParsing(true);
    try {
      const p = await parseSpokenReport(text, f.lat, f.lng);
      setUnderstood(p);
      setF((s) => ({
        ...s,
        category: CATS.includes(p.category) ? p.category : s.category,
        title: p.title || s.title,
        description: (s.description ? s.description + " " : "") + (p.description || text),
      }));
    } catch {
      setF((s) => ({ ...s, description: (s.description ? s.description + " " : "") + text }));
    } finally { setParsing(false); }
  }

  const step = !preview ? 0 : !f.title.trim() ? 1 : !locked ? 2 : 3;

  // live duplicate / recurrence check once we know category + a real location
  useEffect(() => {
    if (!locked) { setNear(null); return; }
    const t = setTimeout(async () => {
      const r = await issuesAround(f.lat, f.lng, { radius: 300, category: f.category, text: `${f.title} ${f.description}` });
      setNear(r);
    }, 400);
    return () => clearTimeout(t);
  }, [locked, f.lat, f.lng, f.category, f.title, f.description]);

  function locate() {
    setGps("locating…");
    navigator.geolocation.getCurrentPosition(async (p) => {
      const lat = +p.coords.latitude.toFixed(6), lng = +p.coords.longitude.toFixed(6);
      const addr = await reverseGeocode(lat, lng);
      setF((s) => ({ ...s, lat, lng, address: addr || s.address }));
      setGps("GPS location tagged"); setLocked(true);
    }, () => setGps("permission denied — search a place below"), { timeout: 8000, enableHighAccuracy: true });
  }

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErr("Image must be under 10 MB"); return; }
    setErr("");
    setPhoto(await fileToBase64(file));
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
  }

  async function upvoteInstead(id) {
    try { await api(`/issues/${id}/vote?kind=up`, { method: "POST" }); } catch {}
    nav(`/issues/${id}`);
  }

  // once the report is filed, watch the live feed and fold the AI result in-place
  useLiveFeed(
    React.useCallback((ev) => {
      if (!result) return;
      if (ev.type === "issue.updated" && String(ev.issue?.id) === String(result.id)) {
        setResult(ev.issue);
      }
    }, [result])
  );
  // safety net: also poll a few times in case a WS frame is missed
  useEffect(() => {
    if (!result || result.verification_method !== "pending") return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      try {
        const fresh = await api(`/issues/${result.id}`);
        if (fresh.verification_method !== "pending") { setResult(fresh); clearInterval(t); }
      } catch {}
      if (n > 20) clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [result]);

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

  if (result) {
    const pending = result.verification_method === "pending";
    return (
      <div className="space-y-6 py-4 fadeup">
        <div className={`w-16 h-16 rounded-[20px] flex items-center justify-center transition-colors ${
          pending ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>
          {pending
            ? <span className="w-7 h-7 border-[3px] border-primary/25 border-t-primary rounded-full animate-spin" />
            : <Icon name="task_alt" className="text-4xl" fill />}
        </div>
        <EditorialTitle top="Report" accent={pending ? "Received." : "Verified."} />

        <div className="bg-white rounded-3xl p-5 space-y-3 shadow-sm">
          <h3 className="font-bold text-lg">{result.title}</h3>
          <div className="flex gap-2 items-center flex-wrap">
            <PriorityBadge p={result.priority} />
            <span className="text-xs font-bold text-on-variant">
              {result.cluster_count > 1 ? `Merged into a cluster of ${result.cluster_count}` : "New cluster"}
            </span>
          </div>

          {pending ? (
            <div className="space-y-2.5 pt-1">
              {[
                ["photo_camera", "Reading the photo"],
                ["policy", "Scene & object detection"],
                ["content_copy", "Duplicate & recurring-spot check"],
                ["verified_user", "Authenticity scoring"],
              ].map(([ic, label], n) => (
                <div key={label} className="flex items-center gap-2.5 text-sm">
                  <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
                    style={{ animationDelay: `${n * 0.15}s` }} />
                  <Icon name={ic} className="text-base text-primary" />
                  <span className="text-on-variant">{label}…</span>
                </div>
              ))}
              <p className="text-xs text-on-variant pt-1">
                This usually takes a few seconds — the score appears here automatically, no need to leave.
              </p>
            </div>
          ) : (
            <>
              <ConfidenceMeter issue={result} />
              <VerificationChip issue={result} />
              <p className="text-sm text-on-variant border-l-2 border-primary/30 pl-3">{result.verification_note}</p>
              {result.recurrence && (
                <p className="text-xs font-semibold text-orange-600 flex items-center gap-1">
                  <Icon name="history" className="text-sm" /> Flagged as a recurring / chronic spot — priority escalated.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={() => nav(`/issues/${result.id}`)} className="flex-1 py-3.5 rounded-full bg-primary text-white font-bold">View issue</button>
          <button onClick={() => { setResult(null); setF((s) => ({ ...s, title: "", description: "" })); setPhoto(null); setPreview(null); setLocked(false); setNear(null); }}
            className="flex-1 py-3.5 rounded-full bg-white font-bold shadow-sm">Report another</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      <div className="flex items-start justify-between gap-3">
        <EditorialTitle top={t("Report")} accent={t("An Issue.")} sub="Speak or type — we check it isn't already reported before you submit." />
        <LangPicker compact />
      </div>
      <Stepper steps={[t("Photo"), t("Details"), t("Place"), t("Review")]} current={step} />

      <section className="bg-white rounded-3xl p-4 shadow-sm card-line space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold flex items-center gap-1.5">
            <Icon name="record_voice_over" className="text-primary" fill /> {t("Speak your report")}
          </p>
          <span className="text-[10px] text-slate-400">on-device speech · prototype</span>
        </div>
        <VoiceButton label={t("Speak your report")}
          onInterim={(x) => setHeard(x)}
          onResult={onVoice} />
        <p className="text-xs text-on-variant">
          {parsing ? "Understanding…" : heard
            ? `“${heard}”`
            : t("Tap the mic and describe the problem")}
        </p>
        {understood && (
          <div className="rounded-xl bg-primary/5 p-3 text-xs space-y-1 fadeup">
            <p className="font-bold text-primary flex items-center gap-1">
              <Icon name="auto_awesome" className="text-sm" /> {t("We understood")}
            </p>
            <p>{t("Category")}: <b>{t(understood.category)}</b> · {t("Severity")}: <b>{t(understood.severity)}</b>
              {understood.language ? <> · <span className="uppercase">{understood.language}</span></> : null}</p>
            {understood.matched?.length > 0 && (
              <p className="text-on-variant">heard: {understood.matched.join(", ")}</p>
            )}
            <p className="text-[10px] text-slate-400">{understood.note}</p>
          </div>
        )}
      </section>

      <section className="relative">
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full aspect-[4/3] rounded-3xl glass border border-white/50 flex flex-col items-center justify-center active:scale-[0.99] transition-all overflow-hidden">
          {preview
            ? <img src={preview} alt="" className="w-full h-full object-cover" />
            : (
              <span className="flex flex-col items-center gap-3 text-primary">
                <span className="p-5 rounded-full bg-primary/10"><Icon name="add_a_photo" className="text-4xl" fill /></span>
                <span className="font-semibold tracking-widest uppercase text-xs">{t("Add a photo of the problem")}</span>
                <span className="text-[11px] text-on-variant normal-case tracking-normal">A clear photo lets the AI verify it automatically</span>
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
      </section>

      <section>
        <SectionLabel>{t("What kind of problem?")}</SectionLabel>
        <div className="flex flex-wrap gap-2.5">
          {CATS.map((c) => (
            <button type="button" key={c} onClick={() => setF((s) => ({ ...s, category: c }))}
              className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-all ${f.category === c ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-white text-on-variant shadow-sm"}`}>
              {t(c)}
            </button>
          ))}
        </div>
        {VISION[f.category] && (
          <p className="text-xs text-primary mt-2 flex items-center gap-1">
            <Icon name="auto_awesome" className="text-sm" /> Photo is auto-verified — {VISION[f.category]}
          </p>
        )}
      </section>

      <section>
        <SectionLabel>{t("Title")}</SectionLabel>
        <input required value={f.title} onChange={set("title")} placeholder="e.g. Deep pothole on Anna Salai"
          className="w-full bg-white shadow-sm border-none rounded-2xl py-4 px-5 focus:ring-2 focus:ring-primary/30 outline-none" />
      </section>

      <section>
        <SectionLabel>{t("Description")}</SectionLabel>
        <textarea value={f.description} onChange={set("description")} rows={4} placeholder="Describe the problem and how urgent it is…"
          className="w-full bg-white shadow-sm border-none rounded-2xl py-4 px-5 focus:ring-2 focus:ring-primary/30 outline-none resize-none" />
      </section>

      <section>
        <div className="flex justify-between items-end mb-3">
          <SectionLabel>{t("Where is it?")}</SectionLabel>
          <button type="button" onClick={locate}
            className="flex items-center gap-1.5 text-primary font-bold text-xs bg-primary/10 px-3 py-1.5 rounded-full">
            <Icon name="my_location" className="text-sm" /> {t("Use GPS")}
          </button>
        </div>
        <GeoInput value={f.address}
          onChange={(v) => setF((s) => ({ ...s, address: v }))}
          onPick={(r) => { setF((s) => ({ ...s, address: r.label, lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6) })); setLocked(true); setGps("location set"); }}
          near={{ lat: f.lat, lng: f.lng }} placeholder="Search street / landmark…" />
        <p className="text-xs text-on-variant mt-2">
          {gps || `Pin: ${(+f.lat).toFixed(4)}, ${(+f.lng).toFixed(4)}`}
        </p>
      </section>

      {locked && near && (near.duplicate_candidates?.length > 0 || near.recurrence_candidates?.length > 0 || near.open?.length > 0) && (
        <section className="bg-white rounded-2xl p-4 shadow-sm space-y-3 fadeup">
          {near.duplicate_candidates?.length > 0 ? (
            <>
              <p className="text-sm font-bold flex items-center gap-1.5 text-orange-600">
                <Icon name="content_copy" className="text-base" /> This may already be reported
              </p>
              <NearbyList items={near.duplicate_candidates} onOpen={(i) => nav(`/issues/${i.id}`)} />
              <p className="text-xs text-on-variant">If it's the same problem, add your voice instead of a duplicate:</p>
              <div className="flex flex-wrap gap-2">
                {near.duplicate_candidates.map((i) => (
                  <button key={i.id} type="button" onClick={() => upvoteInstead(i.id)}
                    className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                    ▲ Upvote #{i.id} instead
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-bold flex items-center gap-1.5">
                <Icon name="near_me" className="text-base text-primary" /> {near.count} issue(s) near this spot
              </p>
              <NearbyList items={near.open?.slice(0, 3)} onOpen={(i) => nav(`/issues/${i.id}`)} />
            </>
          )}
          {near.recurrence_candidates?.length > 0 && (
            <div className="rounded-xl p-3 mt-1" style={{ background: "rgba(234,88,12,0.10)" }}>
              <p className="text-xs font-bold text-orange-700 flex items-center gap-1">
                <Icon name="history" className="text-sm" /> Fixed here before
              </p>
              <p className="text-xs text-orange-800/80 mt-0.5">
                A similar issue was marked resolved nearby. If the problem is back, mention that in the description —
                we'll flag it as a recurring / chronic spot and escalate it.
              </p>
            </div>
          )}
        </section>
      )}

      {err && <p className="text-error text-sm font-medium">{err}</p>}
      <button type="submit" disabled={busy || !f.title.trim()}
        className="w-full py-5 rounded-full bg-gradient-to-br from-primary to-primary-container text-white font-headline text-lg font-bold shadow-xl shadow-primary/30 active:scale-95 transition-all disabled:opacity-50">
        {busy ? t("Submitting…") : t("Submit issue")}
      </button>
    </form>
  );
}
