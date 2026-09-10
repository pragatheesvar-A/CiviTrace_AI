"""Auth: argon2/bcrypt hashing, short access + rotating refresh JWTs, TOTP 2FA."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from config import settings


# --------------------------------------------------------------- passwords
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


# --------------------------------------------------------------- tokens
def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_access(user_id: int, role: str) -> str:
    return jwt.encode(
        {"sub": str(user_id), "role": role, "typ": "access",
         "exp": _now() + timedelta(minutes=settings.access_ttl_min)},
        settings.jwt_secret, algorithm=settings.jwt_alg,
    )


def make_refresh(user_id: int, jti: str) -> str:
    return jwt.encode(
        {"sub": str(user_id), "typ": "refresh", "jti": jti,
         "exp": _now() + timedelta(days=settings.refresh_ttl_days)},
        settings.jwt_secret, algorithm=settings.jwt_alg,
    )


def decode(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])


def new_jti() -> str:
    return secrets.token_urlsafe(16)


# --------------------------------------------------------------- TOTP (RFC 6238)
def new_totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode().rstrip("=")


def totp_now(secret: str, step: int = 30, digits: int = 6, t: float | None = None) -> str:
    key = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8))
    counter = int((t or time.time()) // step)
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    o = h[-1] & 0x0F
    code = (struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def totp_verify(secret: str, code: str, window: int = 1) -> bool:
    code = (code or "").strip()
    for w in range(-window, window + 1):
        if hmac.compare_digest(totp_now(secret, t=time.time() + w * 30), code):
            return True
    return False


def totp_uri(secret: str, email: str) -> str:
    return (f"otpauth://totp/CiviTrace AI:{email}?secret={secret}"
            f"&issuer=CiviTrace AI&digits=6&period=30")
