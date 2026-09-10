"""SQLAlchemy models."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


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
    role: Mapped[str] = mapped_column(String(20), default="citizen")
    points: Mapped[int] = mapped_column(Integer, default=0)
    # reporter-trust counters (authority feedback)
    reports_valid: Mapped[int] = mapped_column(Integer, default=0)
    reports_invalid: Mapped[int] = mapped_column(Integer, default=0)
    # 2FA
    totp_secret: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # lockout
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Issue(Base):
    __tablename__ = "issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default="Reported", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium", index=True)
    priority_score: Mapped[float] = mapped_column(Float, default=0.0)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    address: Mapped[str] = mapped_column(String(255), default="")
    ward_weight: Mapped[float] = mapped_column(Float, default=0.5)
    photo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    after_photo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_method: Mapped[str] = mapped_column(String(20), default="none")
    verification_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    detection_count: Mapped[int] = mapped_column(Integer, default=0)
    severity: Mapped[float] = mapped_column(Float, default=0.0)
    verification_note: Mapped[str] = mapped_column(String(400), default="")
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    priority_explanation: Mapped[dict] = mapped_column(JSON, default=dict)
    model_version: Mapped[str] = mapped_column(String(120), default="")

    cluster_id: Mapped[int] = mapped_column(Integer, index=True, default=0)
    dedupe_distance: Mapped[float] = mapped_column(Float, default=0.0)
    dedupe_matched_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    embedding: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)

    # authenticity / anti-abuse
    photo_hash: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    authenticity_score: Mapped[float] = mapped_column(Float, default=0.0)
    authenticity: Mapped[dict] = mapped_column(JSON, default=dict)

    # chronic-location / recurrence intelligence
    recurrence: Mapped[bool] = mapped_column(Boolean, default=False)
    recurrence_of: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    recurrence_count: Mapped[int] = mapped_column(Integer, default=0)

    # resolution-proof verification (after-photo check)
    resolution_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    resolution_note: Mapped[str] = mapped_column(String(400), default="")
    resolution_confidence: Mapped[int] = mapped_column(Integer, default=0)
    eta_days: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # evidence trust + multimodal consistency (latest, denormalised for lists)
    evidence_trust: Mapped[int] = mapped_column(Integer, default=0)       # 0-100
    evidence_verdict: Mapped[str] = mapped_column(String(24), default="")  # trusted|needs_human_review
    consistency: Mapped[str] = mapped_column(String(12), default="")       # high|medium|low

    # workflow additions
    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    awaiting_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    citizen_confirmation: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)  # fixed|still_exists|partial
    reopen_count: Mapped[int] = mapped_column(Integer, default=0)
    in_human_review: Mapped[bool] = mapped_column(Boolean, default=False)
    ward: Mapped[str] = mapped_column(String(60), default="")

    # privacy
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    precise_location_public: Mapped[bool] = mapped_column(Boolean, default=False)

    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Vote(Base):
    __tablename__ = "votes"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="up")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    code_hash: Mapped[str] = mapped_column(String(255))
    purpose: Mapped[str] = mapped_column(String(20), default="login")  # login | signup
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    actor_role: Mapped[str] = mapped_column(String(20), default="")   # citizen|authority|ai|system
    action: Mapped[str] = mapped_column(String(60), index=True)
    target: Mapped[str] = mapped_column(String(120), default="", index=True)
    ip: Mapped[str] = mapped_column(String(60), default="")
    # for the human-readable "AI Decision & Audit History"
    summary: Mapped[str] = mapped_column(String(400), default="")     # WHAT
    reason: Mapped[str] = mapped_column(String(600), default="")      # WHY
    overruled_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # WHO overruled
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class EvidenceCheck(Base):
    """One row per evidence-analysis run for an issue (kept as history)."""
    __tablename__ = "evidence_checks"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    trust_score: Mapped[int] = mapped_column(Integer, default=0)
    verdict: Mapped[str] = mapped_column(String(24), default="")
    consistency: Mapped[str] = mapped_column(String(12), default="")
    recommended_action: Mapped[str] = mapped_column(String(32), default="")
    checklist: Mapped[list] = mapped_column(JSON, default=list)
    conflicts: Mapped[list] = mapped_column(JSON, default=list)
    model_version: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResolutionVerification(Base):
    __tablename__ = "resolution_verifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="")   # ai_verified|needs_human_review|not_fixed
    same_location: Mapped[bool] = mapped_column(Boolean, default=True)
    problem_before: Mapped[bool] = mapped_column(Boolean, default=False)
    problem_after: Mapped[bool] = mapped_column(Boolean, default=False)
    after_relevant: Mapped[bool] = mapped_column(Boolean, default=False)
    checklist: Mapped[list] = mapped_column(JSON, default=list)
    before_photo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    after_photo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    note: Mapped[str] = mapped_column(String(400), default="")
    model_version: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HumanReview(Base):
    __tablename__ = "human_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="evidence")   # evidence|resolution|conflict|priority
    reason: Mapped[str] = mapped_column(String(400), default="")
    ai_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    evidence_trust: Mapped[int] = mapped_column(Integer, default=0)
    conflicts: Mapped[list] = mapped_column(JSON, default=list)
    recommended_action: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open|decided
    reviewer_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    decision: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)   # approve|reject|request_evidence|reopen|escalate
    decision_note: Mapped[str] = mapped_column(String(600), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PaymentOrder(Base):
    """Civic-services payment (Razorpay TEST/sandbox). Completely separate from
    civic complaints — never affects issue priority."""
    __tablename__ = "payment_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    service_code: Mapped[str] = mapped_column(String(40))
    service_name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[int] = mapped_column(Integer)          # in paise
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    provider: Mapped[str] = mapped_column(String(20), default="razorpay")
    provider_order_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    provider_payment_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="created", index=True)  # created|paid|failed|cancelled|refunded
    receipt_no: Mapped[str] = mapped_column(String(40), default="")
    mode: Mapped[str] = mapped_column(String(16), default="test")   # test|simulated
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("payment_orders.id"), index=True)
    provider_payment_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    provider_signature: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    event: Mapped[str] = mapped_column(String(40), default="")       # verify|webhook:payment.captured|...
    method: Mapped[str] = mapped_column(String(20), default="")
    status: Mapped[str] = mapped_column(String(16), default="")
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
