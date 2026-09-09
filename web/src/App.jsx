import React from "react";
import { Routes, Route, NavLink, Navigate, useLocation, Link } from "react-router-dom";
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

function BottomNav() {
  const tab = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-widest transition-all active:scale-90 ${
      isActive ? "text-primary scale-105" : "text-slate-400"
    }`;
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto z-40 glass flex justify-around items-end px-3 pt-3 pb-7 rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
      <NavLink to="/" end className={tab}>
        {({ isActive }) => (<><Icon name="home" fill={isActive} />Home</>)}
      </NavLink>
      <NavLink to="/map" className={tab}>
        {({ isActive }) => (<><Icon name="map" fill={isActive} />Map</>)}
      </NavLink>
      <NavLink to="/report" className="flex flex-col items-center -mt-9 active:scale-90 transition-transform">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white shadow-xl shadow-primary/30">
          <Icon name="add" className="text-3xl" />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-1.5">Report</span>
      </NavLink>
      <NavLink to="/assistant" className={tab}>
        {({ isActive }) => (<><Icon name="auto_awesome" fill={isActive} />Assist</>)}
      </NavLink>
      <NavLink to="/profile" className={tab}>
        {({ isActive }) => (<><Icon name="person" fill={isActive} />Profile</>)}
      </NavLink>
    </nav>
  );
}

function Shell({ children, bare = false }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  return (
    <div className="min-h-screen max-w-[480px] mx-auto relative bg-surface">
      <div className="mesh-bg" />
      <div className="relative z-10">
        <header className="sticky top-0 z-40 glass px-5 py-3.5 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white">
              <Icon name="monitoring" className="text-lg" fill />
            </div>
            <div className="leading-none">
              <span className="text-xl font-bold font-headline bg-gradient-to-br from-primary to-primary-container bg-clip-text text-transparent">
                CivicPulse
              </span>
              {user?.role === "authority" && (
                <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-primary mt-0.5">
                  Authority
                </span>
              )}
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/emergency" className="text-error active:scale-90 transition-transform" title="Emergency">
              <Icon name="emergency" fill />
            </Link>
            {user?.role === "authority" && (
              <NavLink to="/authority" className={({ isActive }) =>
                `text-xs font-bold px-3 py-1.5 rounded-full ${isActive ? "bg-primary text-white" : "bg-primary/10 text-primary"}`
              }>
                Hub
              </NavLink>
            )}
            <button onClick={logout} title="Log out" className="text-on-variant active:scale-90 transition-transform">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <OfflineBanner />
        <main key={loc.pathname} className={`fadeup ${bare ? "" : "px-5 pt-5 pb-32"}`}>{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="mesh-bg" />
        <Spinner label="Starting CivicPulse…" />
      </div>
    );
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
        <Route path="/authority" element={user.role === "authority" ? <Authority /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Shell>
  );
}
