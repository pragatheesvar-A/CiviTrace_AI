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
import Payments from "./pages/Payments.jsx";

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
    `flex flex-col items-center justify-center gap-1 text-[10px] font-semibold tracking-wide transition-all active:scale-90 ${
      isActive ? "text-primary" : "text-on-variant/55"
    }`;
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto z-40 glass-strong flex justify-around items-end px-2 pt-3
                    rounded-t-[1.4rem] border-t border-on-surface/[0.06]"
         style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)" }}>
      <NavLink to="/" end className={tab}>{({ isActive }) => (<><Icon name="home" fill={isActive} />Home</>)}</NavLink>
      <NavLink to="/map" className={tab}>{({ isActive }) => (<><Icon name="explore" fill={isActive} />Map</>)}</NavLink>
      <NavLink to="/report" className="flex flex-col items-center -mt-7 active:scale-90 transition-transform">
        <div className="w-[54px] h-[54px] rounded-[18px] bg-primary rotate-45
                        flex items-center justify-center text-white shadow-lg shadow-primary/25">
          <Icon name="add" className="text-2xl -rotate-45" />
        </div>
        <span className="text-[10px] font-semibold tracking-wide text-on-variant/55 mt-1.5">Report</span>
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
        <header className="sticky top-0 z-40 glass px-5 py-3 flex justify-between items-center border-b border-on-surface/[0.06]">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center text-white">
              <Icon name="graph_3" className="text-base" fill />
            </div>
            <div className="leading-none">
              <span className="text-[17px] font-bold font-headline text-on-surface tracking-tight">
Civi<span className="text-primary">Trace</span> AI
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
    return <div className="min-h-screen grid place-items-center"><div className="mesh-bg" /><Spinner label="Starting CiviTrace AI…" /></div>;
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
        <Route path="/services" element={<Payments />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/authority" element={user.role === "authority" ? <Authority /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
