"""
CivicPulse backend — FastAPI + SQLAlchemy (async) + SQLite.

End-to-end API for the civic issue reporting platform:
auth (JWT + roles), issue reporting, AI verification pipeline,
proximity deduplication, priority scoring, community layer
(upvotes / adopt / comments / civic points / leaderboard),
authority triage queue + KPI dashboard + rainfall digital-twin,
and a WebSocket channel for live updates.

Honest note: the vision "verification" here is a deterministic heuristic
stand-in for the CLIP + YOLOv8 pipeline described in the product write-up.
It models the same two-stage gate (scene relevance -> object detection)
so the API contract and downstream priority logic are real and testable.
"""
from __future__ import annotations

import base64
import hashlib
import io
import math
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from PIL import Image
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func, select,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, selectinload

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_URL = os.environ.get("CIVICPULSE_DB", f"sqlite+aiosqlite:///{os.path.join(BASE_DIR, 'civicpulse.db')}")
UPLOAD_DIR = os.path.join(os.path.dirname(BASE_DIR), "uploads")
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")
SECRET_KEY = os.environ.get("CIVICPULSE_SECRET", "dev-secret-change-me-in-prod")
ALGORITHM = "HS256"
TOKEN_TTL_MIN = 60 * 24 * 7

CATEGORIES = ["Roads", "Sanitation", "Utilities", "Drainage", "Public Property"]
VISION_CATEGORIES = {"Roads"}
DEDUPE_RADIUS_M = 60.0

os.makedirs(UPLOAD_DIR, exist_ok=True)

engine = create_async_engine(DB_URL, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="citizen")  # citizen | authority
    points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Issue(Base):
    __tablename__ = "issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default="Reported", index=True)
    # Reported -> Verified -> Assigned -> In Progress -> Resolved
    priority: Mapped[str] = mapped_column(String(20), default="medium", index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    address: Mapped[str] = mapped_column(String(255), default="")
    photo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    after_photo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_method: Mapped[str] = mapped_column(String(20), default="none")  # vision | text | none
    verification_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    detection_count: Mapped[int] = mapped_column(Integer, default=0)
    verification_note: Mapped[str] = mapped_column(String(255), default="")

    cluster_id: Mapped[int] = mapped_column(Integer, index=True, default=0)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)

    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    reporter: Mapped[User] = relationship(lazy="selectin")
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="issue", lazy="selectin", cascade="all, delete-orphan"
    )


class Vote(Base):
    __tablename__ = "votes"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="up")  # up | adopt
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    issue: Mapped[Issue] = relationship(back_populates="comments")
    user: Mapped[User] = relationship(lazy="selectin")


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def make_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MIN),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


async def get_session() -> AsyncSession:
    async with Session() as s:
        yield s


from fastapi import Header  # noqa: E402


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    authorization: Optional[str] = Header(default=None),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = await session.get(User, uid)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


async def require_authority(user: User = Depends(get_current_user)) -> User:
    if user.role != "authority":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Authority role required")
    return user


# --------------------------------------------------------------------------- #
# AI verification pipeline (deterministic stand-in for CLIP + YOLOv8)
# --------------------------------------------------------------------------- #
POTHOLE_WORDS = ("pothole", "crater", "road", "asphalt", "tarmac", "street", "pavement", "crack")
SANITATION_WORDS = ("garbage", "trash", "waste", "overflow", "bin", "dump", "litter", "sewage")
UTILITY_WORDS = ("streetlight", "light", "wire", "pole", "transformer", "power", "cable", "lamp")
DRAINAGE_WORDS = ("drain", "flood", "water", "clog", "overflow", "stagnant", "sewer", "manhole")
PROPERTY_WORDS = ("bench", "sign", "wall", "fence", "playground", "graffiti", "broken", "vandal")

CATEGORY_WORDS = {
    "Roads": POTHOLE_WORDS,
    "Sanitation": SANITATION_WORDS,
    "Utilities": UTILITY_WORDS,
    "Drainage": DRAINAGE_WORDS,
    "Public Property": PROPERTY_WORDS,
}


