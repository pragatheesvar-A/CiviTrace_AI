import React, { useState } from "react";
import { useAuth } from "../api.jsx";
import { Icon } from "../ui.jsx";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("citizen");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register({ ...form, role });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function demo(kind) {
    setErr(""); setBusy(true);
    try {
      await login(
        kind === "authority" ? "authority@chennai.gov.in" : "alex@example.com",
        kind === "authority" ? "authority123" : "citizen123"
      );
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen max-w-[480px] mx-auto relative flex flex-col justify-center px-6 py-10">
      <div className="mesh-bg" />
      <div className="relative z-10">
        <header className="mb-10 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white mb-5 shadow-xl shadow-primary/20">
            <Icon name="monitoring" className="text-3xl" fill />
          </div>
          <h1 className="text-4xl font-black font-headline tracking-tight bg-gradient-to-br from-primary to-primary-container bg-clip-text text-transparent">
            CivicPulse
          </h1>
          <p className="text-on-variant font-medium mt-2 tracking-wide text-[11px] uppercase opacity-80">
            AI-verified civic reporting
          </p>
        </header>

        <main className="glass-strong p-7 rounded-[2rem] shadow-2xl shadow-primary/5 border border-white/50">
          <div className="mb-8 bg-surface-high/60 p-1.5 rounded-full flex">
            {["citizen", "authority"].map((r) => (
              <button key={r} onClick={() => setRole(r)}
                className={`flex-1 py-2.5 rounded-full text-[11px] font-bold tracking-widest uppercase transition-all ${
                  role === r ? "bg-white text-primary shadow-sm" : "text-on-variant"
                }`}>
                {r}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <Field label="Full name">
                <input required value={form.name} onChange={set("name")} placeholder="Your name"
                  className="w-full bg-surface-low border-none rounded-xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
              </Field>
            )}
            <Field label="Email address">
              <input required type="email" value={form.email} onChange={set("email")} placeholder="name@civic.in"
                className="w-full bg-surface-low border-none rounded-xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
            </Field>
            <Field label="Password">
              <input required type="password" value={form.password} onChange={set("password")} placeholder="••••••••"
                className="w-full bg-surface-low border-none rounded-xl px-5 py-3.5 focus:ring-2 focus:ring-primary/30 outline-none" />
            </Field>
            {err && <p className="text-error text-sm font-medium">{err}</p>}
            <button disabled={busy}
              className="w-full bg-gradient-to-br from-primary to-primary-container text-white font-bold py-4 rounded-full shadow-lg shadow-primary/20 active:scale-[0.98] transition-all text-sm tracking-widest uppercase disabled:opacity-60">
              {busy ? "Please wait…" : mode === "login" ? "Login" : "Create account"}
            </button>
          </form>

          <div className="my-7 flex items-center gap-4">
            <div className="h-px flex-1 bg-outline-variant/30" />
            <span className="text-[10px] font-bold text-slate-400 tracking-widest">OR TRY A DEMO</span>
            <div className="h-px flex-1 bg-outline-variant/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => demo("citizen")} disabled={busy}
              className="flex flex-col items-center gap-1 bg-white border border-outline-variant/20 py-3 rounded-2xl active:scale-95 transition-all shadow-sm">
              <Icon name="person" className="text-primary" />
              <span className="text-xs font-bold">Citizen</span>
            </button>
            <button onClick={() => demo("authority")} disabled={busy}
              className="flex flex-col items-center gap-1 bg-white border border-outline-variant/20 py-3 rounded-2xl active:scale-95 transition-all shadow-sm">
              <Icon name="apartment" className="text-primary" />
              <span className="text-xs font-bold">Authority</span>
            </button>
          </div>

          <footer className="mt-8 text-center">
            <button onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="text-sm text-on-variant">
              {mode === "login" ? "New to the platform? " : "Already have an account? "}
              <span className="text-primary font-bold">{mode === "login" ? "Create an account" : "Log in"}</span>
            </button>
          </footer>
        </main>

        <div className="mt-10 flex justify-center items-center gap-7 opacity-40">
          {[["verified_user", "SECURE"], ["hub", "AI-VERIFIED"], ["public", "CITY-SCALE"]].map(([i, t]) => (
            <div key={t} className="flex items-center gap-1.5">
              <Icon name={i} className="text-sm" />
              <span className="text-[10px] font-bold tracking-widest">{t}</span>
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
