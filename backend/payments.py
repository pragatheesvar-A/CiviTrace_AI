"""
Civic Services & Payments — Razorpay (TEST / sandbox).

SECURITY (enforced here):
  * The secret key lives only in the backend env (CIVIC_RAZORPAY_KEY_SECRET) and
    is never returned to the client. Only the *key id* (publishable) is exposed.
  * Orders are created server-side. Payment signatures and webhook signatures are
    verified server-side with HMAC-SHA256.
  * Duplicate processing is prevented by a unique provider_order_id and an
    idempotent status transition (created -> paid only once).
  * No card data is ever received or stored — Razorpay Checkout handles it.

MODES:
  * "test"      — real Razorpay sandbox calls (keys configured). Uses TEST keys
                  only; live keys are rejected.
  * "simulated" — no keys configured. The flow is fully exercised end-to-end with
                  a locally-signed mock so the prototype is demonstrable. Every
                  such record is clearly labelled mode="simulated".

Payments are completely separate from civic complaints and never influence
issue priority.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.request
import uuid
from typing import Optional

from config import settings

# configurable civic services (amounts in paise). Normal complaints are NOT here.
SERVICES = [
    {"code": "property_tax", "name": "Property Tax", "amount": 250000, "desc": "Half-yearly property tax"},
    {"code": "water_bill", "name": "Water & Sewerage Bill", "amount": 42000, "desc": "Monthly metered charge"},
    {"code": "parking_fee", "name": "Monthly Parking Permit", "amount": 60000, "desc": "Residential zone permit"},
    {"code": "trade_licence", "name": "Trade Licence Renewal", "amount": 150000, "desc": "Annual renewal fee"},
    {"code": "building_permit", "name": "Building Plan Application Fee", "amount": 500000, "desc": "Plan scrutiny fee"},
    {"code": "birth_cert", "name": "Birth Certificate (extra copy)", "amount": 5000, "desc": "Per certified copy"},
]
SERVICE_MAP = {s["code"]: s for s in SERVICES}


def mode() -> str:
    if settings.payments_mode == "simulated":
        return "simulated"
    if settings.razorpay_key_id and settings.razorpay_key_secret:
        # refuse live keys in this prototype
        if settings.razorpay_key_id.startswith("rzp_live_"):
            return "simulated"
        return "test"
    return "simulated"


def public_config() -> dict:
    m = mode()
    return {
        "mode": m,
        "provider": "razorpay",
        "key_id": settings.razorpay_key_id if m == "test" else "",
        "currency": "INR",
        "note": ("Razorpay sandbox — TEST payments only, no real money moves." if m == "test"
                 else "Demo mode — payments are simulated (no Razorpay account connected). "
                      "The full flow, verification and receipts still work."),
        "services": SERVICES,
    }


# ------------------------------------------------------------------ order create
def create_order(amount: int, receipt: str, notes: dict) -> dict:
    """Returns {provider_order_id, mode, raw}."""
    if mode() == "test":
        body = json.dumps({
            "amount": amount, "currency": "INR", "receipt": receipt,
            "notes": notes, "payment_capture": 1,
        }).encode()
        auth = base64.b64encode(
            f"{settings.razorpay_key_id}:{settings.razorpay_key_secret}".encode()).decode()
        req = urllib.request.Request(
            "https://api.razorpay.com/v1/orders", data=body, method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Basic {auth}"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        return {"provider_order_id": data["id"], "mode": "test", "raw": data}
    # simulated
    oid = "order_SIM" + uuid.uuid4().hex[:16]
    return {"provider_order_id": oid, "mode": "simulated",
            "raw": {"id": oid, "amount": amount, "currency": "INR", "simulated": True}}


# ------------------------------------------------------------- signature verify
def _hmac_sha256_hex(msg: str, key: str) -> str:
    return hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Razorpay: HMAC_SHA256(order_id + '|' + payment_id, key_secret)."""
    if mode() == "simulated":
        # locally-signed mock: signature must equal HMAC(order|payment, 'SIMULATED')
        expected = _hmac_sha256_hex(f"{order_id}|{payment_id}", "SIMULATED")
        return hmac.compare_digest(expected, signature or "")
    expected = _hmac_sha256_hex(f"{order_id}|{payment_id}", settings.razorpay_key_secret)
    return hmac.compare_digest(expected, signature or "")


def simulate_client_payment(order_id: str) -> dict:
    """Only used in simulated mode: mimics what the Razorpay Checkout would hand
    back to the client, with a valid local signature."""
    pid = "pay_SIM" + uuid.uuid4().hex[:16]
    sig = _hmac_sha256_hex(f"{order_id}|{pid}", "SIMULATED")
    return {"razorpay_order_id": order_id, "razorpay_payment_id": pid,
            "razorpay_signature": sig, "method": "upi", "simulated": True}


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    secret = settings.razorpay_webhook_secret
    if not secret:
        return False
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def receipt_no() -> str:
    return "CP-" + time.strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:6].upper()