def _seeded_float(*parts: str) -> float:
    h = hashlib.sha256("::".join(parts).encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def _image_stats(path: str) -> Optional[dict]:
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            w, h = im.size
            small = im.resize((32, 32))
            px = list(small.getdata())
            n = len(px)
            avg = tuple(sum(c[i] for c in px) / n for i in range(3))
            # grey-ish, mid-brightness scenes read as "road surface" more often
            greyness = 1.0 - (max(avg) - min(avg)) / 255.0
            brightness = sum(avg) / 3 / 255.0
            return {"w": w, "h": h, "greyness": greyness, "brightness": brightness}
    except Exception:
        return None


def run_verification(category: str, title: str, description: str, photo_path: Optional[str]) -> dict:
    """Return verification verdict dict for an issue."""
    text = f"{title} {description}".lower()
    words = CATEGORY_WORDS.get(category, ())
    text_hits = sum(1 for w in words if w in text)
    text_score = min(1.0, 0.35 + 0.16 * text_hits) if text_hits else 0.2

    if category in VISION_CATEGORIES and photo_path and os.path.exists(photo_path):
        stats = _image_stats(photo_path)
        if stats is None:
            return {
                "verified": False, "method": "none", "confidence": 0.0,
                "detections": 0, "note": "Photo unreadable; not verified",
            }
        # Stage 1 — scene relevance gate (CLIP stand-in): is this a road/street?
        base = _seeded_float("clip", os.path.basename(photo_path), text)
        scene_score = 0.45 * base + 0.35 * stats["greyness"] + 0.20 * (1 - abs(stats["brightness"] - 0.5) * 2)
        scene_score = round(min(0.99, scene_score + 0.12 * text_hits), 3)
        if scene_score < 0.45:
            return {
                "verified": False, "method": "vision", "confidence": scene_score,
                "detections": 0,
                "note": f"Stage 1 gate failed: photo does not appear to show a road surface ({scene_score:.0%})",
            }
        # Stage 2 — pothole detector (YOLOv8 stand-in): per-detection confidence + count
        det_base = _seeded_float("yolo", os.path.basename(photo_path), title)
        det_conf = round(min(0.98, 0.55 + 0.4 * det_base + 0.05 * text_hits), 3)
        count = 1
        if det_base > 0.62:
            count = 2
        if det_base > 0.85:
            count = 3
        note = f"Stage 1 road-scene {scene_score:.0%} -> Stage 2 detected {count} pothole(s) @ {det_conf:.0%}"
        return {
            "verified": det_conf >= 0.6, "method": "vision",
            "confidence": det_conf, "detections": count, "note": note,
        }

    # Non-vision categories (or Roads with no photo): honest weaker text signal
    verified = text_score >= 0.6
    note = (
        f"Text classifier: {text_hits} '{category}' keyword(s) matched "
        f"(weaker signal than vision verification)"
    )
    return {
        "verified": verified, "method": "text", "confidence": round(text_score, 3),
        "detections": 0, "note": note,
    }


def compute_priority(verdict: dict, upvotes: int, cluster_count: int) -> str:
    if verdict["method"] == "vision" and verdict["detections"] >= 2:
        return "critical"
    score = 0.0
    if verdict["verified"]:
        score += 2.0 if verdict["method"] == "vision" else 1.0
    score += verdict["confidence"] * 1.5
    score += min(upvotes, 20) * 0.15
    score += min(cluster_count, 15) * 0.25
    if score >= 5.0:
        return "critical"
    if score >= 3.2:
        return "high"
    if score >= 1.6:
        return "medium"
    return "low"


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# --------------------------------------------------------------------------- #
# WebSocket hub
# --------------------------------------------------------------------------- #
class Hub:
    def __init__(self):
        self.clients: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


hub = Hub()


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    role: str = "citizen"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class IssueIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    category: str
    lat: float
    lng: float
    address: str = ""
    photo_base64: Optional[str] = None  # data URL or raw base64


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class StatusIn(BaseModel):
    status: str
    after_photo_base64: Optional[str] = None


class RainfallIn(BaseModel):
    rainfall_mm: float = Field(ge=0, le=500)


def user_public(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "points": u.points}


async def issue_public(session: AsyncSession, i: Issue, viewer: Optional[User]) -> dict:
    reporter = await session.get(User, i.reporter_id)
    comment_rows = (await session.execute(
        select(Comment).where(Comment.issue_id == i.id).order_by(Comment.created_at)
    )).scalars().all()
    comment_users = {
        c.user_id: await session.get(User, c.user_id) for c in comment_rows
    }
    cluster_count = 1
    if i.cluster_id:
        cluster_count = await session.scalar(
            select(func.count()).select_from(Issue).where(Issue.cluster_id == i.cluster_id)
        )
    voted = adopted = False
    if viewer:
        rows = (await session.execute(
            select(Vote.kind).where(Vote.issue_id == i.id, Vote.user_id == viewer.id)
        )).scalars().all()
        voted = "up" in rows
        adopted = "adopt" in rows
    return {
        "id": i.id, "title": i.title, "description": i.description, "category": i.category,
        "status": i.status, "priority": i.priority, "lat": i.lat, "lng": i.lng,
        "address": i.address, "photo_url": i.photo_url, "after_photo_url": i.after_photo_url,
        "verified": i.verified, "verification_method": i.verification_method,
        "verification_confidence": i.verification_confidence,
        "detection_count": i.detection_count, "verification_note": i.verification_note,
        "cluster_id": i.cluster_id, "cluster_count": cluster_count,
        "upvotes": i.upvotes, "reporter": reporter.name if reporter else "—",
        "created_at": i.created_at.isoformat(),
        "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
        "comments": [
            {"id": c.id, "body": c.body,
             "user": comment_users[c.user_id].name if comment_users.get(c.user_id) else "—",
             "created_at": c.created_at.isoformat()}
            for c in comment_rows
        ],
        "has_voted": voted, "has_adopted": adopted,
    }


def _decode_photo(b64: Optional[str], prefix: str) -> Optional[str]:
    if not b64:
        return None
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 8MB)")
    ext = "jpg"
    try:
        with Image.open(io.BytesIO(raw)) as im:
            ext = (im.format or "JPEG").lower().replace("jpeg", "jpg")
    except Exception:
        raise HTTPException(400, "Not a valid image")
    fname = f"{prefix}_{int(time.time()*1000)}_{_seeded_float(prefix, str(len(raw)))*1e6:.0f}.{ext}"
    with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
        f.write(raw)
    return f"/uploads/{fname}"


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed()
    yield


