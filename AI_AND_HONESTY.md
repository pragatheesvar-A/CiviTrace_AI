# CiviTrace AI — AI Components & Honesty Statement

This document states plainly what is a **trained model**, what is a **pretrained
model used as-is**, and what is a **heuristic / rule prototype**. It exists so
the IEEE research paper does not overclaim. No accuracy, precision, recall or F1
number is reported here because **none has been measured on a labelled CiviTrace AI
dataset**. Where a number appears in the UI (a "trust score", a "confidence"),
it is an **illustrative decision aid**, not a validated metric.

## 1. Pretrained models used as-is (not trained by us)

| Component | Model | Role | Status |
|---|---|---|---|
| Scene relevance gate | OpenAI **CLIP ViT-B/32** (zero-shot) | Does the photo show the claimed kind of scene? | Pretrained, used zero-shot with hand-written prompt ensembles + temperature scaling. **Prompts and threshold are hand-tuned, not fitted.** |
| Pothole detector | **YOLOv8m** pothole seg. weights (`keremberke/yolov8m-pothole-segmentation`) | Count / locate potholes in a road photo | Third-party pretrained weights. We did **not** train or fine-tune them and have **not** re-measured their accuracy on our data. |
| Text classification & embeddings | **sentence-transformers all-MiniLM-L6-v2** | Category suggestion + semantic dedup + assistant intent | Pretrained. Category "prototypes" are averaged embeddings of a few curated seed phrases — **nearest-centroid, no training**. |
| Priority base model | scikit-learn **GradientBoostingClassifier** | 4-level base priority | **Trained at startup on a synthetic, rule-consistent dataset** (documented in code). This is a self-contained placeholder. Replace `weights/priority_train.csv` with real labelled triage history to train for real. |

## 2. Heuristic / rule prototypes (labelled "Prototype" / "Not Yet Measured" in the UI)

| Component | What it is |
|---|---|
| **Evidence Trust Score (0–100)** | A transparent weighted sum of observable signals (photo relevance, text↔image agreement, GPS plausibility, timestamp sanity, reused-image via perceptual hash, nearby corroboration, sensor cross-check). Weights are **hand-set, not learned**. Low score → Human Review, never auto-reject. |
| **Multimodal Consistency (HIGH/MED/LOW)** | Rule over the same signals + conflict reasons. |
| **AI Resolution Verification** | Rule combination over the CLIP gate, the YOLO detector delta (before vs after) and a perceptual-hash frame difference. **Not** a trained "is-it-fixed" model. |
| **Fair-priority layer** | Transparent `if` rules on top of the base model: school/hospital proximity (keyword/POI heuristic), issue age, SLA breach, citizen confirmation, rainfall factor, estimated affected count. Every override is written to the audit log. |
| **Ward assignment** | Nearest of ~10 approximate Chennai zone centroids. **No official ward polygons.** |
| **Ward Fairness Dashboard** | Descriptive statistics + a "Possible Service Inequality" flag (resolution time > 1.6× median with ≥3 unresolved). **Decision support only** — it changes nothing automatically. |
| **Rainfall correlation / sensor** | Live precipitation from Open-Meteo (real API, keyless). Any other "sensor" (water-level, etc.) is **Simulated**. |
| **Rainfall digital twin** | Deterministic surrogate `baseline + 0.12·mm + 0.0009·mm²`. Not a trained model. |
| **Reporter trust** | Beta-posterior mean of authority valid/invalid feedback — a standard estimator, not ML. |

## 3. What is genuinely implemented (not simulated)

- Real CLIP / YOLO / MiniLM inference on CPU (`transformers`, `ultralytics`, `sentence-transformers`).
- JWT auth: short access token + **rotating** refresh token (revoked on use), account lockout, TOTP 2FA, rate limiting, security headers, EXIF-strip + face-blur on upload, audit log.
- Async job queue so heavy inference never blocks the API; results stream over WebSocket.
- Spatio-semantic deduplication and clustering.
- Full human-review workflow, citizen confirmation, reopen, and an end-to-end audit trail.
- Razorpay signature verification (HMAC-SHA256) for payment **and** webhook, server-side order creation, idempotent status transitions.

## 4. Payments

- **Test mode**: real Razorpay **sandbox** calls when `CIVIC_RAZORPAY_KEY_ID` /
  `CIVIC_RAZORPAY_KEY_SECRET` (TEST keys) are set. Live keys are refused.
- **Simulated mode** (default, no keys): the full flow runs with a locally
  HMAC-signed mock so the prototype is demonstrable. Every such record is stored
  with `mode = "simulated"` and every receipt says so.
- Normal civic complaints (potholes, garbage, drainage, streetlights, water,
  safety, flooding, traffic) are **always free**. Payments are a separate module
  and **never** influence issue priority.

## 5. Not implemented / out of scope

- No real IoT hardware. No official municipal integration. No SMS/email delivery
  (OTP `dev_code` is returned in the dev environment). No trained resolution or
  evidence model. No measured model metrics.
