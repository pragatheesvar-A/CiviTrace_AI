"""
Ward assignment + Fairness metrics  (decision-support prototype).

CivicPulse does not ship official ward boundary polygons, so a report is mapped
to the nearest of a small set of named Chennai zone centroids. This is an
approximation for the prototype — swap in a real GeoJSON ward layer for a
deployment.

The Ward Fairness Dashboard is decision support only: it surfaces where service
*appears* slower so a human can investigate. It does not itself change any
priority or take any action.
"""
from __future__ import annotations

from datetime import timezone

# name -> (lat, lng)  — approximate zone centroids
ZONES: dict[str, tuple[float, float]] = {
    "Thousand Lights": (13.0604, 80.2496),
    "T. Nagar": (13.0418, 80.2341),
    "Mylapore": (13.0330, 80.2680),
    "Vadapalani": (13.0501, 80.2121),
    "Anna Nagar": (13.0846, 80.2101),
    "Adyar": (13.0012, 80.2565),
    "Kodambakkam": (13.0520, 80.2260),
    "Egmore": (13.0732, 80.2609),
    "Perambur": (13.1120, 80.2330),
    "Velachery": (12.9791, 80.2210),
}

# heuristic SLA target (hours) by priority — prototype, not an official SLA
SLA_HOURS = {"critical": 24, "high": 72, "medium": 168, "low": 360}


def assign(lat: float, lng: float) -> str:
    best, best_d = "Unassigned", 1e18
    for name, (wlat, wlng) in ZONES.items():
        d = (lat - wlat) ** 2 + (lng - wlng) ** 2
        if d < best_d:
            best, best_d = name, d
    return best


def _aw(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _hours(a, b) -> float:
    a, b = _aw(a), _aw(b)
    return (b - a).total_seconds() / 3600 if (a and b) else 0.0


def fairness(issues: list, now) -> dict:
    """`issues` is a list of ORM Issue rows (already loaded). `now` is tz-aware."""
    rows: dict[str, dict] = {}
    for i in issues:
        w = assign(i.lat, i.lng)
        r = rows.setdefault(w, {
            "ward": w, "total": 0, "unresolved": 0, "critical_open": 0,
            "_resp": [], "_reso": [], "sla_breaches": 0,
        })
        r["total"] += 1
        resolved = i.status == "Resolved"
        if not resolved:
            r["unresolved"] += 1
            if i.priority == "critical":
                r["critical_open"] += 1
        created = i.created_at
        # first response ~ when it left "Reported"/"Verifying"
        first_move = i.resolved_at or None
        if getattr(i, "assigned_at", None):
            first_move = i.assigned_at
        if first_move:
            r["_resp"].append(_hours(created, first_move))
        if resolved and i.resolved_at:
            hrs = _hours(created, i.resolved_at)
            r["_reso"].append(hrs)
            if hrs > SLA_HOURS.get(i.priority, 168):
                r["sla_breaches"] += 1
        elif not resolved:
            age_h = _hours(created, now)
            if age_h > SLA_HOURS.get(i.priority, 168):
                r["sla_breaches"] += 1

    out = []
    for r in rows.values():
        resp = r.pop("_resp"); reso = r.pop("_reso")
        r["avg_response_hours"] = round(sum(resp) / len(resp), 1) if resp else None
        r["avg_resolution_hours"] = round(sum(reso) / len(reso), 1) if reso else None
        out.append(r)

    # flag "possible service inequality": resolution time well above the median
    med = sorted(x["avg_resolution_hours"] for x in out if x["avg_resolution_hours"] is not None)
    median = med[len(med) // 2] if med else None
    for r in out:
        art = r["avg_resolution_hours"]
        r["possible_inequality"] = bool(
            median and art is not None and art > 1.6 * median and r["unresolved"] >= 3
        )
    out.sort(key=lambda x: (-x["unresolved"], -(x["avg_resolution_hours"] or 0)))
    return {
        "wards": out,
        "median_resolution_hours": median,
        "note": "Decision support only — approximate zone centroids, heuristic SLA "
                "targets, Not Yet Measured. No automatic action is taken.",
    }
