import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";

const ACCESS = "civicpulse_access";
const REFRESH = "civicpulse_refresh";

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};

export const getAccess = () => ls.get(ACCESS);
const setTokens = (a, r) => { ls.set(ACCESS, a || ""); if (r !== undefined) ls.set(REFRESH, r || ""); };
const clearTokens = () => { ls.set(ACCESS, ""); ls.set(REFRESH, ""); };

let refreshing = null;
async function tryRefresh() {
  const rt = ls.get(REFRESH);
  if (!rt) return false;
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    }).then(async (r) => {
      if (!r.ok) { clearTokens(); return false; }
      const d = await r.json();
      setTokens(d.access_token, d.refresh_token);
      return true;
    }).catch(() => false).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api(path, { method = "GET", body, auth = true, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getAccess();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && auth && retry && (await tryRefresh())) {
    return api(path, { method, body, auth, retry: false });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`);
  return data;
}

// ---- issues near a point (duplicate / recurrence warning + "issues near <place>") ----
export async function issuesAround(lat, lng, { radius = 350, category, text } = {}) {
  const p = new URLSearchParams({ lat, lng, radius });
  if (category) p.set("category", category);
  if (text) p.set("text", text);
  try { return await api(`/issues/around?${p}`, { auth: !!getAccess() }); }
  catch { return { open: [], resolved: [], count: 0, duplicate_candidates: [], recurrence_candidates: [] }; }
}

// ---- language preference (for voice recognition + a few UI strings) ----
const LANG_KEY = "civitrace_lang";
export function getLang() {
  try { return localStorage.getItem(LANG_KEY) || "en-IN"; } catch { return "en-IN"; }
}
export function useLang() {
  const [lang, setLangState] = useState(getLang);
  useEffect(() => {
    const h = () => setLangState(getLang());
    window.addEventListener("civitrace:lang", h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener("civitrace:lang", h); window.removeEventListener("storage", h); };
  }, []);
  const setLang = useCallback((c) => {
    try { localStorage.setItem(LANG_KEY, c); } catch {}
    setLangState(c);
    window.dispatchEvent(new Event("civitrace:lang"));
  }, []);
  return [lang, setLang];
}

// ---- spoken/typed report -> structured fields (multilingual heuristic NLU) ----
export const parseSpokenReport = (text, lat, lng) =>
  api("/report/parse", { method: "POST", body: { text, lat, lng } });

// ---- "my area" — the community/locality the citizen is currently looking at ----
const AREA_KEY = "civicpulse_area";
export function getArea() {
  try { return JSON.parse(localStorage.getItem(AREA_KEY)) || null; } catch { return null; }
}
export function useArea() {
  const [area, setAreaState] = useState(getArea);
  useEffect(() => {
    const h = (e) => { if (e.key === AREA_KEY) setAreaState(getArea()); };
    window.addEventListener("storage", h);
    window.addEventListener("civicpulse:area", () => setAreaState(getArea()));
    return () => window.removeEventListener("storage", h);
  }, []);
  const setArea = useCallback((a) => {
    try { a ? localStorage.setItem(AREA_KEY, JSON.stringify(a)) : localStorage.removeItem(AREA_KEY); } catch {}
    setAreaState(a);
    window.dispatchEvent(new Event("civicpulse:area"));
  }, []);
  return [area, setArea];
}

// ---- evidence trust / resolution / human review / audit ----
export const evidenceTrust = (id) => api(`/issues/${id}/evidence-trust`, { auth: !!getAccess() });
export const reanalyzeEvidence = (id) => api(`/issues/${id}/evidence/analyze`, { method: "POST" });
export const issueAudit = (id) => api(`/issues/${id}/audit`, { auth: !!getAccess() });
export const citizenConfirm = (id, result, note = "") =>
  api(`/issues/${id}/citizen-confirmation`, { method: "POST", body: { result, note } });
export const reopenIssue = (id) => api(`/issues/${id}/reopen`, { method: "POST" });
export const setIssuePrivacy = (id, opts) => api(`/issues/${id}/privacy`, { method: "POST", body: opts });
export const reviewQueue = () => api("/authority/review-queue");
export const reviewDecide = (rid, decision, note = "") =>
  api(`/authority/review/${rid}/decide`, { method: "POST", body: { decision, note } });
export const fairnessReport = () => api("/authority/fairness");
export const authorityAudit = () => api("/authority/audit");
export const authorityAnalytics = (range = "30d", start, end) => {
  const p = new URLSearchParams({ range });
  if (start) p.set("start", start);
  if (end) p.set("end", end);
  return api(`/authority/analytics?${p}`);
};

// ---- civic services & payments (Razorpay TEST / simulated) ----
export const paymentsConfig = () => api("/payments/config");
export const createPaymentOrder = (service_code) =>
  api("/payments/create-order", { method: "POST", body: { service_code } });
export const verifyPayment = (payload) => api("/payments/verify", { method: "POST", body: payload });
export const paymentsHistory = () => api("/payments/history");
export const paymentReceipt = (id) => api(`/payments/${id}/receipt`);

export function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// ---- public app config (map provider, assistant name) ----
export function useConfig() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api("/config", { auth: false }).then(setCfg).catch(() => setCfg({})); }, []);
  return cfg;
}

// ---- auth context ----
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // demo shortcut: ?demo=citizen|authority (QA / screenshots only)
    const demo = new URLSearchParams(location.search).get("demo");
    if (demo && !getAccess()) {
      try {
        const d = await api("/auth/login", {
          method: "POST", auth: false,
          body: demo === "authority"
            ? { email: "authority@chennai.gov.in", password: "authority123" }
            : { email: "alex@example.com", password: "citizen123" },
        });
        setTokens(d.access_token, d.refresh_token);
        history.replaceState(null, "", location.pathname);
      } catch {}
    }
    if (!getAccess() && !ls.get(REFRESH)) { setUser(null); setLoading(false); return; }
    try {
      setUser(await api("/auth/me"));
    } catch {
      clearTokens(); setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const finish = (d) => { setTokens(d.access_token, d.refresh_token); setUser(d.user); return d.user; };

  return (
    <AuthCtx.Provider value={{
      user, loading, setUser, refresh,
      loginPassword: async (email, password, totp) =>
        finish(await api("/auth/login", { method: "POST", auth: false, body: { email, password, totp } })),
      register: async (payload) =>
        finish(await api("/auth/register", { method: "POST", auth: false, body: payload })),
      otpRequest: (email, name, role) =>
        api("/auth/otp/request", { method: "POST", auth: false, body: { email, name, role } }),
      otpVerify: async (email, code) =>
        finish(await api("/auth/otp/verify", { method: "POST", auth: false, body: { email, code } })),
      logout: async () => {
        const rt = ls.get(REFRESH);
        if (rt) { try { await api("/auth/logout", { method: "POST", auth: false, body: { refresh_token: rt } }); } catch {} }
        clearTokens(); setUser(null);
      },
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

// ---- live websocket feed ----
export function useLiveFeed(onEvent) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    let ws, dead = false, timer;
    const connect = () => {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws`);
        ws.onmessage = (e) => { try { cb.current(JSON.parse(e.data)); } catch {} };
        ws.onclose = () => { if (!dead) timer = setTimeout(connect, 3000); };
      } catch { timer = setTimeout(connect, 3000); }
    };
    connect();
    return () => { dead = true; clearTimeout(timer); try { ws && ws.close(); } catch {} };
  }, []);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ---- forward + reverse geocoding (Photon / Komoot — keyless, CORS-enabled) ----
const GEO = "https://photon.komoot.io";
export async function geocode(q, lat, lng) {
  if (!q || q.trim().length < 2) return [];
  let url = `${GEO}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
  if (lat != null && lng != null) url += `&lat=${lat}&lon=${lng}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return (d.features || []).map((f) => ({
      label: [f.properties.name, f.properties.street, f.properties.city, f.properties.state, f.properties.country]
        .filter(Boolean).join(", "),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    }));
  } catch { return []; }
}
export async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`${GEO}/reverse?lat=${lat}&lon=${lng}&lang=en`);
    const d = await r.json();
    const p = d.features?.[0]?.properties || {};
    return [p.name, p.street, p.district, p.city, p.state].filter(Boolean).join(", ");
  } catch { return ""; }
}
