import React, { useState } from "react";
import { useAuth } from "../api.jsx";
import { Icon } from "../ui.jsx";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "citizen" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function demo(email) {
    setForm({ ...form, email, password: email.includes("authority") ? "authority123" : "citizen123" });
    setMode("login");
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center px-6 max-w-lg mx-auto">
      <div className="mb-10">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white mb-6">
          <Icon name="monitoring" className="text-3xl" />
        </div>
        <h1 className="text-5xl font-bold leading-tight">CivicPulse</h1>
        <p className="text-on-variant mt-3 text-lg opacity-70">
          Report a city issue in under a minute. Verified by AI, tracked to resolution.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "register" && (
          <input required placeholder="Full name" value={form.name} onChange={set("name")}
            className="w-full bg-surface-high/60 border-none rounded-lg py-4 px-5 text-lg focus:ring-2 focus:ring-primary" />
        )}
        <input required type="email" placeholder="Email" value={form.email} onChange={set("email")}
          className="w-full bg-surface-high/60 border-none rounded-lg py-4 px-5 text-lg focus:ring-2 focus:ring-primary" />
        <input required type="password" placeholder="Password" value={form.password} onChange={set("password")}
          className="w-full bg-surface-high/60 border-none rounded-lg py-4 px-5 text-lg focus:ring-2 focus:ring-primary" />
        {mode === "register" && (
          <select value={form.role} onChange={set("role")}
            className="w-full bg-surface-high/60 border-none rounded-lg py-4 px-5 text-lg focus:ring-2 focus:ring-primary">
            <option value="citizen">Citizen</option>
            <option value="authority">Municipal authority</option>
          </select>
        )}
        {err && <p className="text-error text-sm font-medium">{err}</p>}
        <button disabled={busy}
          className="w-full py-4 rounded-full bg-gradient-to-r from-primary to-primary-container text-white font-bold text-lg disabled:opacity-60">
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      <button onClick={() => setMode(mode === "login" ? "register" : "login")}
        className="mt-5 text-primary font-semibold text-sm">
        {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
      </button>

      <div className="mt-10 pt-6">
        <p className="text-xs uppercase tracking-widest text-on-variant font-bold mb-3">Demo logins</p>
        <div className="flex gap-3">
          <button onClick={() => demo("alex@example.com")}
            className="flex-1 bg-white rounded-lg py-3 px-4 text-left shadow-sm">
            <span className="block font-bold text-sm">Citizen</span>
            <span className="text-xs text-on-variant">alex@example.com</span>
          </button>
          <button onClick={() => demo("authority@chennai.gov.in")}
            className="flex-1 bg-white rounded-lg py-3 px-4 text-left shadow-sm">
            <span className="block font-bold text-sm">Authority</span>
            <span className="text-xs text-on-variant">GCC Control Room</span>
          </button>
        </div>
      </div>
    </div>
  );
}
