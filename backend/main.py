"""
CiviTrace AI API — AI-driven civic intelligence backend.

FastAPI + async SQLAlchemy (SQLite, swap DB_URL for Postgres).
Real models: CLIP scene gate, YOLOv8 pothole detector, MiniLM text/embeddings,
sklearn priority. Grounded assistant "Aarambh". Security: rotating refresh
tokens, rate limits, lockout, TOTP 2FA, security headers, EXIF/face scrubbing.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import auth as A
import payments as pay
from ai import (registry, verify as ai_verify, dedup as ai_dedup, priority as ai_priority,
                trust as ai_trust, authenticity as ai_auth, weather as ai_weather,
                evidence as ai_evidence, resolution as ai_resolution, wards as ai_wards)
from ai.assistant import assistant, ASSISTANT_NAME, ASSISTANT_TAGLINE
from ai.text_classifier import embed as text_embed
from config import settings
from models import (AuditLog, Base, Comment, EvidenceCheck, HumanReview, Issue, OtpCode,
                    PaymentOrder, PaymentTransaction, RefreshToken, ResolutionVerification,
                    User, Vote, utcnow)
from security import (SecurityHeadersMiddleware, global_limiter, report_limiter, sanitize_image)

engine = create_async_engine(settings.db_url, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# --------------------------------------------------------------------------- #
async def get_session() -> AsyncSession:
    async with Session() as s:
        yield s


def jsonable(x):
    """Recursively coerce numpy / non-primitive values to JSON-safe Python types."""
    if isinstance(x, dict):
        return {str(k): jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, (str, bool)) or x is None:
        return x
    if isinstance(x, int):
        return x
    try:
        import numpy as _np
        if isinstance(x, _np.generic):
            return x.item()
        if isinstance(x, _np.ndarray):
            return [jsonable(v) for v in x.tolist()]
    except Exception:
        pass
    if isinstance(x, float):
        return round(x, 6)
    try:
        float(x)
        return float(x)
    except (TypeError, ValueError):
        return str(x)


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite returns naive datetimes; coerce to UTC-aware for safe comparison."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def client_ip(req: Request) -> str:
    return (req.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (req.client.host if req.client else "?"))


async def audit(s: AsyncSession, *, actor: Optional[User], action: str, target: str = "",
                ip: str = "", summary: str = "", reason: str = "",
                actor_role: str = "", overruled_by: Optional[int] = None, **meta):
    s.add(AuditLog(actor_id=actor.id if actor else None,
                   actor_role=actor_role or (actor.role if actor else "system"),
                   action=action, target=target, ip=ip,
                   summary=summary, reason=reason, overruled_by=overruled_by, meta=meta))


async def ai_audit(s: AsyncSession, *, target: str, action: str, summary: str, reason: str = "", **meta):
    """Record an AI decision in the governance trail (WHAT / WHY / WHEN)."""
    s.add(AuditLog(actor_id=None, actor_role="ai", action=action, target=target,
                   summary=summary, reason=reason, meta=meta))


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    authorization: Optional[str] = Header(default=None),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    try:
        payload = A.decode(authorization.split(" ", 1)[1])
        if payload.get("typ") != "access":
            raise HTTPException(401, "Wrong token type")
        uid = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(401, "Invalid or expired token")
    user = await session.get(User, uid)
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def maybe_user(session: AsyncSession, authorization: Optional[str]) -> Optional[User]:
    if not authorization:
        return None
    try:
        return await get_current_user(session, authorization)
    except HTTPException:
        return None


async def require_authority(user: User = Depends(get_current_user)) -> User:
    if user.role != "authority":
        raise HTTPException(403, "Authority role required")
    if settings.require_authority_2fa and not user.totp_enabled:
        raise HTTPException(403, "2FA enrolment required for authority accounts")
    return user


async def rate_limit(request: Request):
    if not global_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many requests — slow down")


# --------------------------------------------------------------------------- helpers
async def reporter_trust(session: AsyncSession, uid: int) -> float:
    u = await session.get(User, uid)
    return ai_trust.trust_score(u.reports_valid, u.reports_invalid) if u else 0.5


def _decode_and_store_sync(b64: Optional[str], prefix: str) -> tuple[Optional[str], dict]:
    if not b64:
        return None, {}
    if b64.strip().startswith("data:") and "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(400, "Bad image encoding")
    clean, meta = sanitize_image(raw)
    fname = f"{prefix}_{int(time.time()*1000)}_{os.urandom(3).hex()}.jpg"
    with open(os.path.join(settings.upload_dir, fname), "wb") as f:
        f.write(clean)
    return f"/uploads/{fname}", meta


async def _decode_and_store(b64: Optional[str], prefix: str) -> tuple[Optional[str], dict]:
    try:
        return await asyncio.to_thread(_decode_and_store_sync, b64, prefix)
    except ValueError as e:
        raise HTTPException(413, str(e))


async def cluster_count(session: AsyncSession, cid: int) -> int:
    return await session.scalar(
        select(func.count()).select_from(Issue).where(Issue.cluster_id == cid)
    ) or 1


async def issue_public(session: AsyncSession, i: Issue, viewer: Optional[User]) -> dict:
    reporter = await session.get(User, i.reporter_id)
    comments = (await session.execute(
        select(Comment).where(Comment.issue_id == i.id).order_by(Comment.created_at)
    )).scalars().all()
    cusers = {c.user_id: await session.get(User, c.user_id) for c in comments}
    cc = await cluster_count(session, i.cluster_id)
    voted = adopted = False
    if viewer:
        kinds = (await session.execute(
            select(Vote.kind).where(Vote.issue_id == i.id, Vote.user_id == viewer.id)
        )).scalars().all()
        voted, adopted = "up" in kinds, "adopt" in kinds
    rtrust = ai_trust.trust_score(reporter.reports_valid, reporter.reports_invalid) if reporter else 0.5

    # ---- privacy: coarsen the location for the public unless the reporter opted in ----
    is_owner = bool(viewer and viewer.id == i.reporter_id)
    is_staff = bool(viewer and viewer.role == "authority")
    lat, lng, addr, loc_exact = i.lat, i.lng, i.address, True
    if not (is_owner or is_staff) and not i.precise_location_public:
        # snap to ~150 m grid + drop the house-level part of the address
        lat = round(i.lat, 3)
        lng = round(i.lng, 3)
        parts = [p.strip() for p in (i.address or "").split(",") if p.strip()]
        addr = ", ".join(parts[1:]) if len(parts) > 2 else (i.address or "")
        loc_exact = False

    return {
        "id": i.id, "title": i.title, "description": i.description, "category": i.category,
        "status": i.status, "priority": i.priority, "priority_score": i.priority_score,
        "lat": lat, "lng": lng, "address": addr, "ward_weight": i.ward_weight,
        "location_exact": loc_exact, "is_public": i.is_public, "ward": i.ward,
        "precise_location_public": i.precise_location_public,
        "evidence_trust": i.evidence_trust, "evidence_verdict": i.evidence_verdict,
        "consistency": i.consistency,
        "resolution_confidence": i.resolution_confidence,
        "awaiting_confirmation": i.awaiting_confirmation,
        "citizen_confirmation": i.citizen_confirmation,
        "reopen_count": i.reopen_count, "in_human_review": i.in_human_review,
        "photo_url": i.photo_url, "after_photo_url": i.after_photo_url,
        "verified": i.verified, "verification_method": i.verification_method,
        "verification_confidence": i.verification_confidence,
        "detection_count": i.detection_count, "severity": i.severity,
        "verification_note": i.verification_note, "evidence": i.evidence or [],
        "priority_explanation": i.priority_explanation or {},
        "model_version": i.model_version,
        "cluster_id": i.cluster_id, "cluster_count": cc, "dedupe_distance": i.dedupe_distance,
        "dedupe_matched_id": i.dedupe_matched_id,
        "photo_hash": i.photo_hash,
        "authenticity_score": i.authenticity_score, "authenticity": i.authenticity or {},
        "recurrence": i.recurrence, "recurrence_of": i.recurrence_of,
        "recurrence_count": i.recurrence_count,
        "resolution_verified": i.resolution_verified, "resolution_note": i.resolution_note,
        "eta_days": i.eta_days,
        "upvotes": i.upvotes, "reporter": reporter.name if reporter else "—",
        "reporter_id": i.reporter_id,
        "reporter_trust": rtrust, "reporter_trust_band": ai_trust.trust_band(rtrust),
        "created_at": i.created_at.isoformat(),
        "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
        "comments": [{"id": c.id, "body": c.body,
                      "user": cusers[c.user_id].name if cusers.get(c.user_id) else "—",
                      "created_at": c.created_at.isoformat()} for c in comments],
        "has_voted": voted, "has_adopted": adopted,
    }


def user_public(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "points": u.points,
            "trust": ai_trust.trust_score(u.reports_valid, u.reports_invalid),
            "totp_enabled": u.totp_enabled}


# --------------------------------------------------------------------------- schemas
class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    role: str = "citizen"


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    totp: Optional[str] = None


class RefreshIn(BaseModel):
    refresh_token: str


class IssueIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    category: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str = Field(default="", max_length=255)
    photo_base64: Optional[str] = None


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class StatusIn(BaseModel):
    status: str
    after_photo_base64: Optional[str] = None
    reporter_feedback: Optional[str] = None  # "valid" | "invalid"
    note: str = ""


class ConfirmIn(BaseModel):
    result: str = Field(pattern="^(fixed|still_exists|partial)$")
    note: str = Field(default="", max_length=1000)


class ReviewDecisionIn(BaseModel):
    decision: str = Field(pattern="^(approve|reject|request_evidence|reopen|escalate)$")
    note: str = Field(default="", max_length=1000)


class PrivacyIn(BaseModel):
    is_public: Optional[bool] = None
    precise_location_public: Optional[bool] = None


class PaymentOrderIn(BaseModel):
    service_code: str


class PaymentVerifyIn(BaseModel):
    order_id: int
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    method: str = ""


class RainfallIn(BaseModel):
    rainfall_mm: float = Field(ge=0, le=500)


class AssistantIn(BaseModel):
    text: str = Field(max_length=1000)
    session_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


# --------------------------------------------------------------------------- WS hub
class Hub:
    def __init__(self):
        self.clients: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept(); self.clients.append(ws)

    def drop(self, ws: WebSocket):
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, msg: dict):
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                self.drop(ws)


hub = Hub()

# Single-consumer AI job queue — at most one heavy inference at a time, so a
# burst of reports can never stall the API.
ai_queue: "asyncio.Queue[tuple[int, Optional[str]]]" = asyncio.Queue()


async def _ai_worker():
    while True:
        issue_id, photo_path = await ai_queue.get()
        try:
            await _process_in_background(issue_id, photo_path)
        except Exception as e:  # pragma: no cover
            print(f"[ai worker] {issue_id}: {e}", flush=True)
        finally:
            ai_queue.task_done()


# --------------------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    from seed import seed
    await seed(Session)
    registry.warmup()
    worker = asyncio.create_task(_ai_worker())
    yield
    worker.cancel()


app = FastAPI(title="CiviTrace AI API", version="2.0.0", lifespan=lifespan)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"] if settings.env == "prod" else ["*"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/api/health")
async def health():
    return {"ok": True, "time": utcnow().isoformat(), "categories": list(settings.categories),
            "env": settings.env}


@app.get("/api/config")
async def public_config():
    return {
        "assistant_name": ASSISTANT_NAME,
        "assistant_tagline": ASSISTANT_TAGLINE,
        "map_provider": "google" if os.environ.get("CIVIC_GMAPS_KEY") else "maplibre",
        "gmaps_key_present": bool(os.environ.get("CIVIC_GMAPS_KEY")),
        "categories": list(settings.categories),
        "vision_categories": list(settings.vision_categories),
        "payments_mode": pay.mode(),
        "features": {
            "evidence_trust": True, "multimodal_consistency": True,
            "human_review": True, "resolution_verification": True,
            "citizen_confirmation": True, "fair_priority": True,
            "ward_fairness": True, "ai_audit_trail": True, "payments": True,
        },
        "prototype_notice": "AI components are heuristic prototypes — scores are illustrative "
                            "and Not Yet Measured. Payments run in Razorpay TEST/sandbox or simulated mode.",
    }


@app.get("/api/ai/status")
async def ai_status():
    return registry.status()


# ---- auth ----
@app.post("/api/auth/register")
async def register(body: RegisterIn, request: Request, session: AsyncSession = Depends(get_session)):
    await rate_limit(request)
    if body.role not in ("citizen", "authority"):
        raise HTTPException(400, "invalid role")
    if await session.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "Email already registered")
    u = User(email=body.email.lower(), name=body.name.strip(),
             password_hash=A.hash_pw(body.password), role=body.role)
    session.add(u)
    await session.flush()
    jti = A.new_jti()
    session.add(RefreshToken(jti=jti, user_id=u.id))
    await audit(session, actor=u, action="auth.register", ip=client_ip(request))
    await session.commit()
    return {"access_token": A.make_access(u.id, u.role), "refresh_token": A.make_refresh(u.id, jti),
            "user": user_public(u)}


@app.post("/api/auth/login")
async def login(body: LoginIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    if not global_limiter.allow(f"login:{ip}", cost=1):
        raise HTTPException(429, "Too many attempts")
    u = await session.scalar(select(User).where(User.email == body.email.lower()))
    now = datetime.now(timezone.utc)
    if u and aware(u.locked_until) and aware(u.locked_until) > now:
        raise HTTPException(423, f"Account locked until {u.locked_until.isoformat()}")
    if not u or not A.verify_pw(body.password, u.password_hash):
        if u:
            u.failed_logins += 1
            if u.failed_logins >= settings.login_max_attempts:
                u.locked_until = now + timedelta(minutes=settings.login_lockout_min)
                u.failed_logins = 0
            await audit(session, actor=u, action="auth.login_fail", ip=ip)
            await session.commit()
        raise HTTPException(401, "Invalid credentials")
    if u.totp_enabled and not A.totp_verify(u.totp_secret or "", body.totp or ""):
        raise HTTPException(401, "2FA code required or incorrect")
    u.failed_logins = 0
    u.locked_until = None
    jti = A.new_jti()
    session.add(RefreshToken(jti=jti, user_id=u.id))
    await audit(session, actor=u, action="auth.login", ip=ip)
    await session.commit()
    return {"access_token": A.make_access(u.id, u.role), "refresh_token": A.make_refresh(u.id, jti),
            "user": user_public(u)}


@app.post("/api/auth/refresh")
async def refresh(body: RefreshIn, session: AsyncSession = Depends(get_session)):
    try:
        p = A.decode(body.refresh_token)
        assert p.get("typ") == "refresh"
        uid, jti = int(p["sub"]), p["jti"]
    except Exception:
        raise HTTPException(401, "Invalid refresh token")
    tok = await session.get(RefreshToken, jti)
    if not tok or tok.revoked or tok.user_id != uid:
        raise HTTPException(401, "Refresh token revoked")
    tok.revoked = True  # rotation
    new = A.new_jti()
    session.add(RefreshToken(jti=new, user_id=uid))
    u = await session.get(User, uid)
    await session.commit()
    return {"access_token": A.make_access(uid, u.role), "refresh_token": A.make_refresh(uid, new)}


@app.post("/api/auth/logout")
async def logout(body: RefreshIn, session: AsyncSession = Depends(get_session)):
    try:
        p = A.decode(body.refresh_token)
        tok = await session.get(RefreshToken, p.get("jti"))
        if tok:
            tok.revoked = True
            await session.commit()
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: User = Depends(get_current_user)):
    return user_public(user)


# ---- email OTP (real-time one-time code) ----
class OtpRequestIn(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    role: str = "citizen"


class OtpVerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)


def _send_otp_email(email: str, code: str) -> None:
    """Prod: plug an email/SMS provider here. Dev: logged + returned in response."""
    host = os.environ.get("CIVIC_SMTP_HOST")
    if not host:
        print(f"[OTP] {email} -> {code}", flush=True)
        return
    import smtplib
    from email.mime.text import MIMEText
    msg = MIMEText(f"Your CiviTrace AI verification code is {code}. It expires in 5 minutes.")
    msg["Subject"] = "CiviTrace AI verification code"
    msg["From"] = os.environ.get("CIVIC_SMTP_FROM", "no-reply@civicpulse.app")
    msg["To"] = email
    with smtplib.SMTP(host, int(os.environ.get("CIVIC_SMTP_PORT", "587"))) as sv:
        sv.starttls()
        if os.environ.get("CIVIC_SMTP_USER"):
            sv.login(os.environ["CIVIC_SMTP_USER"], os.environ["CIVIC_SMTP_PASS"])
        sv.send_message(msg)


@app.post("/api/auth/otp/request")
async def otp_request(body: OtpRequestIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    if not global_limiter.allow(f"otp:{ip}", cost=3):
        raise HTTPException(429, "Too many code requests")
    email = body.email.lower()
    import secrets as _s
    code = f"{_s.randbelow(10**6):06d}"
    session.add(OtpCode(email=email, code_hash=A.hash_pw(code), purpose="login",
                        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5)))
    exists = await session.scalar(select(User).where(User.email == email))
    if not exists and body.name:
        session.add(User(email=email, name=body.name.strip(),
                         password_hash=A.hash_pw(_s.token_urlsafe(24)),
                         role=body.role if body.role in ("citizen", "authority") else "citizen"))
    await audit(session, actor=None, action="auth.otp_request", target=email, ip=ip)
    await session.commit()
    _send_otp_email(email, code)
    resp = {"sent": True, "channel": "email", "expires_in": 300,
            "new_user": exists is None}
    if settings.env != "prod":
        resp["dev_code"] = code  # shown only in dev for testing
    return resp


@app.post("/api/auth/otp/verify")
async def otp_verify(body: OtpVerifyIn, request: Request, session: AsyncSession = Depends(get_session)):
    email = body.email.lower()
    row = await session.scalar(
        select(OtpCode).where(OtpCode.email == email, OtpCode.consumed == False)  # noqa: E712
        .order_by(OtpCode.created_at.desc()))
    now = datetime.now(timezone.utc)
    if not row or aware(row.expires_at) < now:
        raise HTTPException(400, "Code expired — request a new one")
    if row.attempts >= 5:
        raise HTTPException(429, "Too many attempts — request a new code")
    row.attempts += 1
    if not A.verify_pw(body.code.strip(), row.code_hash):
        await session.commit()
        raise HTTPException(401, "Incorrect code")
    row.consumed = True
    user = await session.scalar(select(User).where(User.email == email))
    if not user:
        user = User(email=email, name=email.split("@")[0].title(),
                    password_hash=A.hash_pw(os.urandom(16).hex()), role="citizen")
        session.add(user)
        await session.flush()
    jti = A.new_jti()
    session.add(RefreshToken(jti=jti, user_id=user.id))
    await audit(session, actor=user, action="auth.otp_login", ip=client_ip(request))
    await session.commit()
    return {"access_token": A.make_access(user.id, user.role),
            "refresh_token": A.make_refresh(user.id, jti), "user": user_public(user)}


@app.post("/api/auth/2fa/setup")
async def twofa_setup(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    secret = A.new_totp_secret()
    user.totp_secret = secret
    user.totp_enabled = False
    await session.commit()
    return {"secret": secret, "otpauth_uri": A.totp_uri(secret, user.email)}


@app.post("/api/auth/2fa/verify")
async def twofa_verify(payload: dict, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    if not user.totp_secret or not A.totp_verify(user.totp_secret, payload.get("code", "")):
        raise HTTPException(400, "Incorrect code")
    user.totp_enabled = True
    await audit(session, actor=user, action="auth.2fa_enabled")
    await session.commit()
    return {"enabled": True}


# ---- issues ----
def can_view(i: Issue, viewer: Optional[User]) -> bool:
    """Private reports are visible only to their reporter and to authority staff."""
    if i.is_public:
        return True
    return bool(viewer and (viewer.id == i.reporter_id or viewer.role == "authority"))


@app.get("/api/issues")
async def list_issues(category: Optional[str] = None, status_f: Optional[str] = None,
                      mine: bool = False, session: AsyncSession = Depends(get_session),
                      authorization: Optional[str] = Header(default=None)):
    viewer = await maybe_user(session, authorization)
    q = select(Issue)
    if category:
        q = q.where(Issue.category == category)
    if status_f:
        q = q.where(Issue.status == status_f)
    if mine and viewer:
        q = q.where(Issue.reporter_id == viewer.id)
    q = q.order_by(Issue.created_at.desc())
    issues = (await session.execute(q)).scalars().all()
    return [await issue_public(session, i, viewer) for i in issues if can_view(i, viewer)]


@app.get("/api/issues/around")
async def issues_around(lat: float, lng: float, radius: float = 350.0,
                        category: Optional[str] = None, text: str = "",
                        session: AsyncSession = Depends(get_session),
                        authorization: Optional[str] = Header(default=None)):
    """Everything near a point — used to (a) show 'issues near <place>' when a
    citizen searches a location and (b) warn 'this may already be reported /
    was recently fixed here' before they submit a duplicate."""
    viewer = await maybe_user(session, authorization)
    radius = max(50.0, min(radius, 3000.0))
    rows = (await session.execute(select(Issue))).scalars().all()

    qvec = None
    if text.strip():
        v = await asyncio.to_thread(text_embed, text.strip())
        qvec = [float(x) for x in v] if v is not None else None

    def sim(o: Issue) -> float:
        if qvec is None or not o.embedding:
            return 0.0
        import math
        ov = [float(x) for x in o.embedding]
        dot = sum(a * b for a, b in zip(qvec, ov))
        na = math.sqrt(sum(a * a for a in qvec)) or 1.0
        nb = math.sqrt(sum(b * b for b in ov)) or 1.0
        return float(max(0.0, dot / (na * nb)))

    open_hits, resolved_hits = [], []
    for o in rows:
        if not can_view(o, viewer):
            continue
        d = ai_dedup.haversine_m(lat, lng, o.lat, o.lng)
        if d > radius:
            continue
        pub = await issue_public(session, o, viewer)
        pub["distance_m"] = int(d)
        pub["similarity"] = round(float(sim(o)), 3)
        same_cat = (category is None or o.category == category)
        text_ok = (qvec is None or not o.embedding or pub["similarity"] >= 0.5)
        pub["likely_duplicate"] = bool(same_cat and o.status != "Resolved" and d <= 90 and text_ok)
        (resolved_hits if o.status == "Resolved" else open_hits).append(pub)

    open_hits.sort(key=lambda x: (not x["likely_duplicate"], x["distance_m"]))
    resolved_hits.sort(key=lambda x: x["distance_m"])
    recurrence = [r for r in resolved_hits
                  if (category is None or r["category"] == category) and r["distance_m"] <= radius]
    return {
        "center": {"lat": lat, "lng": lng}, "radius_m": radius,
        "count": len(open_hits) + len(resolved_hits),
        "open": open_hits[:8], "resolved": resolved_hits[:5],
        "duplicate_candidates": [x for x in open_hits if x["likely_duplicate"]][:3],
        "recurrence_candidates": recurrence[:3],
    }


