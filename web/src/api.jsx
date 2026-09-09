import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const TOKEN_KEY = "civicpulse_token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`);
  return data;
}

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try { setUser(await api("/auth/me")); }
    catch { setToken(null); setUser(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function login(email, password) {
    const d = await api("/auth/login", { method: "POST", body: { email, password }, auth: false });
    setToken(d.token); setUser(d.user); return d.user;
  }
  async function register(payload) {
    const d = await api("/auth/register", { method: "POST", body: payload, auth: false });
    setToken(d.token); setUser(d.user); return d.user;
  }
  function logout() { setToken(null); setUser(null); }

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refresh, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

export function useLiveFeed(onEvent) {
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch {} };
    } catch {}
    return () => { try { ws && ws.close(); } catch {} };
  }, [onEvent]);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
