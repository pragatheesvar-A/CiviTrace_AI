"""
Authority analytics — every number is computed from the real ``issues`` table
(and votes / audit rows). Nothing here is hard-coded. When there is not enough
data for a figure it returns ``None`` and the UI shows "No sufficient data yet".

Rule-based "AI Insights" are generated only from the actual aggregates and are
labelled as prototype (rule-based, not ML).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

try:
    from ai.wards import assign as ward_of, SLA_HOURS
except Exception:  # pragma: no cover
    def ward_of(lat, lng):
        return "Unassigned"
    SLA_HOURS = {"critical": 24, "high": 72, "medium": 168, "low": 360}

CLOSED = {"Resolved", "Verified Closed"}
OPEN_ISH = {"Reported", "Verifying", "Verified", "Assigned", "In Progress",
            "AI Verified — Awaiting Confirmation"}


def _aw(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _days(a, b):
    a, b = _aw(a), _aw(b)
    return (b - a).total_seconds() / 86400 if (a and b) else None


def range_start(key: str, now: datetime):
    return {
        "today": now - timedelta(days=1),
        "7d": now - timedelta(days=7),
        "30d": now - timedelta(days=30),
        "90d": now - timedelta(days=90),
    }.get(key)


def compute(issues: list, votes_by_issue: dict[int, int], now: datetime,
            since: datetime | None = None, until: datetime | None = None) -> dict:
    # window filter is on *creation* date; resolution stats still look at
    # resolved_at inside the window for trend accuracy.
    def in_win(i):
        c = _aw(i.created_at)
        if since and c and c < since:
            return False
        if until and c and c > until:
            return False
        return True

    scoped = [i for i in issues if in_win(i)]
    total = len(scoped)

    verified = sum(1 for i in scoped if i.verified or i.status in (
        "Verified", "AI Verified — Awaiting Confirmation") or i.status in CLOSED)
    resolved = [i for i in scoped if i.status in CLOSED]
    in_progress = sum(1 for i in scoped if i.status == "In Progress")
    open_now = sum(1 for i in scoped if i.status in OPEN_ISH)
    reopened = sum(1 for i in scoped if (i.reopen_count or 0) > 0)
    high_pri = sum(1 for i in scoped if i.priority in ("critical", "high"))
    confirmations = sum(votes_by_issue.get(i.id, 0) for i in scoped) \
        + sum(1 for i in scoped if i.citizen_confirmation == "fixed")
    trust_vals = [i.evidence_trust for i in scoped if i.evidence_trust]
    res_spans = [d for i in resolved if (d := _days(i.created_at, i.resolved_at)) is not None]

    kpis = {
        "total": total,
        "verified": verified,
        "open": open_now,
        "in_progress": in_progress,
        "resolved": len(resolved),
        "reopened": reopened,
        "high_priority": high_pri,
        "community_confirmations": confirmations,
        "avg_resolution_days": round(sum(res_spans) / len(res_spans), 1) if res_spans else None,
        "avg_evidence_trust": round(sum(trust_vals) / len(trust_vals)) if trust_vals else None,
        "awaiting_citizen_confirmation": sum(1 for i in scoped if i.awaiting_confirmation),
    }

    # ---- time series (bucketed by day over the window or last 30d) ----
    lo = since or (now - timedelta(days=30))
    span_days = max(1, min(120, int((_aw(now) - _aw(lo)).total_seconds() // 86400) + 1))
    keys = [(now - timedelta(days=span_days - 1 - k)).strftime("%Y-%m-%d") for k in range(span_days)]
    reported_d = Counter()
    resolved_d = Counter()
    reopened_d = Counter()
    for i in scoped:
        c = _aw(i.created_at)
        if c:
            reported_d[c.strftime("%Y-%m-%d")] += 1
    for i in issues:  # resolution/reopen trend across all issues in the date window
        r = _aw(i.resolved_at)
        if r and (not since or r >= since):
            resolved_d[r.strftime("%Y-%m-%d")] += 1
        if (i.reopen_count or 0) > 0:
            u = _aw(i.created_at)
            if u:
                reopened_d[u.strftime("%Y-%m-%d")] += 1
    time_series = {
        "labels": keys,
        "reported": [reported_d.get(k, 0) for k in keys],
        "resolved": [resolved_d.get(k, 0) for k in keys],
        "reopened": [reopened_d.get(k, 0) for k in keys],
    }

    # ---- distributions ----
    by_category = Counter(i.category for i in scoped)
    by_status = Counter(i.status for i in scoped)
    by_priority = Counter(i.priority for i in scoped)

    # ---- resolution performance by category ----
    cat_spans: dict[str, list] = defaultdict(list)
    for i in resolved:
        d = _days(i.created_at, i.resolved_at)
        if d is not None:
            cat_spans[i.category].append(d)
    resolution_perf = {c: round(sum(v) / len(v), 1) for c, v in cat_spans.items() if v}

    # ---- area / ward performance ----
    areas: dict[str, dict] = {}
    for i in scoped:
        w = (i.ward or ward_of(i.lat, i.lng)) or "Unassigned"
        a = areas.setdefault(w, {"area": w, "total": 0, "open": 0, "resolved": 0,
                                 "reopened": 0, "_spans": [], "_pri": Counter()})
        a["total"] += 1
        a["_pri"][i.priority] += 1
        if i.status in CLOSED:
            a["resolved"] += 1
            d = _days(i.created_at, i.resolved_at)
            if d is not None:
                a["_spans"].append(d)
        elif i.status in OPEN_ISH:
            a["open"] += 1
        if (i.reopen_count or 0) > 0:
            a["reopened"] += 1
    area_performance = []
    for a in areas.values():
        spans = a.pop("_spans")
        pri = a.pop("_pri")
        a["avg_resolution_days"] = round(sum(spans) / len(spans), 1) if spans else None
        a["resolution_rate"] = round(100 * a["resolved"] / a["total"]) if a["total"] else 0
        a["dominant_priority"] = (pri.most_common(1)[0][0] if pri else "low")
        area_performance.append(a)
    area_performance.sort(key=lambda x: (-x["total"], -(x["open"])))

    # ---- resolution analytics ----
    verified_closed = [i for i in resolved if i.status == "Verified Closed"]
    ai_verified_res = sum(1 for i in resolved if i.resolution_verified)
    citizen_confirmed = sum(1 for i in resolved if i.citizen_confirmation == "fixed")
    reopened_after = sum(1 for i in issues if (i.reopen_count or 0) > 0)
    conf_vals = [i.resolution_confidence for i in resolved if i.resolution_confidence]
    resolution_analytics = {
        "total_resolved": len(resolved),
        "successfully_closed": len(verified_closed),
        "reopened_after_resolution": reopened_after,
        "ai_verified_resolutions": ai_verified_res,
        "citizen_confirmed_resolutions": citizen_confirmed,
        "avg_resolution_confidence": round(sum(conf_vals) / len(conf_vals)) if conf_vals else None,
        "avg_resolution_days": round(sum(res_spans) / len(res_spans), 1) if res_spans else None,
        "fastest_resolution_days": round(min(res_spans), 1) if res_spans else None,
        "slowest_resolution_days": round(max(res_spans), 1) if res_spans else None,
        "resolution_rate": round(100 * len(resolved) / total, 1) if total else None,
    }

    # ---- community validation over time ----
    conf_series = {"labels": keys, "confirmations": [reported_d.get(k, 0) and 0 for k in keys]}
    cd = Counter()
    for i in scoped:
        c = _aw(i.created_at)
        if c:
            cd[c.strftime("%Y-%m-%d")] += votes_by_issue.get(i.id, 0)
    conf_series["confirmations"] = [cd.get(k, 0) for k in keys]

    # ---- rule-based insights (prototype) ----
    insights = _insights(scoped, by_category, resolution_perf, area_performance,
                         reopened_after, kpis)

    return {
        "range": {"since": since.isoformat() if since else None,
                  "until": (until or now).isoformat(), "generated_at": now.isoformat()},
        "kpis": kpis,
        "time_series": time_series,
        "by_category": dict(by_category),
        "by_status": dict(by_status),
        "by_priority": {k: by_priority.get(k, 0) for k in ("critical", "high", "medium", "low")},
        "resolution_perf": resolution_perf,
        "area_performance": area_performance,
        "resolution_analytics": resolution_analytics,
        "community_validation": conf_series,
        "insights": insights,
        "prototype": True,
        "note": "All figures are computed live from the issues table. Insights are "
                "rule-based (prototype), not ML-generated.",
    }


def _insights(scoped, by_category, resolution_perf, area_performance, reopened_after, kpis):
    out: list[dict] = []
    if len(scoped) < 5:
        return out
    if by_category:
        top, n = by_category.most_common(1)[0]
        if n >= 3:
            out.append({"kind": "category", "text":
                        f"{top} is the most reported category ({n} of {len(scoped)} reports)."})
    if resolution_perf and len(resolution_perf) >= 2:
        avg = sum(resolution_perf.values()) / len(resolution_perf)
        worst = max(resolution_perf, key=resolution_perf.get)
        if resolution_perf[worst] > 1.4 * avg:
            out.append({"kind": "resolution", "text":
                        f"{worst} issues take longer to resolve "
                        f"({resolution_perf[worst]}d vs {round(avg, 1)}d system average)."})
    hot = [a for a in area_performance if a["open"] >= 3 and a["resolution_rate"] < 60]
    if hot:
        a = hot[0]
        out.append({"kind": "area", "text":
                    f"{a['area']} has a high concentration of unresolved reports "
                    f"({a['open']} open, {a['resolution_rate']}% resolution rate)."})
    if reopened_after >= 3:
        out.append({"kind": "reopen", "text":
                    f"{reopened_after} issue(s) were reopened after being marked resolved — "
                    "resolution quality may need review."})
    if kpis["avg_evidence_trust"] is not None and kpis["avg_evidence_trust"] < 55:
        out.append({"kind": "trust", "text":
                    f"Average Evidence Trust is {kpis['avg_evidence_trust']}/100 — many reports "
                    "would benefit from a clearer photo or description."})
    return out