@app.get("/api/issues/{issue_id}")
async def get_issue(issue_id: int, session: AsyncSession = Depends(get_session),
                    authorization: Optional[str] = Header(default=None)):
    viewer = await maybe_user(session, authorization)
    i = await session.get(Issue, issue_id)
    if not i or not can_view(i, viewer):
        raise HTTPException(404, "Issue not found")
    return await issue_public(session, i, viewer)


async def _recompute_priority(session: AsyncSession, issue: Issue) -> None:
    cc = await cluster_count(session, issue.cluster_id)
    rtrust = await reporter_trust(session, issue.reporter_id)
    age_days = (utcnow() - aware(issue.created_at)).total_seconds() / 86400 if issue.created_at else 0.0
    sla = {"critical": 1, "high": 3, "medium": 7, "low": 14}.get(issue.priority, 7)
    weather_f = 0.0
    if issue.category == "Flooding":
        try:
            weather_f = ai_weather.context_for(issue.lat, issue.lng).rain_factor
        except Exception:
            weather_f = 0.0
    text = f"{issue.title} {issue.description} {issue.address}"
    pr = ai_priority.compute(
        vision_conf=issue.verification_confidence if issue.verification_method == "vision" else 0.0,
        detections=issue.detection_count, severity=issue.severity,
        text_conf=issue.verification_confidence if issue.verification_method == "text" else 0.0,
        cluster_size=cc, upvotes=issue.upvotes, reporter_trust=rtrust,
        ward_weight=issue.ward_weight, category=issue.category, text=text,
        issue_age_days=age_days,
        sla_overdue=(issue.status not in ("Resolved", "Rejected") and age_days > sla),
        citizen_confirmed=(issue.citizen_confirmation == "fixed"),
        evidence_trust=(issue.evidence_trust or 50) / 100,
        weather_factor=weather_f,
        affected_estimate=max(0, (cc - 1) * 8 + issue.upvotes),
    )
    issue.priority, issue.priority_score, issue.priority_explanation = pr.level, pr.score, pr.dict()


