// Converted from stitch mockup: ai_assistant_chat/
import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.jsx";
import { Icon } from "../ui.jsx";

// Deterministic offline assistant: scripted slot-filling that never goes silent.
const CATS = ["Roads", "Sanitation", "Utilities", "Drainage", "Public Property"];
const STEPS = [
  { key: "category", q: "What kind of problem is it?", chips: CATS },
  { key: "title", q: "Give it a short title — e.g. “Deep pothole near the bus stop”." },
  { key: "description", q: "Describe what you see and how urgent it feels." },
  { key: "address", q: "Where is it? A landmark or street name is fine." },
];

export default function Assistant() {
  const nav = useNavigate();
  const [msgs, setMsgs] = useState([
    { who: "bot", text: "Hi, I'm CivicGuide — your AI partner for local reporting. I'll file a report with you, step by step." },
    { who: "bot", text: STEPS[0].q },
  ]);
  const [draft, setDraft] = useState({});
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState(null);
  const endRef = useRef();
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, typing]);

  async function answer(value) {
    const cur = STEPS[step];
    const next = { ...draft, [cur.key]: value };
    setDraft(next);
    setMsgs((m) => [...m, { who: "me", text: value }]);
    setInput("");
    setTyping(true);
    await new Promise((r) => setTimeout(r, 400));
    setTyping(false);

    if (step + 1 < STEPS.length) {
      setStep(step + 1);
      setMsgs((m) => [...m, { who: "bot", text: STEPS[step + 1].q }]);
      return;
    }
    setMsgs((m) => [...m, { who: "bot", text: `Filing “${next.title}” (${next.category}) at ${next.address}. Verifying…` }]);
    try {
      const issue = await api("/issues", { method: "POST", body: { ...next, lat: 13.0604, lng: 80.2496 } });
      setDone(issue);
      setMsgs((m) => [...m, { who: "bot", text: `Report #${issue.id} created · priority ${issue.priority}. ${issue.verification_note}` }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: "bot", text: "Something went wrong: " + e.message }]);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] -mt-2">
      <div className="flex flex-col items-center text-center mb-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary-container p-1 shadow-xl shadow-primary/20 mb-3">
          <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
            <Icon name="smart_toy" className="text-3xl text-primary" fill />
          </div>
        </div>
        <h1 className="text-xl font-bold font-headline">Hello, I'm CivicGuide</h1>
        <p className="text-on-variant text-sm mt-1 max-w-xs">Your AI partner for local reporting and civic engagement.</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4 no-scrollbar">
        {msgs.map((m, n) => (
          <div key={n} className={`flex ${m.who === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] px-4 py-2.5 text-sm leading-relaxed ${
              m.who === "me"
                ? "bg-gradient-to-br from-primary to-primary-container text-white rounded-2xl rounded-br-md shadow-lg shadow-primary/10"
                : "glass-strong text-on-surface rounded-2xl rounded-bl-md shadow-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="glass-strong px-4 py-3 rounded-full flex gap-1.5">
              {[0, 0.2, 0.4].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
          </div>
        )}
        {done && (
          <button onClick={() => nav(`/issues/${done.id}`)} className="ml-1 text-primary font-bold text-sm flex items-center gap-1">
            Open report <Icon name="arrow_forward" className="text-sm" />
          </button>
        )}
        <div ref={endRef} />
      </div>

      {!done && (
        <div className="pt-2">
          {STEPS[step].chips && (
            <div className="flex flex-wrap gap-2 mb-2">
              {STEPS[step].chips.map((c) => (
                <button key={c} onClick={() => answer(c)}
                  className="px-4 py-2 rounded-full glass-strong text-primary text-xs font-semibold shadow-sm flex items-center gap-1.5">
                  <Icon name="report_problem" className="text-sm" /> {c}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); input.trim() && answer(input.trim()); }}
            className="glass-strong rounded-full px-4 py-2 flex items-center gap-2 shadow-sm">
            <Icon name="mic" className="text-slate-400" />
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your message…"
              className="flex-1 bg-transparent border-none focus:ring-0 outline-none text-sm py-1.5" />
            <button className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center flex-shrink-0">
              <Icon name="send" className="text-lg" fill />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}