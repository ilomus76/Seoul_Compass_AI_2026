"""날씨 조회: Open-Meteo(키 불필요) 우선, 실패 시 계절 추정 폴백."""
import json
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Dict


def seasonal(lat: float, month: int) -> Dict:
    """계절 기반 추정값(API 장애 시 사용)."""
    if month in (6, 7, 8):
        temp, condition = 29, "맑음"
    elif month in (4, 5, 9, 10):
        temp, condition = 21, "맑음"
    elif month in (11, 12):
        temp, condition = 8, "흐림"
    else:
        temp, condition = 0, "눈"
    return {"temperature": temp, "condition": condition, "rainy": month in (6, 7, 8),
            "indoor_recommended": month in (6, 7, 8, 11, 12), "source": "계절 추정", "confidence": 0.4,
            "advice": build_advice(temp, month in (6, 7, 8), condition)}


def build_advice(temp: int, rainy: bool, condition: str) -> list:
    """날씨 기준 안내사항(GyuHyeon.md 15번)."""
    items = ["안전사고 주의: 미끄럼·낙하물에 유의하세요."]
    if rainy:
        items.append("우산 또는 우비를 챙기세요.")
    elif temp >= 27:
        items.append("양산과 모자를 준비하고 수분을 충분히 섭취하세요.")
        items.append("수분 섭취: 30분마다 물 한 잔을 권장합니다.")
    if temp <= 10:
        items.append("따뜻한 옷을 챙겨 입으세요.")
    if condition in ("흐림", "눈"):
        items.append("시야가 흐려질 수 있으니 이동 속도를 줄이세요.")
    return items


def get_weather(lat: float, lng: float, date: str | None = None) -> Dict:
    query = urllib.parse.urlencode({
        "latitude": round(lat, 4), "longitude": round(lng, 4),
        "current": "temperature_2m,weather_code,precipitation",
        "timezone": "Asia/Seoul", "forecast_days": 1
    })
    try:
        url = "https://api.open-meteo.com/v1/forecast?" + query
        with urllib.request.urlopen(url, timeout=4) as res:
            raw = json.load(res)
        cur = raw.get("current", {})
        temp = round(float(cur.get("temperature_2m", 20)))
        precip = float(cur.get("precipitation", 0))
        code = int(cur.get("weather_code", 0))
        rainy = precip > 0 or code in (51, 53, 55, 61, 63, 65, 80, 81, 82, 95)
        condition = "비/눈" if rainy else ("흐림" if code in (1, 2, 3, 45, 48) else "맑음")
        return {"temperature": temp, "condition": condition, "rainy": rainy,
                "indoor_recommended": rainy or temp >= 30 or temp <= 3,
                "source": "Open-Meteo", "confidence": 0.9,
                "advice": build_advice(temp, rainy, condition),
                "date": date or datetime.now().strftime("%Y-%m-%d")}
    except Exception:
        month = int((date or datetime.now().strftime("%Y-%m-%d"))[5:7] or datetime.now().month)
        result = seasonal(lat, month)
        result["date"] = date or datetime.now().strftime("%Y-%m-%d")
        return result
