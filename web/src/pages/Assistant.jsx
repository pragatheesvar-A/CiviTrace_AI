// Converted from stitch mockup: ai_assistant_chat/
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useConfig } from "../api.jsx";
import { Icon } from "../ui.jsx";

export default function Assistant() {
  const nav = useNavigate();
  const cfg = useConfig();
  const name = cfg?.assistant_name || "Aarambh";
  const [msgs, setMsgs] = useState([]);
  const [quick, setQuick] = useState(["Report an issue", "My reports", "Nearby issues"]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const sid = useRef(null);
  const geo = useRef(null);
  const endRef = useRef();

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => { geo.current = { lat: p.coords.latitude, lng: p.coords.longitude }; }, () => {}, { timeout: 6000 });
  }, []);
  useEffect(() => {
    setMsgs([{ who: "bot", text: `Hello, I'm ${name}. I file civic reports with you, check the status of one, or list what's reported nearby. I only answer from the CivicPulse database — I never guess.` }]);
  }, [name]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text) {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { who: "me", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/assistant/message", {
        method: "POST",
        body: { text, session_id: sid.current, lat: geo.current?.lat, lng: geo.current?.lng },
      });
      sid.current = r.session_id;
      setMsgs((m) => [...m, { who: "bot", text: r.reply, intent: r.intent }]);
      setQuick(r.quick_replies || []);
      if (r.action?.type === "issue_created") setCreated(r.action.issue_id);
    } catch (e) {
      setMsgs((m) => [...m, { who: "bot", text: "Network error — please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9.5rem)] -mt-2">
      <div className="flex flex-col items-center text-center mb-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary-container p-1 shadow-xl shadow-primary/20 mb-3">
          <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
            <Icon name="smart_toy" className="text-3xl text-primary" fill />
          </div>
        </div>
        <h1 className="text-xl font-bold font-headline">Hello, I'm {name}</h1>
        <p className="text-on-variant text-xs mt-1 max-w-[16rem]">Grounded civic assistant — every answer comes from the database, not generated text.</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-3 no-scrollbar">
        {msgs.map((m, n) => (
          <div key={n} className={`flex ${m.who === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
              m.who === "me"
                ? "bg-gradient-to-br from-primary to-primary-container text-white rounded-2xl rounded-br-md shadow-lg shadow-primary/10"
                : "glass-strong text-on-surface rounded-2xl rounded-bl-md shadow-sm"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="glass-strong px-4 py-3 rounded-full flex gap-1.5">
              {[0, 0.15, 0.3].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
          </div>
        )}
        {created && (
          <button onClick={() => nav(`/issues/${created}`)} className="ml-1 text-primary font-bold text-sm flex items-center gap-1">
            Open report #{created} <Icon name="arrow_forward" className="text-sm" />
          </button>
        )}
        <div ref={endRef} />
      </div>

      <div className="pt-2">
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {quick.map((q) => (
              <button key={q} onClick={() => send(q)} disabled={busy}
                className="px-4 py-2 rounded-full glass-strong text-primary text-xs font-semibold shadow-sm">
                {q}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="glass-strong rounded-full px-4 py-2 flex items-center gap-2 shadow-sm">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Message ${name}…`}
            className="flex-1 bg-transparent border-none focus:ring-0 outline-none text-sm py-1.5" />
          <button type="submit" disabled={busy || !input.trim()}
            className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40">
            <Icon name="send" className="text-lg" fill />
          </button>
        </form>
      </div>
    </div>
  );
}
