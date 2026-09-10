import React from "react";
import { Routes, Route, NavLink, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "./api.jsx";
import { Icon, Spinner, OfflineBanner } from "./ui.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import MapView from "./pages/MapView.jsx";
import Report from "./pages/Report.jsx";
import IssueDetail from "./pages/IssueDetail.jsx";
import Profile from "./pages/Profile.jsx";
import Assistant from "./pages/Assistant.jsx";
import Authority from "./pages/Authority.jsx";
import Emergency from "./pages/Emergency.jsx";

class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error(err, info); }
  render() {
    if (this.state.err) {
      return (
        <div className="min-h-screen grid place-items-center p-8 text-center">
          <div>
            <p className="text-lg font-bold mb-2">Something went wrong on this screen.</p>
            <p className="text-sm text-on-variant mb-4">{String(this.state.err?.message || this.state.err)}</p>
            <button onClick={() => { this.setState({ err: null }); location.hash = ""; location.assign("/"); }}
              className="px-5 py-2.5 rounded-full bg-primary text-white font-bold">Back to home</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function BottomNav() {
  const tab = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-widest transition-all active:scale-90 ${
      isActive ? "text-primary" : "text-slate-400"
    }`;
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto z-40 glass flex justify-around items-end px-2 pt-2.5
                    rounded-t-[1.75rem] shadow-[0_-10px_40px_rgba(0,0,0,0.06)]"
         style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)" }}>
      <NavLink to="/" end className={tab}>{({ isActive }) => (<><Icon name="home" fill={isActive} />Home</>)}</NavLink>
      <NavLink to="/map" className={tab}>{({ isActive }) => (<><Icon name="map" fill={isActive} />Map</>)}</NavLink>
      <NavLink to="/report" className="flex flex-col items-center -mt-8 active:scale-90 transition-transform">
        <div className="w-[58px] h-[58px] rounded-full bg-gradient-to-br from-primary to-primary-container
                        flex items-center justify-center text-white shadow-xl shadow-primary/30">
          <Icon name="add" className="text-3xl" />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-1">Report</span>
      </NavLink>
      <NavLink to="/assistant" className={tab}>{({ isActive }) => (<><Icon name="forum" fill={isActive} />Assist</>)}</NavLink>
      <NavLink to="/profile" className={tab}>{({ isActive }) => (<><Icon name="person" fill={isActive} />Profile</>)}</NavLink>
    </nav>
  );
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen max-w-[480px] mx-auto relative bg-surface"
         style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="mesh-bg" />
      <div className="relative z-10">
        <header className="sticky top-0 z-40 glass px-5 py-3 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white">
              <Icon name="monitoring" className="text-lg" fill />
            </div>
            <div className="leading-none">
              <span className="text-lg font-bold font-headline bg-gradient-to-br from-primary to-primary-container bg-clip-text text-transparent">
                CivicPulse
              </span>
              {user?.role === "authority" &&
                <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-primary mt-0.5">Authority</span>}
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/emergency" title="Emergency" className="text-error active:scale-90 transition-transform">
              <Icon name="e911_emergency" fill />
            </Link>
            {user?.role === "authority" && (
              <NavLink to="/authority" className={({ isActive }) =>
                `text-xs font-bold px-3 py-1.5 rounded-full ${isActive ? "bg-primary text-white" : "bg-primary/10 text-primary"}`}>
                Hub
              </NavLink>
            )}
            <button onClick={logout} title="Log out" className="text-on-variant active:scale-90 transition-transform">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <OfflineBanner />
        <main className="px-5 pt-5 pb-28">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  useLocation(); // keep Shell subscribed to route changes without remounting children
  if (loading) {
    return <div className="min-h-screen grid place-items-center"><div className="mesh-bg" /><Spinner label="Starting CivicPulse…" /></div>;
  }
  if (!user) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/report" element={<Report />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/emergency" element={<Emergency />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/authority" element={user.role === "authority" ? <Authority /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
