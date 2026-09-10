// Tiny dependency-free SVG charts for the Authority analytics dashboard.
// Palette matches the app tokens. Every chart renders an empty state.
import React from "react";
import { Icon } from "./ui.jsx";

const C = {
  primary: "#0d5c63", secondary: "#1f7a4d", accent: "#c2703d", error: "#c0362c",
  grid: "rgba(26,28,26,0.08)", axis: "#8a8b83",
};
export const SERIES = [C.primary, C.accent, C.error, C.secondary, "#6b7280"];

export function Panel({ title, hint, children, right }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm card-line">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          {hint && <p className="text-[11px] text-on-variant">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Empty({ text = "No sufficient data yet" }) {
  return (
    <div className="py-8 text-center text-xs text-on-variant flex flex-col items-center gap-1">
      <Icon name="bar_chart" className="text-2xl text-slate-300" />
      {text}
    </div>
  );
}

export function KpiCard({ label, value, sub, tone }) {
  return (
    <div className="bg-white rounded-2xl p-3.5 shadow-sm card-line">
      <p className="text-2xl font-black font-headline leading-none" style={tone ? { color: tone } : undefined}>
        {value ?? "—"}
      </p>
      <p className="text-[10px] text-on-variant uppercase tracking-wide mt-1.5">{label}</p>
      {sub && <p className="text-[11px] text-on-variant mt-0.5">{sub}</p>}
    </div>
  );
}

// Multi-series line chart. series = [{ name, color, data:[n] }], labels = [str]
export function LineChart({ labels = [], series = [], height = 130 }) {
  const flat = series.flatMap((s) => s.data);
  if (!labels.length || !flat.some((v) => v > 0)) return <Empty />;
  const W = 320, H = height, pad = { l: 22, r: 6, t: 8, b: 16 };
  const max = Math.max(1, ...flat);
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, labels.length - 1);
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (d) => d.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const ticks = [0, Math.round(max / 2), max];
  const step = Math.max(1, Math.floor(labels.length / 4));
  return (
    <div className="overflow-x-auto no-scrollbar">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={C.grid} />
            <text x={0} y={y(t) + 3} fontSize="8" fill={C.axis}>{t}</text>
          </g>
        ))}
        {series.map((s, n) => (
          <g key={s.name}>
            <path d={path(s.data)} fill="none" stroke={s.color || SERIES[n]} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
            {s.data.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="1.6" fill={s.color || SERIES[n]} />
            ))}
          </g>
        ))}
        {labels.map((l, i) => (i % step === 0 || i === labels.length - 1) && (
          <text key={i} x={x(i)} y={H - 4} fontSize="7.5" fill={C.axis} textAnchor="middle">
            {l.slice(5)}
          </text>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-1">
          {series.map((s, n) => (
            <span key={s.name} className="text-[10px] flex items-center gap-1 text-on-variant">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color || SERIES[n] }} />{s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Horizontal bar chart. rows = [{ label, value, color? }]
export function BarChart({ rows = [], unit = "", max: fixedMax }) {
  const clean = rows.filter((r) => r && r.value != null);
  if (!clean.length || !clean.some((r) => r.value > 0)) return <Empty />;
  const max = fixedMax || Math.max(1, ...clean.map((r) => r.value));
  return (
    <div className="space-y-2">
      {clean.map((r, n) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-[11px] w-24 shrink-0 truncate text-on-variant">{r.label}</span>
          <div className="flex-1 h-3 bg-surface-high rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{
              width: `${Math.max(4, (r.value / max) * 100)}%`, background: r.color || SERIES[n % SERIES.length],
            }} />
          </div>
          <span className="text-[11px] font-bold w-12 text-right">{r.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

// Donut chart. slices = [{ label, value, color? }]
export function DonutChart({ slices = [] }) {
  const clean = slices.filter((s) => s && s.value > 0);
  const total = clean.reduce((a, s) => a + s.value, 0);
  if (!total) return <Empty />;
  const R = 42, r = 26, cx = 55, cy = 55;
  let acc = 0;
  const arc = (frac) => {
    const a0 = acc * 2 * Math.PI - Math.PI / 2;
    acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1);
    const [xi1, yi1] = p(r, a1), [xi0, yi0] = p(r, a0);
    return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${xi1} ${yi1} A${r} ${r} 0 ${large} 0 ${xi0} ${yi0} Z`;
  };
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="w-24 h-24 shrink-0">
        {clean.map((s, n) => (
          <path key={s.label} d={arc(s.value / total)} fill={s.color || SERIES[n % SERIES.length]} />
        ))}
      </svg>
      <ul className="space-y-1 flex-1">
        {clean.map((s, n) => (
          <li key={s.label} className="text-[11px] flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-on-variant">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color || SERIES[n % SERIES.length] }} />
              {s.label}
            </span>
            <span className="font-bold">{s.value} · {Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
