"""자연어 요구사항 분석 (규칙 기반).

LLM API 키가 없어도 동작하며, 활동과 시간을 구조화된 JSON으로 만든다.
실제 LLM을 연결할 때는 이 모듈만 교체하면 된다.
"""
import re
from typing import Dict, List

# 키워드 → 활동 카테고리 매핑 (확장 가능한 구조)
KEYWORD_RULES = [
    ("hiking", ["등산", "산행", "관악산", "북한산", "hiking"]),
    ("shower", ["샤워", "목욕", "찜질방", "shower"]),
    ("meeting", ["만나", "약속", "미팅", "meeting"]),
    ("restaurant", ["고등어", "회", "술", "식사", "먹", "맛집", "restaurant"]),
    ("bowling", ["볼링", "bowling"]),
    ("international_tourism_area", ["외국인", "국제", "이태원", "관광객"]),
    ("subway_station", ["지하철역", "지하철", "역으로", "subway"]),
    ("return_home", ["귀가", "집으로", "집에", "home"]),
    ("shopping", ["쇼핑", "명동", "백화점", "shopping"]),
    ("cafe", ["카페", "커피", "cafe"]),
    ("night_view", ["야경", "전망", "night view"]),
    ("culture", ["박물관", "미술관", "궁궐", "한옥"]),
    ("park", ["공원", "한강", "산책", "park"]),
]


def extract_times(text: str) -> List[Dict]:
    """질문에서 시간 표현을 순서대로 추출한다."""
    pattern = re.compile(r"(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*[:시]?\s*(\d{2})?\s*(?:분|시)?")
    result = []
    for m in pattern.finditer(text):
        prefix, hour, minute = m.group(1), int(m.group(2)), m.group(3)
        if hour > 23:
            continue
        if prefix in ("오후", "저녁", "밤") and hour < 12:
            hour += 12
        value = f"{hour:02d}:{int(minute) if minute else 0:02d}"
        result.append({"time": value, "position": m.start(), "raw": m.group(0).strip()})
    # 같은 시간이 중복 추출되면 앞것만 유지
    seen, unique = set(), []
    for t in result:
        if t["time"] not in seen:
            seen.add(t["time"])
            unique.append(t)
    return unique


def parse_user_request(text: str) -> Dict:
    """질문을 AGENTS.md 4.2 형태의 구조화된 dict로 변환한다."""
    times = extract_times(text)
    activities = []
    fixed_categories = {"hiking", "meeting", "bowling", "subway_station"}

    for category, keywords in KEYWORD_RULES:
        positions = [text.find(k) for k in keywords if k in text]
        if not positions:
            continue
        position = min(positions)
        matched = next(k for k in keywords if k in text)
        # 활동 키워드보다 앞에 나온 시간만 사용한다(뒤의 시간을 끌어오지 않는다).
        earlier = [t for t in times if t["position"] < position]
        last_time = earlier[-1]["time"] if earlier else None
        next_time = next((t["time"] for t in times if t["position"] >= position), None)

        activity = {
            "id": len(activities) + 1,
            "category": category,
            "keyword": matched,
            "keywords": [k for k in keywords if k in text],
            "start_time": None,
            "earliest_start": None,
            "latest_end": None,
            "preferred_time": None,
            "fixed_time": False,
            "fixed_location": category in ("meeting", "subway_station"),
            "required": True,
            "duration_minutes": 60,
        }
        if category in fixed_categories:
            activity["start_time"] = last_time
            activity["fixed_time"] = last_time is not None
        elif category == "shower":
            activity["earliest_start"] = last_time
            activity["latest_end"] = next_time  # 약속 전에 끝나야 함
        else:
            activity["preferred_time"] = last_time
        if category == "meeting":
            station = re.search(r"([\w가-힣]+역)", text)
            activity["location"] = station.group(1) if station else None
        activities.append(activity)

    warnings = []
    if not re.search(r"20\d\d-\d\d-\d\d|\d월\s*\d일|오늘|내일", text):
        warnings.append("여행 날짜가 지정되지 않아 날짜 정보는 null입니다.")
    if not any(k in text for k in ["집으로", "귀가", "집에"]):
        warnings.append("귀가 목적지가 지정되지 않아 확인이 필요합니다.")

    return {
        "start_location": {"type": "current_location", "latitude": None, "longitude": None},
        "travel_date": None,
        "radius_km": 5.0,
        "transport_modes": ["walking", "bus", "subway"],
        "activities": activities,
        "warnings": warnings,
    }
