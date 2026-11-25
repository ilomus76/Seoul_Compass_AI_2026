"""설정: 환경변수와 기본값을 한 곳에서 관리한다."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
FRONTEND_DIR = ROOT / "frontend"
DB_PATH = DATA_DIR / "travel.db"
PLACES_PATH = DATA_DIR / "sample_places.json"

# 다른 프로젝트와 포트가 겹치지 않도록 9200을 기본값으로 사용한다.
PORT = int(os.getenv("PORT", "9200"))
HOST = os.getenv("HOST", "127.0.0.1")

# 외부 API 키는 소스에 하드코딩하지 않고 환경변수로만 읽는다.
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

# 검색 기본값 (AGENTS.md 5.2)
DEFAULT_RADIUS_KM = 5.0
RADIUS_OPTIONS_KM = [1.0, 3.0, 5.0, 10.0]
DIRECTION_COUNT = 8
DIRECTION_NAMES_KO = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"]
DIRECTION_NAMES_EN = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
