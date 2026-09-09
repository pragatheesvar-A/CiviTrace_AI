# CivicPulse — one-command local run (Windows PowerShell)
# Builds the React frontend, then starts the FastAPI backend which serves it.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==> Installing backend deps" -ForegroundColor Cyan
pip install -q -r "$root\backend\requirements.txt"

Write-Host "==> Building frontend" -ForegroundColor Cyan
Push-Location "$root\web"
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npm run build
Pop-Location

Write-Host "==> Starting CivicPulse on http://localhost:8010" -ForegroundColor Green
Push-Location "$root\backend"
uvicorn main:app --host 0.0.0.0 --port 8010
Pop-Location