# static fallback SLA (days) by priority — refined with real history when available
_ETA_BASE = {"critical": 1.5, "high": 3.0, "medium": 7.0, "low": 14.0}


async def _eta_days(session: AsyncSession, category: str, priority: str) -> float:
    rows = (await session.execute(select(Issue).where(
        Issue.category == category, Issue.status == "Resolved",
        Issue.resolved_at.is_not(None)))).scalars().all()
    spans = [(aware(i.resolved_at) - aware(i.created_at)).total_seconds() / 86400
             for i in rows if i.resolved_at]
    base = _ETA_BASE.get(priority, 7.0)
    if len(spans) >= 3:
        hist = sorted(spans)[len(spans) // 2]  # median
        return round(0.5 * base + 0.5 * hist, 1)
    return base


async def _detect_recurrence(session: AsyncSession, issue: Issue) -> None:
    """Flag a report whose location + category matches a previously *resolved*
    issue — a chronic spot the city keeps having to fix."""
    radius = settings.dedupe_radius_m * 1.6
    resolved = (await session.execute(select(Issue).where(
        Issue.category == issue.category, Issue.status == "Resolved",
        Issue.id != issue.id))).scalars().all()
    hits = [r for r in resolved
            if ai_dedup.haversine_m(issue.lat, issue.lng, r.lat, r.lng) <= radius]
    if not hits:
        return
    hits.sort(key=lambda r: aware(r.resolved_at) or aware(r.created_at), reverse=True)
    prior = hits[0]
    issue.recurrence = True
    issue.recurrence_of = prior.id
    issue.recurrence_count = len(hits) + 1
    days = (utcnow() - (aware(prior.resolved_at) or utcnow())).days
    issue.verification_note = (
        (issue.verification_note + " ") if issue.verification_note else "") + (
        f"⚠ Recurrence — this location was fixed {days}d ago (#{prior.id}); "
        f"{issue.recurrence_count} times on record. Chronic spot — escalated.")


async def _assess_authenticity(session: AsyncSession, issue: Issue,
                               photo_path: Optional[str], verdict) -> None:
    novel = True
    if photo_path:
        h = await asyncio.to_thread(ai_auth.dhash, photo_path)
        issue.photo_hash = h
        if h:
            others = (await session.execute(select(Issue.id, Issue.photo_hash).where(
                Issue.id != issue.id, Issue.photo_hash.is_not(None)))).all()
            for oid, oh in others:
                if ai_auth.hamming(h, oh) <= 6:   # near-identical image already filed
                    novel = False
                    break
    scene_pass = None
    for ev in (verdict.evidence or []):
        if ev.get("stage") == "scene_gate":
            scene_pass = bool(ev.get("is_scene"))
    cc = await cluster_count(session, issue.cluster_id)
    rtrust = await reporter_trust(session, issue.reporter_id)
    a = ai_auth.assess(
        has_photo=bool(photo_path), scene_pass=scene_pass, detections=verdict.detections,
        reporter_trust=rtrust,
        text_agrees=(verdict.category_suggestion == issue.category),
        corroboration=max(0, cc - 1), novel_image=novel,
    )
    issue.authenticity_score = a.score
    issue.authenticity = a.dict()
    return novel, scene_pass


async def _assess_evidence(session: AsyncSession, issue: Issue, photo_path,
                           verdict, novel, scene_pass) -> "ai_evidence.EvidenceResult":
    cc = await cluster_count(session, issue.cluster_id)
    scene_score = 0.0
    for ev in (verdict.evidence or []):
        if ev.get("stage") in ("scene_gate", "rain_correlation"):
            scene_score = max(scene_score, float(ev.get("score", ev.get("rain_factor", 0)) or 0))
    sensor = None
    if issue.category == "Flooding":
        try:
            rc = ai_weather.context_for(issue.lat, issue.lng)
            sensor = {"type": "rainfall", "value": rc.rain_last_24h_mm, "unit": " mm/24h",
                      "supports": rc.rain_factor >= 0.4}
        except Exception:
            sensor = None
    # crude address<->coords plausibility: within Greater Chennai bounding box
    in_city = (12.7 <= issue.lat <= 13.4) and (79.9 <= issue.lng <= 80.4)
    ev = ai_evidence.assess(
        has_photo=bool(photo_path), scene_pass=scene_pass, scene_score=scene_score,
        detections=verdict.detections,
        text_agrees=(verdict.category_suggestion == issue.category),
        novel_image=(None if not photo_path else novel),
        gps_provided=True, gps_plausible=in_city,
        address_matches=(None if not issue.address else True),
        nearby_support=max(0, cc - 1),
        reporter_trust=await reporter_trust(session, issue.reporter_id),
        sensor=sensor,
    )
    issue.evidence_trust = ev.trust_score
    issue.evidence_verdict = ev.verdict
    issue.consistency = ev.consistency
    session.add(EvidenceCheck(
        issue_id=issue.id, trust_score=ev.trust_score, verdict=ev.verdict,
        consistency=ev.consistency, recommended_action=ev.recommended_action,
        checklist=ev.checklist, conflicts=ev.conflicts, model_version=ev.model_version,
    ))
    return ev


async def _open_review(session: AsyncSession, issue: Issue, *, kind: str, reason: str,
                       ai_confidence: float, conflicts: list, recommended: str):
    exists = await session.scalar(select(HumanReview).where(
        HumanReview.issue_id == issue.id, HumanReview.kind == kind, HumanReview.status == "open"))
    if exists:
        return exists
    hr = HumanReview(issue_id=issue.id, kind=kind, reason=reason,
                     ai_confidence=ai_confidence, evidence_trust=issue.evidence_trust,
                     conflicts=conflicts or [], recommended_action=recommended, status="open")
    session.add(hr)
    issue.in_human_review = True
    await ai_audit(session, target=f"issue:{issue.id}", action="ai.route_human_review",
                   summary=f"Routed to Human Review Queue ({kind})", reason=reason,
                   conflicts=conflicts or [])
    return hr


async def _process_in_background(issue_id: int, photo_path: Optional[str]) -> None:
    """All AI (embed -> dedup -> recurrence -> verify -> authenticity -> priority)
    runs off the request path; each result streams back over WebSocket as it lands."""
    try:
        async with Session() as s:
            issue = await s.get(Issue, issue_id)
            if not issue:
                return
            # 1) embedding + spatio-semantic dedup + recurrence
            emb = await asyncio.to_thread(text_embed, f"{issue.title}. {issue.description}")
            if emb is not None:
                issue.embedding = [round(float(x), 5) for x in emb]
            open_issues = (await s.execute(select(Issue).where(
                Issue.status != "Resolved", Issue.id != issue.id))).scalars().all()
            cand = ai_dedup.Candidate(issue.id, 0, issue.lat, issue.lng, issue.category,
                                      issue.created_at.timestamp(), emb)
            existing = [ai_dedup.Candidate(o.id, o.cluster_id, o.lat, o.lng, o.category,
                                           o.created_at.timestamp(), o.embedding) for o in open_issues]
            cid, dist, matched = ai_dedup.assign_cluster(cand, existing)
            issue.cluster_id = cid or issue.id
            issue.dedupe_distance = dist
            issue.dedupe_matched_id = matched if cid and cid != issue.id else None
            await _detect_recurrence(s, issue)
            await _recompute_priority(s, issue)
            await s.commit()
            await hub.broadcast({"type": "issue.updated", "issue": await issue_public(s, issue, None)})

            # 2) heavy vision / text verification
            verdict = await asyncio.to_thread(
                ai_verify.run, issue.category, issue.title, issue.description, photo_path,
                issue.lat, issue.lng)
            issue.verified = verdict.verified
            issue.verification_method = verdict.method
            issue.verification_confidence = verdict.confidence
            issue.detection_count = verdict.detections
            issue.severity = verdict.severity
            if not issue.recurrence:
                issue.verification_note = verdict.note
            else:
                issue.verification_note = verdict.note + " " + issue.verification_note
            issue.evidence = jsonable(verdict.evidence)
            issue.model_version = verdict.model_version

            # 3) authenticity / anti-abuse  +  4) evidence trust & multimodal consistency
            novel, scene_pass = await _assess_authenticity(s, issue, photo_path, verdict)
            ev = await _assess_evidence(s, issue, photo_path, verdict, novel, scene_pass)
            issue.ward = ai_wards.assign(issue.lat, issue.lng)

            await ai_audit(s, target=f"issue:{issue.id}", action="ai.evidence_analyzed",
                           summary=f"Evidence Trust {ev.trust_score}/100 · {ev.consistency} consistency · "
                                   f"{ev.verdict.replace('_', ' ')}",
                           reason="; ".join(ev.conflicts) or "no conflicting signals detected",
                           trust_score=ev.trust_score, consistency=ev.consistency,
                           checklist=ev.checklist, model_version=ev.model_version)

            # "AI Verified" is only granted with a genuine VISION match that is also
            # plausibly authentic — OR independent corroboration (3+ citizen reports).
            cc = await cluster_count(s, issue.cluster_id)
            vision_ok = (verdict.verified and verdict.method == "vision"
                         and issue.authenticity_score >= settings.authenticity_verify_min)
            corroborated = cc >= 3 and issue.authenticity_score >= 0.45
            if corroborated and not verdict.verified:
                issue.verified = True
                issue.verification_note += (f" Confirmed by corroboration — {cc} independent "
                                            "citizen reports at this location.")
            ok = vision_ok or corroborated
            if issue.status in ("Reported", "Verifying"):
                issue.status = "Verified" if ok else "Reported"

            # uncertain evidence / conflicts -> Human Review Queue (citizen NOT penalised)
            if ev.verdict == "needs_human_review":
                await _open_review(s, issue, kind="evidence",
                                   reason=ev.note + " " + "; ".join(ev.conflicts),
                                   ai_confidence=verdict.confidence, conflicts=ev.conflicts,
                                   recommended=ev.recommended_action)

            await _recompute_priority(s, issue)
            if issue.recurrence and issue.priority in ("low", "medium"):
                issue.priority = "high"
            issue.eta_days = await _eta_days(s, issue.category, issue.priority)
            await ai_audit(s, target=f"issue:{issue.id}", action="ai.priority_set",
                           summary=f"Priority set to {issue.priority} "
                                   f"({round((issue.priority_score or 0) * 100)}/100)",
                           reason="; ".join((issue.priority_explanation or {}).get("rule_overrides", []))
                                  or "learned base model, no rule overrides")
            await s.commit()
            await hub.broadcast({"type": "issue.updated", "issue": await issue_public(s, issue, None)})
    except Exception as e:  # pragma: no cover
        import traceback
        print(f"[bg process] issue {issue_id}: {e!r}", flush=True)
        traceback.print_exc()


async def _create_issue(session: AsyncSession, user: User, body: IssueIn, ip: str) -> dict:
    if body.category not in settings.categories:
        raise HTTPException(400, f"category must be one of {list(settings.categories)}")
    if not report_limiter.allow(f"report:{user.id}", window=3600):
        raise HTTPException(429, "Report limit reached for this hour")

    photo_url, meta = await _decode_and_store(body.photo_base64, "issue")  # only fast I/O on request path
    photo_path = os.path.join(settings.upload_dir, os.path.basename(photo_url)) if photo_url else None
    needs_ai = settings.ai_enabled

    issue = Issue(
        title=body.title.strip(), description=body.description.strip(), category=body.category,
        lat=body.lat, lng=body.lng, address=body.address.strip(), ward_weight=0.5,
        photo_url=photo_url,
        verification_method="pending" if needs_ai else "none",
        verification_note="AI verification in progress…" if needs_ai else "",
        model_version=ai_verify._MODEL_VERSION,
        status="Verifying" if needs_ai else "Reported", reporter_id=user.id,
    )
    session.add(issue)
    await session.flush()
    issue.cluster_id = issue.id
    issue.priority, issue.priority_score = "medium", 0.4

    user.points += 15
    await audit(session, actor=user, action="issue.create", target=f"issue:{issue.id}", ip=ip, **meta)
    await session.commit()
    payload = await issue_public(session, issue, user)
    await hub.broadcast({"type": "issue.created", "issue": payload})
    if needs_ai:
        ai_queue.put_nowait((issue.id, photo_path))
    return payload


@app.post("/api/issues")
async def create_issue(body: IssueIn, request: Request, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    return await _create_issue(session, user, body, client_ip(request))


@app.post("/api/issues/{issue_id}/vote")
async def toggle_vote(issue_id: int, kind: str = "up", user: User = Depends(get_current_user),
                      session: AsyncSession = Depends(get_session)):
    if kind not in ("up", "adopt"):
        raise HTTPException(400, "kind must be up or adopt")
    issue = await session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    existing = await session.scalar(select(Vote).where(
        Vote.issue_id == issue_id, Vote.user_id == user.id, Vote.kind == kind))
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
            rep = await session.get(User, issue.reporter_id)
            if rep and rep.id != user.id:
                rep.points += 1
    cc = await cluster_count(session, issue.cluster_id)
    rtrust = await reporter_trust(session, issue.reporter_id)
    pr = ai_priority.compute(
        vision_conf=issue.verification_confidence if issue.verification_method == "vision" else 0.0,
        detections=issue.detection_count, severity=issue.severity,
        text_conf=issue.verification_confidence if issue.verification_method == "text" else 0.0,
        cluster_size=cc, upvotes=issue.upvotes, reporter_trust=rtrust,
        ward_weight=issue.ward_weight, category=issue.category,
        text=f"{issue.title} {issue.description}",
    )
    issue.priority, issue.priority_score, issue.priority_explanation = pr.level, pr.score, pr.dict()
    await session.commit()
    await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, issue, None)})
    return {"kind": kind, "active": active, "upvotes": issue.upvotes, "priority": issue.priority}


