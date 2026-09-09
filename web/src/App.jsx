import React from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./api.jsx";
import { Icon, Spinner } from "./ui.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import MapView from "./pages/MapView.jsx";
import Report from "./pages/Report.jsx";
import IssueDetail from "./pages/IssueDetail.jsx";
import Profile from "./pages/Profile.jsx";
import Assistant from "./pages/Assistant.jsx";
import Authority from "./pages/Authority.jsx";

const TABS = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/map", icon: "map", label: "Map" },
  { to: "/report", icon: "add_circle", label: "Report", big: true },
  { to: "/assistant", icon: "auto_awesome", label: "Assistant" },
  { to: "/profile", icon: "person", label: "Profile" },
];

function Shell({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-surface text-on-surface max-w-lg mx-auto relative pb-28">
      <header className="sticky top-0 z-40 glass px-5 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white">
            <Icon name="monitoring" className="text-lg" />
          </div>
          <span className="text-xl font-bold font-headline bg-gradient-to-br from-primary to-primary-container bg-clip-text text-transparent">
            CivicPulse
          </span>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === "authority" && (
            <NavLink
              to="/authority"
              className={({ isActive }) =>
                `text-xs font-bold px-3 py-1.5 rounded-full ${
                  isActive ? "bg-primary text-white" : "bg-primary/10 text-primary"
                }`
              }
            >
              Authority Hub
            </NavLink>
          )}
          <button onClick={logout} title="Log out" className="text-on-variant">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <main key={loc.pathname} className="px-5 pt-5">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-40 glass flex justify-around items-center px-3 pt-3 pb-6 rounded-t-xl shadow-[0_-8px_30px_rgba(0,0,0,0.05)]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-all ${
                isActive ? "text-primary scale-105" : "text-slate-400"
              }`
            }
          >
            <Icon name={t.icon} className={t.big ? "text-4xl text-primary" : "text-2xl"} />
            {!t.big && t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner /></div>;
  if (!user) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/report" element={<Report />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route
          path="/authority"
          element={user.role === "authority" ? <Authority /> : <Navigate to="/" />}
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Shell>
  );
}
