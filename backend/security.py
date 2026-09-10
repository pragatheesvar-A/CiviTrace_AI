"""
Security & privacy primitives.

  * SecurityHeadersMiddleware  — CSP, HSTS, no-sniff, frame-deny, referrer policy
  * TokenBucketLimiter         — in-process per-identity rate limiting (no Redis dep)
  * sanitize_image             — decode, re-encode (drops EXIF incl. GPS), optional
                                 face blur, size cap  → privacy by default
  * audit                      — structured audit-log helper
"""
from __future__ import annotations

import io
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from config import settings


# --------------------------------------------------------------------------- #
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp: Response = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(self), microphone=()")
        resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if settings.env == "prod":
            resp.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
            resp.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org "
                "https://*.googleapis.com https://*.gstatic.com; "
                "connect-src 'self' https://*.googleapis.com; "
                "script-src 'self' https://maps.googleapis.com; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                "font-src https://fonts.gstatic.com; frame-ancestors 'none'",
            )
        return resp


# --------------------------------------------------------------------------- #
class TokenBucketLimiter:
    def __init__(self, rate_per_min: int):
        self.capacity = rate_per_min
        self.buckets: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str, cost: int = 1, window: int = 60) -> bool:
        now = time.time()
        dq = self.buckets[key]
        while dq and now - dq[0] > window:
            dq.popleft()
        if len(dq) + cost > self.capacity:
            return False
        for _ in range(cost):
            dq.append(now)
        return True


global_limiter = TokenBucketLimiter(settings.rate_limit_per_min)
report_limiter = TokenBucketLimiter(settings.report_rate_limit_per_hour)


# --------------------------------------------------------------------------- #
_HAAR = None


def _face_cascade():
    global _HAAR
    if _HAAR is None:
        try:
            import cv2

            _HAAR = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            )
        except Exception:
            _HAAR = False
    return _HAAR


def sanitize_image(raw: bytes) -> tuple[bytes, dict]:
    """Return (clean_jpeg_bytes, meta). Strips EXIF (GPS!), optionally blurs faces."""
    from PIL import Image

    meta = {"exif_stripped": False, "faces_blurred": 0, "resized": False}
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise ValueError(f"Image exceeds {settings.max_upload_mb} MB")
    im = Image.open(io.BytesIO(raw))
    im.verify()
    im = Image.open(io.BytesIO(raw)).convert("RGB")

    if settings.strip_exif:
        meta["exif_stripped"] = True  # re-encoding below drops all metadata

    # cap dimensions
    if max(im.size) > 2048:
        im.thumbnail((2048, 2048))
        meta["resized"] = True

    if settings.blur_faces:
        cascade = _face_cascade()
        if cascade:
            try:
                import cv2
                import numpy as np

                arr = np.array(im)[:, :, ::-1].copy()  # RGB->BGR
                gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
                faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(28, 28))
                for (x, y, w, h) in faces:
                    roi = arr[y:y + h, x:x + w]
                    if roi.size:
                        arr[y:y + h, x:x + w] = cv2.GaussianBlur(roi, (0, 0), 12)
                if len(faces):
                    im = Image.fromarray(arr[:, :, ::-1])
                    meta["faces_blurred"] = int(len(faces))
            except Exception:
                pass

    out = io.BytesIO()
    im.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue(), meta