@app.post("/api/issues/{issue_id}/comments")
async def add_comment(issue_id: int, body: CommentIn, user: User = Depends(get_current_user),
                      session: AsyncSession = Depends(get_session)):
    issue = await session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    session.add(Comment(issue_id=issue_id, user_id=user.id, body=body.body.strip()))
    user.points += 3
    await session.commit()
    return await issue_public(session, issue, user)


# ---- community ----
@app.get("/api/leaderboard")
async def leaderboard(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(User).order_by(User.points.desc()).limit(20))).scalars().all()
    return [{"rank": n + 1, "name": u.name, "points": u.points, "role": u.role,
             "trust": ai_trust.trust_score(u.reports_valid, u.reports_invalid)}
            for n, u in enumerate(rows)]


@app.get("/api/proof-wall")
async def proof_wall(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Issue).where(Issue.status == "Resolved").order_by(Issue.resolved_at.desc()).limit(30)
    )).scalars().all()
    return [{"id": i.id, "title": i.title, "category": i.category, "address": i.address,
             "before": i.photo_url, "after": i.after_photo_url,
             "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None} for i in rows]


# ---- assistant ----
import re as _re


async def _area_stats(session: AsyncSession, lat: float, lng: float, radius: float, label: str) -> dict:
    rows = (await session.execute(select(Issue))).scalars().all()
    near = [r for r in rows if ai_dedup.haversine_m(lat, lng, r.lat, r.lng) <= radius]
    openi = [r for r in near if r.status != "Resolved"]
    res = [r for r in near if r.status == "Resolved"]
    by_cat: dict[str, int] = {}
    for r in openi:
        by_cat[r.category] = by_cat.get(r.category, 0) + 1
    spans = [(aware(r.resolved_at) - aware(r.created_at)).total_seconds() / 86400
             for r in res if r.resolved_at]
    return {
        "label": label, "radius_m": int(radius),
        "open": len(openi), "resolved": len(res),
        "critical": sum(1 for r in openi if r.priority == "critical"),
        "high": sum(1 for r in openi if r.priority == "high"),
        "by_category": by_cat,
        "avg_fix_days": round(sum(spans) / len(spans), 1) if spans else None,
        "recurring": sum(1 for r in openi if r.recurrence),
    }


@app.post("/api/assistant/message")
async def assistant_message(body: AssistantIn, user: User = Depends(get_current_user),
                            session: AsyncSession = Depends(get_session), request: Request = None):
    latlng = (body.lat, body.lng) if body.lat is not None and body.lng is not None else None
    txt = body.text or ""

    mine_rows = (await session.execute(
        select(Issue).where(Issue.reporter_id == user.id).order_by(Issue.created_at.desc()).limit(10)
    )).scalars().all()
    mine = [await issue_public(session, r, user) for r in mine_rows]

    nearby = []
    if latlng:
        allr = (await session.execute(select(Issue))).scalars().all()
        for r in allr:
            d = ai_dedup.haversine_m(latlng[0], latlng[1], r.lat, r.lng)
            if d <= 1500:
                p = await issue_public(session, r, user)
                p["distance_m"] = int(d)
                nearby.append(p)
        nearby.sort(key=lambda x: x["distance_m"])

    issue_ctx = None
    m = _re.search(r"#?\s*(\d{1,6})", txt)
    if m:
        gi = await session.get(Issue, int(m.group(1)))
        if gi:
            issue_ctx = await issue_public(session, gi, user)

    area = None
    if latlng:
        area = await _area_stats(session, latlng[0], latlng[1], 1200, "your location")

    rank = None
    board = (await session.execute(select(User).order_by(User.points.desc()).limit(50))).scalars().all()
    for n, u in enumerate(board):
        if u.id == user.id:
            rank = n + 1
    impact = {
        "points": user.points, "rank": rank,
        "reported": len(mine_rows), "resolved": sum(1 for r in mine_rows if r.status == "Resolved"),
        "trust": ai_trust.trust_score(user.reports_valid, user.reports_invalid),
        "valid": user.reports_valid, "invalid": user.reports_invalid,
    }

    res = assistant.handle(
        session_id=body.session_id, text=txt, user_id=user.id,
        ctx={"mine": mine, "nearby": nearby, "issue": issue_ctx, "area": area,
             "impact": impact, "user_latlng": latlng},
    )

    action = res.get("action")
    if action and action.get("type") == "create_issue":
        p = action["payload"]
        try:
            issue = await _create_issue(session, user, IssueIn(
                title=p.get("title") or "Reported via CIVIA",
                description=p.get("description", ""), category=p.get("category") or "Roads",
                lat=p["lat"], lng=p["lng"], address=p.get("address", "")),
                client_ip(request) if request else "assistant")
            res["reply"] = (f"Filed as report #{issue['id']} · priority {issue['priority']}. "
                            "I'm now running verification, duplicate and recurring-spot checks — "
                            "open the report to watch the AI grade it live.")
            res["action"] = {"type": "issue_created", "issue_id": issue["id"]}
        except HTTPException as e:
            res["reply"] = f"Couldn't file that: {e.detail}"
            res["action"] = None
    elif action and action.get("type") == "add_comment":
        iid = action.get("issue_id")
        gi = await session.get(Issue, iid) if iid else None
        if not gi:
            res["reply"] = f"I couldn't find report #{iid}."
        elif gi.reporter_id != user.id:
            res["reply"] = "I can only add notes to reports you filed."
        else:
            session.add(Comment(issue_id=iid, user_id=user.id, body=action["body"]))
            user.points += 3
            await session.commit()
            await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, gi, None)})
            res["reply"] = f"Added your note to report #{iid}. The team will see it on the issue."
            res["action"] = {"type": "issue_created", "issue_id": iid}
    return res


