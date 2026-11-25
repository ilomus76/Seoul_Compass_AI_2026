@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Seoul Compass AI 실행 중... http://127.0.0.1:9200
python -m uvicorn backend.main:app --host 127.0.0.1 --port 9200
pause
