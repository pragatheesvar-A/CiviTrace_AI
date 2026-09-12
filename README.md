# CiviTrace AI

**AI-Driven Real-Time Civic Intelligence Framework for Transparent and Collaborative Problem-Solving**

A full-stack civic issue reporting platform where citizens report problems (potholes, garbage, drainage, streetlights, water, safety, flooding, traffic) and authorities triage and resolve them — backed by a two-stage AI verification pipeline, proximity-based deduplication, transparent priority scoring, and a live community feed.

Built with **React 19 + Vite** on the frontend and **FastAPI + SQLAlchemy (async) + SQLite** on the backend, with real CLIP / YOLOv8 / MiniLM inference for photo verification and semantic deduplication.

> This project ships with an [AI & Honesty Statement](AI_AND_HONESTY.md) that states plainly which components are trained models, which are pretrained models used as-is, and which are transparent heuristics — written so the accompanying research write-up doesn't overclaim.

---

## Features

- **Multilingual, voice-enabled reporting** — Tamil / English / Tanglish / Hindi and more, with GPS tagging and photo capture.
- **Two-stage AI verification** — a CLIP-based scene-relevance gate, followed by a YOLOv8 pothole detector; other categories fall back to an honest text classifier. Every result is tagged with its verification method (`vision` vs `text`).
- **Spatio-semantic deduplication** — new reports within 60 m of an existing open issue of the same category join its cluster instead of creating noise.
- **Transparent priority scoring** — combines verification confidence, detection count, upvotes, cluster size, school/hospital proximity, SLA breach, and rainfall correlation. Every override is written to an audit log.
- **Authority triage hub** — priority-sorted queue, live KPI dashboard (resolution rate, avg. resolution time, verified share), status transitions, and a rainfall digital-twin signal.
- **Community layer** — upvotes, adopt-an-issue, threaded comments, civic points, leaderboard, and a before/after proof wall.
- **Live feed** — WebSocket-driven updates across Home, Map, and the Authority hub.
- **Security-conscious by default** — JWT auth with rotating refresh tokens, TOTP 2FA, rate limiting, account lockout, EXIF-strip + face-blur on uploads, and role-enforced (citizen vs. authority) endpoints.

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | React 19, Vite, React Router, Tailwind CSS, Leaflet / react-leaflet |
| Backend | FastAPI, SQLAlchemy (async), SQLite, WebSockets |
| AI / ML | CLIP ViT-B/32 (zero-shot scene gate), YOLOv8m pothole segmentation, sentence-transformers MiniLM (embeddings + dedup), scikit-learn GradientBoostingClassifier (base priority) |
| Payments | Razorpay (sandbox by default; live keys refused) |
| Deployment | Docker / docker-compose |

## Getting started

### Option A — one command (serves the built SPA from FastAPI)
```powershell
./run.ps1
```
Then open **http://localhost:8010**.

### Option B — dev mode with hot reload
```powershell
./dev.ps1          # backend :8010 + Vite :5173
```
Open **http://localhost:5173**.

### Option C — Docker
```bash
docker compose up --build      # http://localhost:8010
```

### Manual setup
```bash
pip install -r backend/requirements.txt
cd web && npm install && npm run build        # emits ../frontend
cd ../backend && uvicorn main:app --port 8010
```

Interactive API docs are served at **http://localhost:8010/docs**.

## Demo logins (seeded on first start)

| Role      | Email                         | Password      |
|-----------|-------------------------------|---------------|
| Citizen   | `alex@example.com`            | `citizen123`  |
| Citizen   | `priya@example.com`           | `citizen123`  |
| Authority | `authority@chennai.gov.in`    | `authority123`|

## What's wired end-to-end

- **Auth** — register / login, JWT (7-day), `citizen` vs `authority` roles enforced server-side (`require_authority` dependency). Authority-only endpoints return 403 otherwise.
- **Reporting** — `POST /api/issues` with title, description, category, GPS, optional base64 photo. Photo is decoded, validated with Pillow, stored under `/uploads`, and served back.
- **AI verification pipeline** (`run_verification`):
  - Roads + photo → **Stage 1** scene-relevance gate ("is this a road surface?"). If it fails, the report is *not* marked verified.
  - **Stage 2** (only if Stage 1 passes) → pothole detector returning a per-detection confidence and a count. ≥2 detections auto-escalates priority to **critical**.
  - Other categories (or Roads without a photo) → honest **text keyword classifier**, explicitly tracked as a weaker signal (`verification_method` = `vision` | `text` | `none`).
  - **Honest note:** the vision stages are real CLIP + YOLOv8 inference, not a mock — see [AI_AND_HONESTY.md](AI_AND_HONESTY.md) for exactly what is trained vs. pretrained vs. heuristic.
- **Deduplication** — new reports within 60 m of an open same-category issue join its cluster; `cluster_count` feeds the priority score and grows the map marker.
- **Priority** — computed from verification signal + detections + upvotes + cluster size (`compute_priority`).
- **Community** — upvote / adopt toggle, threaded comments, civic points (report +15, comment +3, your report upvoted +1, your report resolved +10), `/api/leaderboard`, `/api/proof-wall` (before/after).
- **Authority hub** — priority-sorted triage queue, KPI dashboard computed from real data (open/resolved, resolution rate, avg resolution days, verified share, category & priority breakdowns), status transitions, and a rainfall **digital-twin** endpoint (deterministic formula, labeled as such).
- **Live feed** — `ws://…/ws` broadcasts `issue.created` / `issue.updated`; Home, Map and the Authority hub refresh on it.

## API surface

```
GET  /api/health
POST /api/auth/register           POST /api/auth/login           GET /api/auth/me
GET  /api/issues                  GET  /api/issues/{id}          POST /api/issues
POST /api/issues/{id}/vote?kind=up|adopt
POST /api/issues/{id}/comments
GET  /api/leaderboard             GET  /api/proof-wall
GET  /api/authority/queue         GET  /api/authority/kpis
POST /api/authority/issues/{id}/status
POST /api/authority/rainfall-twin
WS   /ws
```

## Still simulated (don't overclaim)

- IoT sensor feeds and the rainfall digital-twin (deterministic formula) are not connected to hardware / trained models.
- OAuth / phone-OTP login paths are not implemented (email + password only).
- No measured accuracy/precision/recall on a labelled CiviTrace dataset — see [AI_AND_HONESTY.md](AI_AND_HONESTY.md) for the full breakdown of what's trained, pretrained, or heuristic.

## Project layout

```
backend/   FastAPI app (main.py), AI pipeline (backend/ai/), auth, payments, requirements, Dockerfile
web/       React 19 + Vite source
frontend/  build output served by FastAPI (git-ignored)
uploads/   stored issue photos (git-ignored)
```

## License

No license has been specified yet — all rights reserved by the author unless a license file is added.