# ---- authority ----
@app.get("/api/authority/queue")
async def authority_queue(_: User = Depends(require_authority), session: AsyncSession = Depends(get_session)):
    issues = (await session.execute(select(Issue).where(Issue.status != "Resolved"))).scalars().all()
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    issues.sort(key=lambda i: (order.get(i.priority, 9), -i.priority_score, -i.upvotes))
    return [await issue_public(session, i, None) for i in issues]


@app.get("/api/authority/kpis")
async def authority_kpis(_: User = Depends(require_authority), session: AsyncSession = Depends(get_session)):
    alli = (await session.execute(select(Issue))).scalars().all()
    total = len(alli)
    resolved = [i for i in alli if i.status == "Resolved"]
    openi = [i for i in alli if i.status != "Resolved"]
    by_cat = {c: 0 for c in settings.categories}
    by_pri = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for i in openi:
        by_cat[i.category] = by_cat.get(i.category, 0) + 1
        by_pri[i.priority] = by_pri.get(i.priority, 0) + 1
    spans = [(i.resolved_at - i.created_at).total_seconds() / 86400 for i in resolved if i.resolved_at]
    vision_ok = sum(1 for i in openi if i.verification_method == "vision" and i.verified)
    cluster_ids = {i.cluster_id for i in openi}
    merged = 0
    for c in cluster_ids:
        merged += await cluster_count(session, c) - 1
    review_open = await session.scalar(
        select(func.count()).select_from(HumanReview).where(HumanReview.status == "open")) or 0
    awaiting = sum(1 for i in openi if i.awaiting_confirmation)
    reopened = sum(1 for i in alli if i.reopen_count > 0)
    return {
        "total": total, "open": len(openi), "resolved": len(resolved),
        "resolution_rate": round(len(resolved) / total, 3) if total else 0.0,
        "avg_resolution_days": round(sum(spans) / len(spans), 2) if spans else None,
        "vision_verified_open": vision_ok,
        "verified_open_share": round(sum(1 for i in openi if i.verified) / len(openi), 3) if openi else 0.0,
        "by_category": by_cat, "by_priority": by_pri,
        "clusters": len(cluster_ids), "duplicates_merged": merged,
        "human_review_open": review_open, "awaiting_citizen_confirmation": awaiting,
        "reopened": reopened,
        "avg_evidence_trust": round(sum(i.evidence_trust for i in openi) / len(openi)) if openi else 0,
    }