app = FastAPI(title="CivicPulse API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/api/health")
async def health():
    return {"ok": True, "time": utcnow().isoformat(), "categories": CATEGORIES}


# ---- Auth ---- #
@app.post("/api/auth/register")
async def register(body: RegisterIn, session: AsyncSession = Depends(get_session)):
    if body.role not in ("citizen", "authority"):
        raise HTTPException(400, "role must be citizen or authority")
    exists = await session.scalar(select(User).where(User.email == body.email.lower()))
    if exists:
        raise HTTPException(409, "Email already registered")
    user = User(
        email=body.email.lower(), name=body.name.strip(),
        password_hash=hash_pw(body.password), role=body.role,
    )
    session.add(user)
    await session.commit()
    return {"token": make_token(user), "user": user_public(user)}


@app.post("/api/auth/login")
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)):
    user = await session.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_pw(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    return {"token": make_token(user), "user": user_public(user)}


@app.get("/api/auth/me")
async def me(user: User = Depends(get_current_user)):
    return user_public(user)


# ---- Issues ---- #
@app.get("/api/issues")
async def list_issues(
    category: Optional[str] = None,
    status_f: Optional[str] = None,
    mine: bool = False,
    session: AsyncSession = Depends(get_session),
    authorization: Optional[str] = Header(default=None),
):
    viewer = None
    if authorization:
        try:
            viewer = await get_current_user(session, authorization)
        except HTTPException:
            viewer = None
    q = select(Issue).options(selectinload(Issue.comments), selectinload(Issue.reporter))
    if category:
        q = q.where(Issue.category == category)
    if status_f:
        q = q.where(Issue.status == status_f)
    if mine and viewer:
        q = q.where(Issue.reporter_id == viewer.id)
    q = q.order_by(Issue.created_at.desc())
    issues = (await session.execute(q)).scalars().all()
    return [await issue_public(session, i, viewer) for i in issues]


@app.get("/api/issues/{issue_id}")
async def get_issue(
    issue_id: int, session: AsyncSession = Depends(get_session),
    authorization: Optional[str] = Header(default=None),
):
    viewer = None
    if authorization:
        try:
            viewer = await get_current_user(session, authorization)
        except HTTPException:
            viewer = None
    i = await session.get(Issue, issue_id)
    if not i:
        raise HTTPException(404, "Issue not found")
    return await issue_public(session, i, viewer)


@app.post("/api/issues")
async def create_issue(
    body: IssueIn, user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if body.category not in CATEGORIES:
        raise HTTPException(400, f"category must be one of {CATEGORIES}")
    photo_url = _decode_photo(body.photo_base64, "issue")
    photo_path = os.path.join(UPLOAD_DIR, os.path.basename(photo_url)) if photo_url else None

    verdict = run_verification(body.category, body.title, body.description, photo_path)

    # proximity + category dedupe
    candidates = (await session.execute(
        select(Issue).where(Issue.category == body.category, Issue.status != "Resolved")
    )).scalars().all()
    cluster_id = 0
    for c in candidates:
        if haversine_m(body.lat, body.lng, c.lat, c.lng) <= DEDUPE_RADIUS_M:
            cluster_id = c.cluster_id or c.id
            break

    issue = Issue(
        title=body.title.strip(), description=body.description.strip(),
        category=body.category, lat=body.lat, lng=body.lng, address=body.address.strip(),
        photo_url=photo_url, reporter_id=user.id,
        verified=verdict["verified"], verification_method=verdict["method"],
        verification_confidence=verdict["confidence"], detection_count=verdict["detections"],
        verification_note=verdict["note"],
        status="Verified" if verdict["verified"] else "Reported",
    )
    session.add(issue)
    await session.flush()
    issue.cluster_id = cluster_id or issue.id

    cluster_count = await session.scalar(
        select(func.count()).select_from(Issue).where(Issue.cluster_id == issue.cluster_id)
    )
    issue.priority = compute_priority(verdict, issue.upvotes, cluster_count)

    user.points += 15
    await session.commit()

    payload = await issue_public(session, issue, user)
    await hub.broadcast({"type": "issue.created", "issue": payload})
    return payload


@app.post("/api/issues/{issue_id}/vote")
async def toggle_vote(
    issue_id: int, kind: str = "up",
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session),
):
    if kind not in ("up", "adopt"):
        raise HTTPException(400, "kind must be 'up' or 'adopt'")
    issue = await session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    existing = await session.scalar(
        select(Vote).where(Vote.issue_id == issue_id, Vote.user_id == user.id, Vote.kind == kind)
    )
    if existing:
        await session.delete(existing)
        active = False
        if kind == "up":
            issue.upvotes = max(0, issue.upvotes - 1)
    else:
        session.add(Vote(issue_id=issue_id, user_id=user.id, kind=kind))
        active = True
        if kind == "up":
            issue.upvotes += 1
            reporter = await session.get(User, issue.reporter_id)
            if reporter and reporter.id != user.id:
                reporter.points += 1

    cluster_count = await session.scalar(
        select(func.count()).select_from(Issue).where(Issue.cluster_id == issue.cluster_id)
    )
    issue.priority = compute_priority(
        {"method": issue.verification_method, "detections": issue.detection_count,
         "verified": issue.verified, "confidence": issue.verification_confidence},
        issue.upvotes, cluster_count,
    )
    await session.commit()
    await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, issue, None)})
    return {"kind": kind, "active": active, "upvotes": issue.upvotes, "priority": issue.priority}


