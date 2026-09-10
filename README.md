# CiviTrace AI — AI-Assisted Civic Issue Reporting & Resolution

Full-stack, end-to-end working build: **React 19 + Vite** frontend, **FastAPI + SQLAlchemy (async) + SQLite** backend, JWT auth with server-enforced roles, a two-stage AI verification pipeline, proximity deduplication, priority scoring, a community layer, an authority triage hub, and a WebSocket live feed.

## Run it

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

### Manual
```bash
pip install -r backend/requirements.txt
cd web && npm install && npm run build        # emits ../frontend
cd ../backend && uvicorn main:app --port 8010
```

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
  - **Honest note:** the vision stages are a deterministic heuristic stand-in for the CLIP + YOLOv8 models in the product write-up — the two-stage gate, the API contract, and all downstream priority logic are real.
- **Deduplication** — new reports within 60 m of an open same-category issue join its cluster; `cluster_count` feeds the priority score and grows the map marker.
- **Priority** — computed from verification signal + detections + upvotes + cluster size (`compute_priority`).
- **Community** — upvote / adopt toggle, threaded comments, civic points (report +15, comment +3, your report upvoted +1, your report resolved +10), `/api/leaderboard`, `/api/proof-wall` (before/after).
- **Authority hub** — priority-sorted triage queue, KPI dashboard computed from real data (open/resolved, resolution rate, **real** avg resolution days, verified share, category & priority breakdowns), status transitions, and a rainfall **digital-twin** endpoint (deterministic formula — labeled as such, not an ML model).
- **Live feed** — `ws://…/ws` broadcasts `issue.created` / `issue.updated`; Home, Map and the Authority hub refresh on it.

## API surface

`GET /api/health` · `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`
`GET /api/issues` · `GET /api/issues/{id}` · `POST /api/issues`
`POST /api/issues/{id}/vote?kind=up|adopt` · `POST /api/issues/{id}/comments`
`GET /api/leaderboard` · `GET /api/proof-wall`
`GET /api/authority/queue` · `GET /api/authority/kpis` · `POST /api/authority/issues/{id}/status` · `POST /api/authority/rainfall-twin`
`WS /ws`

Interactive docs at **http://localhost:8010/docs**.

## Still simulated (don't overclaim)

- Vision verification = deterministic heuristic, not the trained CLIP + YOLOv8 pipeline.
- IoT sensor feeds and the rainfall digital-twin (deterministic formula) are not connected to hardware / trained models.
- OAuth / phone-OTP login paths are not implemented (email + password only).

## Layout

```
backend/   FastAPI app (main.py), requirements, Dockerfile
web/       React 19 + Vite source
frontend/  build output served by FastAPI (git-ignored)
uploads/   stored issue photos (git-ignored)
```