@app.get("/api/authority/audit")
async def authority_audit(limit: int = 150, _: User = Depends(require_authority),
                          session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(AuditLog).order_by(AuditLog.ts.desc())
                                  .limit(min(limit, 500)))).scalars().all()
    names: dict[int, str] = {}
    for r in rows:
        for uid in (r.actor_id, r.overruled_by):
            if uid and uid not in names:
                u = await session.get(User, uid)
                names[uid] = u.name if u else f"user {uid}"
    return [{
        "ts": r.ts.isoformat(), "target": r.target, "action": r.action,
        "actor": names.get(r.actor_id, r.actor_role.upper() or "SYSTEM"),
        "actor_role": r.actor_role,
        "what": r.summary or r.action.replace(".", " ").replace("_", " ").title(),
        "why": r.reason or "", "overruled_by": names.get(r.overruled_by),
        "ip": r.ip, "meta": r.meta or {},
    } for r in rows]


@app.post("/api/authority/issues/{issue_id}/status")
async def set_status(issue_id: int, body: StatusIn, request: Request,
                     actor: User = Depends(require_authority), session: AsyncSession = Depends(get_session)):
    valid = ["Reported", "Verified", "Assigned", "In Progress", "Resolved", "Rejected"]
    if body.status not in valid:
        raise HTTPException(400, f"status must be one of {valid}")
    issue = await session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    prev = issue.status
    rep = await session.get(User, issue.reporter_id)

    if body.status in ("Assigned", "In Progress") and not issue.assigned_at:
        issue.assigned_at = utcnow()

    if body.status == "Resolved":
        # Authority marks "fixed" -> AI resolution verification -> citizen confirmation.
        url, _ = await _decode_and_store(body.after_photo_base64, "after")
        if url:
            issue.after_photo_url = url
        rv = await _verify_resolution(session, issue)
        issue.resolution_confidence = rv.confidence
        issue.resolution_verified = rv.status == "ai_verified"
        issue.resolution_note = rv.note
        session.add(ResolutionVerification(
            issue_id=issue.id, confidence=rv.confidence, status=rv.status,
            same_location=rv.same_location, problem_before=rv.problem_before,
            problem_after=rv.problem_after, after_relevant=rv.after_relevant,
            checklist=rv.checklist, before_photo_url=issue.photo_url,
            after_photo_url=issue.after_photo_url, note=rv.note, model_version=rv.model_version))
        await ai_audit(session, target=f"issue:{issue.id}", action="ai.resolution_verified",
                       summary=f"Resolution Confidence {rv.confidence}/100 · {rv.status.replace('_', ' ')}",
                       reason=rv.note, checklist=rv.checklist)

        if rv.status == "ai_verified":
            issue.status = "AI Verified — Awaiting Confirmation"
            issue.awaiting_confirmation = True
            issue.resolved_at = None
        elif rv.status == "not_fixed":
            issue.status = "In Progress"
            issue.awaiting_confirmation = False
            await _open_review(session, issue, kind="resolution",
                               reason="AFTER evidence does not show the problem resolved.",
                               ai_confidence=rv.confidence / 100, conflicts=[], recommended="request_evidence")
        else:  # needs_human_review
            issue.status = "In Progress"
            issue.awaiting_confirmation = False
            await _open_review(session, issue, kind="resolution",
                               reason=rv.note, ai_confidence=rv.confidence / 100,
                               conflicts=[], recommended="human_review")
    elif body.status == "Rejected":
        issue.status = "Rejected"
        if rep:
            rep.reports_invalid += 1
    else:
        issue.status = body.status
        if body.status != "Resolved":
            issue.resolved_at = None

    if body.reporter_feedback == "valid" and rep:
        rep.reports_valid += 1
    elif body.reporter_feedback == "invalid" and rep:
        rep.reports_invalid += 1

    await audit(session, actor=actor, action="issue.status", target=f"issue:{issue_id}",
                ip=client_ip(request), actor_role="authority",
                summary=f"Status changed: {prev} → {issue.status}",
                reason=(body.note or "authority workflow action"),
                **{"from": prev, "to": issue.status})
    await session.commit()
    await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, issue, None)})
    return await issue_public(session, issue, None)


