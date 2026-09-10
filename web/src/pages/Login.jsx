// Converted from stitch mockup: login_signup/ + civicai_platform/
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../api.jsx";
import { Icon } from "../ui.jsx";

export default function Login() {
  const { otpRequest, otpVerify, loginPassword } = useAuth();
  const [mode, setMode] = useState("otp");           // otp | password
  const [role, setRole] = useState("citizen");
  const [step, setStep] = useState("email");         // email | code
  const [form, setForm] = useState({ email: "", name: "", password: "", code: "" });
  const [devCode, setDevCode] = useState("");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    if (secs <= 0) return;
    const t = setInterval(() => setSecs((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [secs]);

  async function sendCode(e) {
    e?.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await otpRequest(form.email, form.name || undefined, role);
      setStep("code"); setSecs(60);
      setDevCode(r.dev_code || "");
      setTimeout(() => codeRef.current?.focus(), 100);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function verify(e) {
    e?.preventDefault();
    setErr(""); setBusy(true);
    try { await otpVerify(form.email, form.code.trim()); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function pwLogin(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await loginPassword(form.email, form.password); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function demo(kind) {
    setErr(""); setBusy(true);
    try {
      await loginPassword(
        kind === "authority" ? "authority@chennai.gov.in" : "alex@example.com",
        kind === "authority" ? "authority123" : "citizen123");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen max-w-[480px] mx-auto relative flex flex-col justify-center px-6 py-10">
      <div className="mesh-bg" />
      <div className="relative z-10">
        <header className="mb-9 text-center">
          <div className="w-16 h-16 mx-auto rounded-[20px] bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white mb-5 shadow-xl shadow-primary/20">
            <Icon name="monitoring" className="text-3xl" fill />
          </div>
          <h1 className="text-4xl font-black font-headline tracking-tight bg-gradient-to-br from-primary to-primary-container bg-clip-text text-transparent">CivicPulse</h1>
          <p className="text-on-variant font-medium mt-2 tracking-widest text-[11px] uppercase opacity-80">AI-verified civic reporting</p>
        </header>

        <main className="glass-strong p-7 rounded-[28px] shadow-2xl shadow-primary/5 border border-white/50">
          <div className="mb-7 bg-surface-high/60 p-1.5 rounded-full flex">
            {["citizen", "authority"].map((r) => (
              <button key={r} onClick={() => setRole(r)}
                className={`flex-1 py-2.5 rounded-full text-[11px] font-bold tracking-widest uppercase transition-all ${role === r ? "bg-white text-primary shadow-sm" : "text-on-variant"}`}>
                {r}
              </button>
            ))}
          </div>

          {mode === "otp" && step === "email" && (
            <form onSubmit={sendCode} className="space-y-4">
              <Field label="Email address">
                <input required type="email" value={form.email} onChange={set("email")} placeholder="you@email.com"
                  className="w-full bg-surface-low border-none rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
              </Field>
              <Field label="Name (new accounts)">
                <input value={form.name} onChange={set("name")} placeholder="Optional for existing users"
                  className="w-full bg-surface-low border-none rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
              </Field>
              {err && <p className="text-error text-sm font-medium">{err}</p>}
              <button disabled={busy}
                className="w-full bg-gradient-to-br from-primary to-primary-container text-white font-bold py-4 rounded-full shadow-lg shadow-primary/20 active:scale-[0.98] transition-all text-sm tracking-widest uppercase disabled:opacity-60">
                {busy ? "Sending…" : "Send one-time code"}
              </button>
            </form>
          )}

          {mode === "otp" && step === "code" && (
            <form onSubmit={verify} className="space-y-4">
              <p className="text-sm text-on-variant">
                Enter the 6-digit code sent to <b>{form.email}</b>.
              </p>
              {devCode && (
                <p className="text-xs bg-primary/10 text-primary rounded-xl px-3 py-2">
                  Dev mode — your code is <b className="tracking-widest">{devCode}</b>
                </p>
              )}
              <input ref={codeRef} required inputMode="numeric" maxLength={6} value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })}
                placeholder="000000"
                className="w-full bg-surface-low border-none rounded-2xl px-5 py-4 text-center text-2xl tracking-[0.5em] font-bold focus:ring-2 focus:ring-primary/30 outline-none" />
              {err && <p className="text-error text-sm font-medium">{err}</p>}
              <button disabled={busy || form.code.length < 4}
                className="w-full bg-gradient-to-br from-primary to-primary-container text-white font-bold py-4 rounded-full shadow-lg shadow-primary/20 active:scale-[0.98] transition-all text-sm tracking-widest uppercase disabled:opacity-60">
                {busy ? "Verifying…" : "Verify & continue"}
              </button>
              <div className="flex justify-between text-xs">
                <button type="button" onClick={() => { setStep("email"); setForm({ ...form, code: "" }); }} className="text-on-variant font-semibold">← Change email</button>
                <button type="button" disabled={secs > 0} onClick={sendCode} className="text-primary font-semibold disabled:opacity-40">
                  {secs > 0 ? `Resend in ${secs}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {mode === "password" && (
            <form onSubmit={pwLogin} className="space-y-4">
              <Field label="Email address">
                <input required type="email" value={form.email} onChange={set("email")} placeholder="you@email.com"
                  className="w-full bg-surface-low border-none rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
              </Field>
              <Field label="Password">
                <input required type="password" value={form.password} onChange={set("password")} placeholder="••••••••"
                  className="w-full bg-surface-low border-none rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
              </Field>
              {err && <p className="text-error text-sm font-medium">{err}</p>}
              <button disabled={busy}
                className="w-full bg-gradient-to-br from-primary to-primary-container text-white font-bold py-4 rounded-full shadow-lg shadow-primary/20 active:scale-[0.98] transition-all text-sm tracking-widest uppercase disabled:opacity-60">
                {busy ? "…" : "Log in"}
              </button>
            </form>
          )}

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-outline-variant/30" />
            <button onClick={() => { setMode(mode === "otp" ? "password" : "otp"); setStep("email"); setErr(""); }}
              className="text-[11px] font-bold text-primary tracking-widest uppercase">
              {mode === "otp" ? "Use password" : "Use email code"}
            </button>
            <div className="h-px flex-1 bg-outline-variant/30" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => demo("citizen")} disabled={busy}
              className="flex flex-col items-center gap-1 bg-white border border-outline-variant/20 py-3 rounded-2xl active:scale-95 transition-all shadow-sm">
              <Icon name="person" className="text-primary" /><span className="text-xs font-bold">Demo citizen</span>
            </button>
            <button onClick={() => demo("authority")} disabled={busy}
              className="flex flex-col items-center gap-1 bg-white border border-outline-variant/20 py-3 rounded-2xl active:scale-95 transition-all shadow-sm">
              <Icon name="apartment" className="text-primary" /><span className="text-xs font-bold">Demo authority</span>
            </button>
          </div>
        </main>

        <div className="mt-9 flex justify-center items-center gap-6 opacity-40">
          {[["verified_user", "SECURE"], ["hub", "AI-VERIFIED"], ["public", "CITY-SCALE"]].map(([i, t]) => (
            <div key={t} className="flex items-center gap-1.5">
              <Icon name={i} className="text-sm" /><span className="text-[10px] font-bold tracking-widest">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-variant ml-2 block">{label}</label>
    {children}
  </div>
);
