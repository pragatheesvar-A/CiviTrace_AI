import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.jsx";
import { Icon } from "../ui.jsx";

// Deterministic offline assistant: a scripted slot-filling flow that never goes
// silent. (The production design also has a Claude-backed path; this is the
// guaranteed fallback.)
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
    { who: "bot", text: "Hi! I can file a civic report with you step by step. " + STEPS[0].q },
  ]);
  const [draft, setDraft] = useState({});
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [done, setDone] = useState(null);
  const endRef = useRef();

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function answer(value) {
    const cur = STEPS[step];
    const next = { ...draft, [cur.key]: value };
    setDraft(next);
    setMsgs((m) => [...m, { who: "me", text: value }]);
    setInput("");

    if (step + 1 < STEPS.length) {
      setStep(step + 1);
      setMsgs((m) => [...m, { who: "bot", text: STEPS[step + 1].q }]);
      return;
    }
    setMsgs((m) => [
      ...m,
      { who: "bot", text: `Got it. Filing: “${next.title}” (${next.category}) at ${next.address}. Verifying…` },
    ]);
    try {
      const issue = await api("/issues", {
        method: "POST",
        body: { ...next, lat: 13.0604, lng: 80.2496 },
      });
      setDone(issue);
      setMsgs((m) => [
        ...m,
        {
          who: "bot",
          text: `Report #${issue.id} created · priority ${issue.priority} · ${issue.verification_note}`,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { who: "bot", text: "Something went wrong: " + e.message }]);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)]">
      <h1 className="text-3xl font-bold mb-3">AI Assistant</h1>
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {msgs.map((m, n) => (
          <div key={n} className={`flex ${m.who === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
              m.who === "me" ? "bg-primary text-white rounded-br-sm" : "bg-white shadow-sm rounded-bl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {done && (
          <button onClick={() => nav(`/issues/${done.id}`)}
            className="ml-1 text-primary font-bold text-sm flex items-center gap-1">
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
                  className="px-3 py-1.5 rounded-full bg-white text-on-variant text-xs font-bold shadow-sm">
                  {c}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); input.trim() && answer(input.trim()); }}
            className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…"
              className="flex-1 bg-white border-none rounded-full py-3 px-4 focus:ring-2 focus:ring-primary shadow-sm" />
            <button className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center">
              <Icon name="send" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