@app.post("/api/issues/{issue_id}/comments")
async def add_comment(
    issue_id: int, body: CommentIn,
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session),
):
    issue = await session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    c = Comment(issue_id=issue_id, user_id=user.id, body=body.body.strip())
    session.add(c)
    user.points += 3
    await session.commit()
    await session.refresh(issue)
    return await issue_public(session, issue, user)


# ---- Community ---- #
@app.get("/api/leaderboard")
async def leaderboard(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(User).order_by(User.points.desc()).limit(20)
    )).scalars().all()
    return [
        {"rank": n + 1, "name": u.name, "points": u.points, "role": u.role}
        for n, u in enumerate(rows)
    ]


@app.get("/api/proof-wall")
async def proof_wall(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Issue).where(Issue.status == "Resolved").order_by(Issue.resolved_at.desc()).limit(30)
    )).scalars().all()
    return [
        {"id": i.id, "title": i.title, "category": i.category, "address": i.address,
         "before": i.photo_url, "after": i.after_photo_url,
         "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None}
        for i in rows
    ]


# ---- Authority ---- #
@app.get("/api/authority/queue")
async def authority_queue(
    _: User = Depends(require_authority), session: AsyncSession = Depends(get_session),
):
    issues = (await session.execute(
        select(Issue).options(selectinload(Issue.comments), selectinload(Issue.reporter))
        .where(Issue.status != "Resolved")
    )).scalars().all()
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    issues.sort(key=lambda i: (order.get(i.priority, 9), -i.upvotes, i.created_at.timestamp()))
    return [await issue_public(session, i, None) for i in issues]


@app.get("/api/authority/kpis")
async def authority_kpis(
    _: User = Depends(require_authority), session: AsyncSession = Depends(get_session),
):
    all_issues = (await session.execute(select(Issue))).scalars().all()
    total = len(all_issues)
    resolved = [i for i in all_issues if i.status == "Resolved"]
    open_issues = [i for i in all_issues if i.status != "Resolved"]
    by_cat: dict[str, int] = {c: 0 for c in CATEGORIES}
    by_priority = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for i in open_issues:
        by_cat[i.category] = by_cat.get(i.category, 0) + 1
        by_priority[i.priority] = by_priority.get(i.priority, 0) + 1
    # real avg resolution time from data
    spans = [
        (i.resolved_at - i.created_at).total_seconds() / 86400
        for i in resolved if i.resolved_at
    ]
    avg_days = round(sum(spans) / len(spans), 2) if spans else None
    verified_open = sum(1 for i in open_issues if i.verified)
    return {
        "total": total, "open": len(open_issues), "resolved": len(resolved),
        "resolution_rate": round(len(resolved) / total, 3) if total else 0.0,
        "avg_resolution_days": avg_days,
        "verified_open_share": round(verified_open / len(open_issues), 3) if open_issues else 0.0,
        "by_category": by_cat, "by_priority": by_priority,
        "clusters": len({i.cluster_id for i in open_issues}),
    }


@app.post("/api/authority/issues/{issue_id}/status")
async def set_status(
    issue_id: int, body: StatusIn,
    _: User = Depends(require_authority), session: AsyncSession = Depends(get_session),
):
    valid = ["Reported", "Verified", "Assigned", "In Progress", "Resolved"]
    if body.status not in valid:
        raise HTTPException(400, f"status must be one of {valid}")
    issue = await session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    issue.status = body.status
    if body.status == "Resolved":
        issue.resolved_at = utcnow()
        after = _decode_photo(body.after_photo_base64, "after")
        if after:
            issue.after_photo_url = after
        reporter = await session.get(User, issue.reporter_id)
        if reporter:
            reporter.points += 10
    else:
        issue.resolved_at = None
    await session.commit()
    await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, issue, None)})
    return await issue_public(session, issue, None)


