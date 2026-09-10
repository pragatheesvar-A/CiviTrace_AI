# CivicPulse — one command: build the React app, then serve everything from FastAPI.
# Open http://localhost:8010
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==> Backend deps" -ForegroundColor Cyan
pip install -q -r "$root\backend\requirements.txt"

Write-Host "==> Fetching AI model weights (first run only)" -ForegroundColor Cyan
python "$root\backend\scripts\fetch_models.py"

Write-Host "==> Building frontend" -ForegroundColor Cyan
Push-Location "$root\web"
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npm run build
Pop-Location

Write-Host "==> CivicPulse on http://localhost:8010" -ForegroundColor Green
Push-Location "$root\backend"
python serve.py
Pop-Location
