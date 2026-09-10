# CivicPulse — dev mode: backend :8010 (dual-stack, hot reload) + Vite :5173 (HMR).
# Open http://localhost:5173
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\backend'; python serve.py --reload"
Push-Location "$root\web"
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npm run dev
Pop-Location