async def _verify_resolution(session: AsyncSession, issue: Issue) -> "ai_resolution.ResolutionResult":
    """Compare BEFORE vs AFTER evidence and produce a Resolution Confidence."""
    cat = issue.category if issue.category in settings.vision_categories else "Roads"
    before_scene = before_det = None
    for ev in (issue.evidence or []):
        if ev.get("stage") == "scene_gate":
            before_scene = bool(ev.get("is_scene"))
        if ev.get("stage") == "detector":
            before_det = int(ev.get("count", 0))
    before_det = before_det if before_det is not None else issue.detection_count

    after_scene = after_det = None
    frames_identical = False
    after_score = 0.0
    if issue.after_photo_url:
        apath = os.path.join(settings.upload_dir, os.path.basename(issue.after_photo_url))
        try:
            sc = await asyncio.to_thread(ai_verify.scene_gate.check, apath, cat)
            after_scene, after_score = sc.is_scene, sc.score
            if issue.category in settings.vision_categories:
                det = await asyncio.to_thread(ai_verify.detector.detect, apath)
                after_det = det.count
            ah = await asyncio.to_thread(ai_auth.dhash, apath)
            frames_identical = ai_auth.hamming(ah, issue.photo_hash) <= 6 if issue.photo_hash else False
        except Exception:
            pass
    return ai_resolution.verify(
        category=issue.category, same_location=True,
        before_scene_pass=before_scene, before_detections=before_det or 0,
        after_scene_pass=after_scene, after_detections=after_det or 0,
        frames_identical=frames_identical, after_scene_score=after_score or 0.0)


# ---- evidence trust / resolution / citizen confirmation / human review ----
@app.get("/api/issues/{issue_id}/evidence-trust")
async def evidence_trust(issue_id: int, session: AsyncSession = Depends(get_session),
                         authorization: Optional[str] = Header(default=None)):
    viewer = await maybe_user(session, authorization)
    i = await session.get(Issue, issue_id)
    if not i or not can_view(i, viewer):
        raise HTTPException(404, "Issue not found")
    row = (await session.execute(select(EvidenceCheck).where(EvidenceCheck.issue_id == issue_id)
                                 .order_by(EvidenceCheck.created_at.desc()).limit(1))).scalar_one_or_none()
    if not row:
        return {"issue_id": issue_id, "trust_score": i.evidence_trust, "verdict": i.evidence_verdict,
                "consistency": i.consistency, "checklist": [], "conflicts": [],
                "note": "Evidence analysis has not completed yet.", "prototype": True}
    return {"issue_id": issue_id, "trust_score": row.trust_score, "verdict": row.verdict,
            "consistency": row.consistency, "recommended_action": row.recommended_action,
            "checklist": row.checklist, "conflicts": row.conflicts,
            "model_version": row.model_version, "created_at": row.created_at.isoformat(),
            "prototype": True}


@app.post("/api/issues/{issue_id}/evidence/analyze")
async def evidence_analyze(issue_id: int, user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    i = await session.get(Issue, issue_id)
    if not i:
        raise HTTPException(404, "Issue not found")
    if user.role != "authority" and user.id != i.reporter_id:
        raise HTTPException(403, "Not allowed")
    photo_path = os.path.join(settings.upload_dir, os.path.basename(i.photo_url)) if i.photo_url else None
    ai_queue.put_nowait((i.id, photo_path))
    return {"queued": True, "note": "Re-running the evidence pipeline — watch the issue for updates."}


@app.post("/api/issues/{issue_id}/citizen-confirmation")
async def citizen_confirmation(issue_id: int, body: ConfirmIn, request: Request,
                               user: User = Depends(get_current_user),
                               session: AsyncSession = Depends(get_session)):
    i = await session.get(Issue, issue_id)
    if not i:
        raise HTTPException(404, "Issue not found")
    if i.reporter_id != user.id:
        raise HTTPException(403, "Only the citizen who reported this can confirm it")
    i.citizen_confirmation = body.result
    i.awaiting_confirmation = False
    if body.result == "fixed":
        i.status = "Verified Closed"
        i.resolved_at = utcnow()
        rep = await session.get(User, i.reporter_id)
        if rep:
            rep.points += 10
            rep.reports_valid += 1
        summary = "Citizen confirmed the issue is fixed — Verified Closed."
    elif body.result == "partial":
        i.status = "In Progress"
        summary = "Citizen reports the issue is only partially fixed — kept open."
        await _open_review(session, i, kind="resolution",
                           reason="Citizen says the fix is partial.", ai_confidence=0.0,
                           conflicts=[], recommended="human_review")
    else:  # still_exists -> reopen
        i.status = "Reported"
        i.reopen_count += 1
        i.resolved_at = None
        summary = f"Citizen says the problem still exists — issue reopened (#{i.reopen_count})."
    await audit(session, actor=user, action="issue.citizen_confirmation", target=f"issue:{issue_id}",
                ip=client_ip(request), actor_role="citizen", summary=summary,
                reason=body.note or "", result=body.result)
    await _recompute_priority(session, i)
    await session.commit()
    await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, i, None)})
    return await issue_public(session, i, user)


@app.post("/api/issues/{issue_id}/reopen")
async def reopen_issue(issue_id: int, request: Request, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    i = await session.get(Issue, issue_id)
    if not i:
        raise HTTPException(404, "Issue not found")
    if user.id != i.reporter_id and user.role != "authority":
        raise HTTPException(403, "Not allowed")
    i.status = "Reported"
    i.reopen_count += 1
    i.resolved_at = None
    i.awaiting_confirmation = False
    i.citizen_confirmation = "still_exists"
    await audit(session, actor=user, action="issue.reopen", target=f"issue:{issue_id}",
                ip=client_ip(request), actor_role=user.role,
                summary=f"Issue reopened (#{i.reopen_count})",
                reason="problem still present after being marked resolved")
    await _recompute_priority(session, i)
    await session.commit()
    await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, i, None)})
    return await issue_public(session, i, user)


@app.get("/api/issues/{issue_id}/audit")
async def issue_audit(issue_id: int, session: AsyncSession = Depends(get_session),
                      authorization: Optional[str] = Header(default=None)):
    viewer = await maybe_user(session, authorization)
    i = await session.get(Issue, issue_id)
    if not i or not can_view(i, viewer):
        raise HTTPException(404, "Issue not found")
    rows = (await session.execute(select(AuditLog).where(AuditLog.target == f"issue:{issue_id}")
                                  .order_by(AuditLog.ts))).scalars().all()
    who = {}
    for r in rows:
        for uid in (r.actor_id, r.overruled_by):
            if uid and uid not in who:
                u = await session.get(User, uid)
                who[uid] = u.name if u else f"user {uid}"
    return [{
        "ts": r.ts.isoformat(), "actor": (who.get(r.actor_id) if r.actor_id else r.actor_role.upper()),
        "actor_role": r.actor_role, "action": r.action,
        "what": r.summary or r.action.replace(".", " ").replace("_", " ").title(),
        "why": r.reason or "", "overruled_by": who.get(r.overruled_by),
        "meta": r.meta or {},
    } for r in rows]


@app.get("/api/authority/review-queue")
async def review_queue(_: User = Depends(require_authority), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(HumanReview).where(HumanReview.status == "open")
                                  .order_by(HumanReview.created_at))).scalars().all()
    out = []
    for r in rows:
        i = await session.get(Issue, r.issue_id)
        if not i:
            continue
        out.append({
            "id": r.id, "issue_id": r.issue_id, "kind": r.kind, "reason": r.reason,
            "ai_confidence": round(r.ai_confidence * 100),
            "evidence_trust": r.evidence_trust, "conflicts": r.conflicts,
            "recommended_action": r.recommended_action, "created_at": r.created_at.isoformat(),
            "issue": {"title": i.title, "category": i.category, "priority": i.priority,
                      "status": i.status, "photo_url": i.photo_url, "after_photo_url": i.after_photo_url,
                      "consistency": i.consistency},
        })
    return out


@app.post("/api/authority/review/{review_id}/decide")
async def review_decide(review_id: int, body: ReviewDecisionIn, request: Request,
                        actor: User = Depends(require_authority),
                        session: AsyncSession = Depends(get_session)):
    r = await session.get(HumanReview, review_id)
    if not r or r.status != "open":
        raise HTTPException(404, "Review not found or already decided")
    i = await session.get(Issue, r.issue_id)
    r.status = "decided"; r.decision = body.decision; r.decision_note = body.note
    r.reviewer_id = actor.id; r.decided_at = utcnow()
    if i:
        i.in_human_review = bool(await session.scalar(select(HumanReview).where(
            HumanReview.issue_id == i.id, HumanReview.status == "open", HumanReview.id != review_id)))
        if body.decision == "approve":
            if r.kind == "resolution":
                i.status = "AI Verified — Awaiting Confirmation"; i.awaiting_confirmation = True
            elif i.status in ("Reported", "Verifying"):
                i.status = "Verified"; i.verified = True
        elif body.decision == "reject":
            i.status = "Rejected"
        elif body.decision == "reopen":
            i.status = "Reported"; i.reopen_count += 1; i.resolved_at = None
        elif body.decision == "escalate":
            i.priority = "critical"
        # "request_evidence" leaves status unchanged
    await audit(session, actor=actor, action="human_review.decision", target=f"issue:{r.issue_id}",
                ip=client_ip(request), actor_role="authority",
                summary=f"Human review ({r.kind}): {body.decision.replace('_', ' ')}",
                reason=body.note or r.reason, overruled_by=actor.id, decision=body.decision)
    await session.commit()
    if i:
        await hub.broadcast({"type": "issue.updated", "issue": await issue_public(session, i, None)})
    return {"ok": True, "decision": body.decision}


