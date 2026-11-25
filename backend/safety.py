"""안전사고 예방 지침과 위급 상황 도움 지점."""
from typing import Dict, List

from .places import search_places

GUIDES: List[Dict] = [
    {"category": "hiking", "title": "등산 안전 지침",
     "items": ["일몰 2시간 전 하산 시작", "왕복 시간의 절반 시점에 원위치 복귀 알람", "8829 산악안전신고"],
     "emergency": "112 / 119 / 8829"},
    {"category": "bowling", "title": "체육시설 안전 지침",
     "items": ["준비운동 후 이용", "무거운 볼은 양손으로 운반", "미끄러운 바닥 주의"], "emergency": "119"},
    {"category": "night_view", "title": "야간 이동 안전 지침",
     "items": ["인적이 드문 골목 피하기", "가까운 지하철역·경찰서 위치 확인", "휴대폰 배터리 확인"], "emergency": "112"},
    {"category": "moving", "title": "이동 안전 지침",
     "items": ["횡단보도 이용", "자전거도로에서 보행 주의", "교통카드·현금 준비"], "emergency": "112"},
]


def safety_guide(category: str) -> Dict:
    for guide in GUIDES:
        if guide["category"] == category:
            return guide
    return GUIDES[-1]


RISK_ZONES = [
    {"id":"r1","name":"관악산 급경사 구간","type":"급경사","lat":37.4765,"lng":126.9480,"level":"높음","note":"미끄럼 주의, 로프 구간 이용"},
    {"id":"r2","name":"신림역 공사 구간","type":"공사","lat":37.4775,"lng":126.9545,"level":"보통","note":"우회로 이용 권장"},
    {"id":"r3","name":"야간 골목 어두운 구간","type":"야간","lat":37.4802,"lng":126.9500,"level":"보통","note":"동행 또는 밝은 길 이용"},
    {"id":"r4","name":"자전거도로 교차 지점","type":"교차로","lat":37.4760,"lng":126.9520,"level":"낮음","note":"좌우 확인 후 통과"},
]


def risk_zones(lat: float, lng: float, radius_km: float = 5.0) -> Dict:
    """주변 사고 발생위치·위험구역 목업 데이터."""
    from .direction import haversine
    items = []
    for z in RISK_ZONES:
        d = haversine(lat, lng, z["lat"], z["lng"])
        if d <= radius_km:
            items.append({**z, "distance_km": round(d, 2)})
    items.sort(key=lambda x: x["distance_km"])
    return {"zones": items, "count": len(items),
            "note": "데모용 예시 데이터이며 실제 사고 통계가 아닙니다."}


def nearby_help(lat: float, lng: float, radius_km: float = 5.0) -> Dict:
    police = search_places(lat, lng, radius_km, category="police_station", limit=3)
    fire = search_places(lat, lng, radius_km, category="fire_station", limit=3)
    return {"police": police, "fire": fire,
            "numbers": {"경찰": "112", "소방/구급": "119", "산악안전": "8829"},
            "note": "실제 신고는 전화 앱으로 연결되며, 이 데모는 위치 안내만 제공합니다."}