@app.post("/api/authority/rainfall-twin")
async def rainfall_twin(
    body: RainfallIn, _: User = Depends(require_authority),
    session: AsyncSession = Depends(get_session),
):
    """Deterministic digital-twin: projects drainage-complaint volume vs rainfall.

    Honest note: a simple deterministic formula, not a trained hydrological model.
    """
    baseline = await session.scalar(
        select(func.count()).select_from(Issue).where(Issue.category == "Drainage")
    ) or 0
    r = body.rainfall_mm
    # piecewise: light rain ~ linear, heavy rain ~ super-linear runoff
    projected = baseline + 0.12 * r + 0.0009 * (r ** 2)
    crews = max(1, math.ceil(projected / 6))
    if r < 15:
        level = "low"
    elif r < 45:
        level = "moderate"
    elif r < 90:
        level = "high"
    else:
        level = "severe"
    return {
        "rainfall_mm": r, "baseline_drainage_reports": baseline,
        "projected_reports": round(projected, 1), "recommended_crews": crews,
        "flood_risk_level": level,
        "note": "Deterministic formula (baseline + 0.12·mm + 0.0009·mm²); not a trained model.",
    }


# ---- WebSocket ---- #
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await hub.connect(ws)
    try:
        await ws.send_json({"type": "hello", "clients": len(hub.clients)})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
    except Exception:
        hub.disconnect(ws)


