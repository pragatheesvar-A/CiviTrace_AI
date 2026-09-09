# CivicPulse — dev mode: backend on :8010, Vite dev server (HMR) on :5173.
# Open http://localhost:5173
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\backend'; uvicorn main:app --reload --port 8010"
Push-Location "$root\web"
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npm run dev
Pop-Location