@app.get("/api/authority/fairness")
async def authority_fairness(_: User = Depends(require_authority),
                             session: AsyncSession = Depends(get_session)):
    issues = (await session.execute(select(Issue))).scalars().all()
    return ai_wards.fairness(issues, utcnow())


# ---- privacy ----
@app.post("/api/issues/{issue_id}/privacy")
async def set_privacy(issue_id: int, body: PrivacyIn, user: User = Depends(get_current_user),
                      session: AsyncSession = Depends(get_session)):
    i = await session.get(Issue, issue_id)
    if not i:
        raise HTTPException(404, "Issue not found")
    if i.reporter_id != user.id:
        raise HTTPException(403, "Only the reporter can change privacy on this report")
    if body.is_public is not None:
        i.is_public = body.is_public
    if body.precise_location_public is not None:
        i.precise_location_public = body.precise_location_public
    await session.commit()
    return await issue_public(session, i, user)


# ---- Civic Services & Payments (Razorpay TEST / sandbox) ----
@app.get("/api/payments/config")
async def payments_config(_: User = Depends(get_current_user)):
    return pay.public_config()


@app.post("/api/payments/create-order")
async def payments_create_order(body: PaymentOrderIn, user: User = Depends(get_current_user),
                                session: AsyncSession = Depends(get_session)):
    svc = pay.SERVICE_MAP.get(body.service_code)
    if not svc:
        raise HTTPException(400, "Unknown service")
    receipt = pay.receipt_no()
    try:
        created = await asyncio.to_thread(pay.create_order, svc["amount"], receipt,
                                          {"service": svc["code"], "user_id": str(user.id)})
    except Exception as e:
        raise HTTPException(502, f"Payment provider error: {e}")
    order = PaymentOrder(
        user_id=user.id, service_code=svc["code"], service_name=svc["name"],
        amount=svc["amount"], provider_order_id=created["provider_order_id"],
        status="created", receipt_no=receipt, mode=created["mode"], meta={"desc": svc["desc"]})
    session.add(order)
    await session.commit()
    return {
        "order_id": order.id, "provider_order_id": created["provider_order_id"],
        "amount": svc["amount"], "currency": "INR", "service_name": svc["name"],
        "receipt_no": receipt, "mode": created["mode"],
        "key_id": settings.razorpay_key_id if created["mode"] == "test" else "",
        # only present in simulated mode so the prototype can complete the flow:
        "simulated_client": pay.simulate_client_payment(created["provider_order_id"])
        if created["mode"] == "simulated" else None,
    }


@app.post("/api/payments/verify")
async def payments_verify(body: PaymentVerifyIn, user: User = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session)):
    order = await session.get(PaymentOrder, body.order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(404, "Order not found")
    if order.status == "paid":                      # idempotent — no double processing
        return {"status": "paid", "receipt_no": order.receipt_no, "already": True}
    if order.provider_order_id != body.razorpay_order_id:
        raise HTTPException(400, "Order id mismatch")
    ok = pay.verify_payment_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)
    txn = PaymentTransaction(
        order_id=order.id, provider_payment_id=body.razorpay_payment_id,
        provider_signature=body.razorpay_signature, event="verify",
        method=body.method or "upi", status="captured" if ok else "signature_failed",
        raw={"verified": ok})
    session.add(txn)
    if ok:
        order.status = "paid"
        order.provider_payment_id = body.razorpay_payment_id
        order.updated_at = utcnow()
    await session.commit()
    if not ok:
        raise HTTPException(400, "Payment signature verification failed")
    return {"status": "paid", "receipt_no": order.receipt_no,
            "payment_id": body.razorpay_payment_id, "mode": order.mode}


@app.post("/api/payments/webhook")
async def payments_webhook(request: Request, session: AsyncSession = Depends(get_session)):
    raw = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    if not pay.verify_webhook_signature(raw, sig):
        raise HTTPException(400, "Invalid webhook signature")
    try:
        event = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Bad payload")
    ent = (event.get("payload", {}).get("payment", {}).get("entity", {}))
    oid = ent.get("order_id")
    order = await session.scalar(select(PaymentOrder).where(PaymentOrder.provider_order_id == oid)) if oid else None
    if order and order.status != "paid" and event.get("event") == "payment.captured":
        order.status = "paid"
        order.provider_payment_id = ent.get("id")
        order.updated_at = utcnow()
        session.add(PaymentTransaction(order_id=order.id, provider_payment_id=ent.get("id"),
                                       event="webhook:payment.captured", method=ent.get("method", ""),
                                       status="captured", raw=event))
        await session.commit()
    return {"ok": True}


@app.get("/api/payments/history")
async def payments_history(user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(PaymentOrder).where(PaymentOrder.user_id == user.id)
                                  .order_by(PaymentOrder.created_at.desc()))).scalars().all()
    return [{
        "id": o.id, "service": o.service_name, "amount": o.amount, "currency": o.currency,
        "status": o.status, "transaction_id": o.provider_payment_id or o.provider_order_id,
        "receipt_no": o.receipt_no, "mode": o.mode, "date": o.created_at.isoformat(),
    } for o in rows]


@app.get("/api/payments/{order_id}/receipt")
async def payments_receipt(order_id: int, user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    o = await session.get(PaymentOrder, order_id)
    if not o or o.user_id != user.id:
        raise HTTPException(404, "Not found")
    if o.status != "paid":
        raise HTTPException(400, "Receipt available only for paid transactions")
    return {
        "receipt_no": o.receipt_no, "service": o.service_name, "amount": o.amount,
        "currency": o.currency, "payer": user.name, "payer_email": user.email,
        "transaction_id": o.provider_payment_id, "order_id": o.provider_order_id,
        "paid_at": o.updated_at.isoformat(), "mode": o.mode,
        "issuer": "CiviTrace AI Civic Services (prototype)",
        "note": "This is a prototype receipt. " + (
            "Razorpay TEST transaction — no real money moved."
            if o.mode == "test" else "Simulated payment — no Razorpay call was made."),
    }


@app.post("/api/authority/rainfall-twin")
async def rainfall_twin(body: RainfallIn, _: User = Depends(require_authority),
                        session: AsyncSession = Depends(get_session)):
    baseline = await session.scalar(
        select(func.count()).select_from(Issue).where(Issue.category == "Flooding")) or 0
    r = body.rainfall_mm
    projected = baseline + 0.12 * r + 0.0009 * (r ** 2)
    import math
    crews = max(1, math.ceil(projected / 6))
    level = "low" if r < 15 else "moderate" if r < 45 else "high" if r < 90 else "severe"
    return {"rainfall_mm": r, "baseline_flooding_reports": baseline,
            "baseline_drainage_reports": baseline,
            "projected_reports": round(projected, 1), "recommended_crews": crews,
            "flood_risk_level": level,
            "note": "Deterministic surrogate (baseline + 0.12·mm + 0.0009·mm²); "
                    "upgrade path: train on historical rainfall↔complaint pairs."}


# ---- websocket ----
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await hub.connect(ws)
    try:
        await ws.send_json({"type": "hello", "clients": len(hub.clients)})
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        hub.drop(ws)


# ---- SPA ----
if os.path.isdir(settings.frontend_dir):
    _index = os.path.join(settings.frontend_dir, "index.html")
    _MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
             ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
             ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
             ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json",
             ".webmanifest": "application/manifest+json", ".html": "text/html"}

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        cand = os.path.join(settings.frontend_dir, full_path)
        if full_path and os.path.isfile(cand):
            # hashed asset filenames -> safe to cache hard; everything else no-store
            hashed = "/assets/" in ("/" + full_path) and any(
                full_path.endswith(e) for e in (".js", ".css", ".woff2", ".woff"))
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if hashed \
                else {"Cache-Control": "no-store"}
            return FileResponse(cand, media_type=_MIME.get(os.path.splitext(cand)[1].lower()),
                                headers=headers)
        # index.html must never be cached, or clients keep booting a stale bundle
        return FileResponse(_index, media_type="text/html", headers={"Cache-Control": "no-store"})
