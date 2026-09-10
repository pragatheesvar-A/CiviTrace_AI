"""
Multi-signal spatio-semantic deduplication.

Contribution: most civic apps dedupe on distance alone (or not at all). We fuse
three signals into one dissimilarity used by DBSCAN:

    d(a,b) = w_geo * (haversine_m / radius)
           + w_txt * (1 - cosine(embed_a, embed_b))
           + w_cat * 1[cat_a != cat_b]
           + w_time* min(1, |t_a - t_b| / 14 days)

Two reports collapse into one tracked issue when d < 1. This cuts the triage
load when many citizens report the same pothole, and the cluster size becomes a
priority signal instead of noise.

`assign_cluster` is the online path (new report vs existing open issues);
`recluster` is the batch path an operator can trigger.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from config import settings

W_GEO, W_TXT, W_CAT, W_TIME = 0.55, 0.30, 0.10, 0.05


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _cos(a, b) -> float:
    if a is None or b is None:
        return 0.0
    import numpy as np

    a, b = np.asarray(a, dtype="float32"), np.asarray(b, dtype="float32")
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@dataclass
class Candidate:
    id: int
    cluster_id: int
    lat: float
    lng: float
    category: str
    created_ts: float
    embedding: object | None


def dissimilarity(new: Candidate, other: Candidate) -> float:
    geo = min(1.0, haversine_m(new.lat, new.lng, other.lat, other.lng) / settings.dedupe_radius_m)
    txt = 1.0 - _cos(new.embedding, other.embedding)
    cat = 0.0 if new.category == other.category else 1.0
    tim = min(1.0, abs(new.created_ts - other.created_ts) / (14 * 86400))
    return W_GEO * geo + W_TXT * txt + W_CAT * cat + W_TIME * tim


def assign_cluster(new: Candidate, existing: list[Candidate]) -> tuple[int, float, int]:
    """Return (cluster_id_to_use, best_dissimilarity, matched_issue_id or 0)."""
    best_d, best = 2.0, None
    for c in existing:
        d = dissimilarity(new, c)
        if d < best_d:
            best_d, best = d, c
    if best is not None and best_d < 1.0:
        return (best.cluster_id or best.id), round(best_d, 3), best.id
    return 0, round(best_d, 3), 0  # 0 -> caller assigns a fresh cluster id (its own id)
