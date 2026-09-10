"""Idempotent demo seed — runs once on an empty DB."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select

import auth as A
from models import Issue, RefreshToken, User, utcnow

try:
    from ai.text_classifier import embed as _embed
except Exception:  # pragma: no cover
    _embed = lambda _t: None


def _emb(text: str):
    try:
        v = _embed(text)
        return [round(float(x), 5) for x in v] if v is not None else None
    except Exception:
        return None

SEED_ISSUES = [
    ("Deep pothole cluster on Anna Salai",
     "Multiple potholes near the bus stop, two-wheelers swerving into traffic.",
     "Roads", 13.0604, 80.2496, "Anna Salai, near Thousand Lights", "critical", True, "vision", 0.91, 3, 0.14),
    ("Pothole on 100 Feet Road", "Large pothole fills with water after rain.",
     "Roads", 13.0501, 80.2121, "100 Feet Rd, Vadapalani", "high", True, "vision", 0.78, 1, 0.05),
    ("Overflowing garbage bin at market", "Bin not cleared for 4 days, stray dogs scattering waste.",
     "Waste", 13.0827, 80.2707, "Mylapore Market", "high", True, "text", 0.72, 0, 0.0),
    ("Broken streetlight on service lane", "Entire stretch dark at night, unsafe for pedestrians.",
     "Electricity", 13.0410, 80.2337, "T. Nagar service lane", "medium", True, "text", 0.66, 0, 0.0),
    ("Water pipeline leak flooding the lane", "Drinking-water main burst two days ago, road eroding.",
     "Water", 13.0731, 80.2609, "Near Santhome School", "high", True, "text", 0.69, 0, 0.0),
    ("Road waterlogged knee-deep after rain", "Whole stretch under water since last night's rain, buses stalled.",
     "Flooding", 13.0688, 80.2201, "Kodambakkam bridge approach", "critical", True, "vision", 0.86, 1, 0.62),
    ("Traffic signal dead at busy junction", "Signal not working since morning, vehicles crossing dangerously.",
     "Traffic", 13.0561, 80.2489, "Panagal Park junction", "high", True, "vision", 0.74, 1, 0.0),
    ("Open manhole without cover on footpath", "Sharp uncovered manhole right on the walking path, children nearby.",
     "Safety", 13.0569, 80.2425, "Panagal Park", "medium", False, "text", 0.44, 0, 0.0),
    ("Faded zebra crossing", "Crossing near junction almost invisible to drivers.",
     "Roads", 13.0640, 80.2500, "Gemini Flyover junction", "low", False, "text", 0.30, 0, 0.0),
]
SEED_RESOLVED = [
    ("Uncovered drain hazard fenced and fixed", "Safety", 13.0600, 80.2450, "Spencer Plaza subway"),
    ("Water leak on Habibullah Road fixed", "Water", 13.0450, 80.2350, "Habibullah Rd"),
]


async def seed(Session):
    async with Session() as s:
        if await s.scalar(select(func.count()).select_from(User)):
            return
        authority = User(email="authority@chennai.gov.in", name="GCC Control Room",
                         password_hash=A.hash_pw("authority123"), role="authority",
                         reports_valid=0, reports_invalid=0)
        alex = User(email="alex@example.com", name="Alex Kumar",
                    password_hash=A.hash_pw("citizen123"), role="citizen", reports_valid=6, reports_invalid=1)
        priya = User(email="priya@example.com", name="Priya R",
                     password_hash=A.hash_pw("citizen123"), role="citizen", reports_valid=9, reports_invalid=0)
        ravi = User(email="ravi@example.com", name="Ravi S",
                    password_hash=A.hash_pw("citizen123"), role="citizen", reports_valid=1, reports_invalid=2)
        s.add_all([authority, alex, priya, ravi])
        await s.flush()
        reporters = [alex, priya, ravi]

        for n, row in enumerate(SEED_ISSUES):
            title, desc, cat, lat, lng, addr, prio, ver, method, conf, det, sev = row
            rep = reporters[n % 3]
            if method == "vision" and cat == "Roads":
                note = f"Stage 1 road-scene 90% -> Stage 2 detected {det} pothole(s) @ {conf:.0%}"
            elif method == "vision" and cat == "Flooding":
                note = f"Water-scene {conf:.0%} + rainfall correlation -> flooding confirmed, severity {sev:.0%}"
            elif method == "vision" and cat == "Traffic":
                note = f"Traffic-scene classifier {conf:.0%} — image shows a signal / junction"
            elif method == "vision":
                note = f"Vision scene classifier {conf:.0%}"
            else:
                note = f"Text classifier (embedding) -> {cat} @ {conf:.0%} (weaker than vision)"
            # honest demo state: only vision matches carry the "AI Verified" badge
            vis = ver and method == "vision"
            ver = vis
            auth_score = round(min(0.97, 0.4 + 0.5 * conf + (0.1 if det else 0.0)), 2) if vis else 0.4
            eta = {"critical": 1.5, "high": 3.0, "medium": 7.0, "low": 14.0}[prio]
            i = Issue(
                title=title, description=desc, category=cat, lat=lat, lng=lng, address=addr,
                priority=prio, priority_score={"critical": .95, "high": .72, "medium": .45, "low": .2}[prio],
                verified=ver, verification_method=method, verification_confidence=conf,
                detection_count=det, severity=sev, verification_note=note,
                evidence=[{"stage": "seed", "note": "demo data"}],
                model_version="clip-vitb32/yolov8m-pothole/minilm-l6-v2/open-meteo @ pipeline-v3",
                authenticity_score=auth_score,
                authenticity={"score": auth_score,
                              "label": "authentic" if auth_score >= 0.7 else "plausible" if auth_score >= 0.45 else "needs review",
                              "flags": [] if ver else ["no photo attached — text-only report"],
                              "checks": {"reporter_trust": 0.7, "scene_pass": 1.0 if method == "vision" else 0.5}},
                eta_days=eta,
                embedding=_emb(f"{title}. {desc}"),
                status="Verified" if ver else "Reported", reporter_id=rep.id,
                upvotes=(n * 3) % 11, ward_weight=0.5,
                created_at=utcnow() - timedelta(hours=6 * n + 2),
            )
            s.add(i)
            await s.flush()
            i.cluster_id = i.id
            rep.points += 15 + i.upvotes

        for title, cat, lat, lng, addr in SEED_RESOLVED:
            i = Issue(title=title, description="Resolved by municipal crew.", category=cat,
                      lat=lat, lng=lng, address=addr, priority="medium", priority_score=0.45,
                      verified=True, verification_method="text", verification_confidence=0.6,
                      embedding=_emb(f"{title}. Resolved by municipal crew."),
                      resolution_verified=True,
                      resolution_note="Proof photo: scene 88% · distinct from the original — accepted.",
                      status="Resolved", reporter_id=priya.id, upvotes=5, ward_weight=0.5,
                      created_at=utcnow() - timedelta(days=4), resolved_at=utcnow() - timedelta(days=1))
            s.add(i)
            await s.flush()
            i.cluster_id = i.id
            priya.points += 25
        await s.commit()
