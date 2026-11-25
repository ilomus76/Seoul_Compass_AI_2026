# Seoul Compass AI 웹 실행 스크립트 (PowerShell)
# 사용법: .\run.ps1  →  http://127.0.0.1:9200
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Seoul Compass AI 실행 중... http://127.0.0.1:9200" -ForegroundColor Green
python -m uvicorn backend.main:app --host 127.0.0.1 --port 9200