# ---- Frontend (served last so /api wins) ---- #
if os.path.isdir(FRONTEND_DIR):
    from fastapi.responses import FileResponse

    _index = os.path.join(FRONTEND_DIR, "index.html")
    _MIME = {
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
        ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json",
        ".html": "text/html",
    }

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = os.path.join(FRONTEND_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            ext = os.path.splitext(candidate)[1].lower()
            return FileResponse(candidate, media_type=_MIME.get(ext))
        return FileResponse(_index, media_type="text/html")


# --------------------------------------------------------------------------- #
# Seed data
# --------------------------------------------------------------------------- #
SEED_ISSUES = [
    ("Deep pothole cluster on Anna Salai", "Multiple potholes near the bus stop, two-wheelers swerving into traffic.",
     "Roads", 13.0604, 80.2496, "Anna Salai, near Thousand Lights", "critical", True, "vision", 0.91, 3),
    ("Pothole on 100 Feet Road", "Large pothole fills with water after rain.",
     "Roads", 13.0501, 80.2121, "100 Feet Rd, Vadapalani", "high", True, "vision", 0.78, 1),
    ("Overflowing garbage bin at market", "Bin not cleared for 4 days, stray dogs scattering waste.",
     "Sanitation", 13.0827, 80.2707, "Mylapore Market", "high", True, "text", 0.72, 2),
    ("Broken streetlight on service lane", "Entire stretch dark at night, unsafe for pedestrians.",
     "Utilities", 13.0410, 80.2337, "T. Nagar service lane", "medium", True, "text", 0.66, 1),
    ("Storm drain clogged near school", "Water stagnates across the road, mosquito breeding.",
     "Drainage", 13.0731, 80.2609, "Near Santhome School", "high", True, "text", 0.69, 1),
    ("Damaged park bench and railing", "Sharp broken metal edge, children play here.",
     "Public Property", 13.0569, 80.2425, "Panagal Park", "medium", False, "text", 0.44, 1),
    ("Faded zebra crossing", "Crossing near junction almost invisible to drivers.",
     "Roads", 13.0640, 80.2500, "Gemini Flyover junction", "low", False, "text", 0.30, 1),
]

SEED_RESOLVED = [
    ("Graffiti on subway wall removed", "Public Property", 13.0600, 80.2450, "Spencer Plaza subway"),
    ("Water leak on Habibullah Road fixed", "Utilities", 13.0450, 80.2350, "Habibullah Rd"),
]


async def seed():
    async with Session() as s:
        if await s.scalar(select(func.count()).select_from(User)):
            return
        authority = User(email="authority@chennai.gov.in", name="GCC Control Room",
                         password_hash=hash_pw("authority123"), role="authority", points=0)
        alex = User(email="alex@example.com", name="Alex Kumar",
                    password_hash=hash_pw("citizen123"), role="citizen", points=0)
        priya = User(email="priya@example.com", name="Priya R",
                     password_hash=hash_pw("citizen123"), role="citizen", points=0)
        ravi = User(email="ravi@example.com", name="Ravi S",
                    password_hash=hash_pw("citizen123"), role="citizen", points=0)
        s.add_all([authority, alex, priya, ravi])
        await s.flush()
        reporters = [alex, priya, ravi]

        for n, (title, desc, cat, lat, lng, addr, prio, ver, method, conf, det) in enumerate(SEED_ISSUES):
            rep = reporters[n % 3]
            i = Issue(
                title=title, description=desc, category=cat, lat=lat, lng=lng, address=addr,
                priority=prio, verified=ver, verification_method=method,
                verification_confidence=conf, detection_count=det,
                verification_note=("Stage 1 road-scene 88% -> Stage 2 detected "
                                   f"{det} pothole(s) @ {conf:.0%}") if method == "vision"
                                  else f"Text classifier signal {conf:.0%} (weaker than vision)",
                status="Verified" if ver else "Reported",
                reporter_id=rep.id, upvotes=(n * 3) % 11,
                created_at=utcnow() - timedelta(hours=6 * n + 2),
            )
            s.add(i)
            await s.flush()
            i.cluster_id = i.id
            rep.points += 15 + i.upvotes

        for title, cat, lat, lng, addr in SEED_RESOLVED:
            i = Issue(
                title=title, description="Resolved by municipal crew.", category=cat,
                lat=lat, lng=lng, address=addr, priority="medium", verified=True,
                verification_method="text", verification_confidence=0.6,
                status="Resolved", reporter_id=priya.id, upvotes=5,
                created_at=utcnow() - timedelta(days=4),
                resolved_at=utcnow() - timedelta(days=1),
            )
            s.add(i)
            await s.flush()
            i.cluster_id = i.id
            priya.points += 25
        await s.commit()
