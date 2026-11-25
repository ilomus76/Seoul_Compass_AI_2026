"""360도 방향 분석: 거리(Haversine)와 방위각 계산."""
import math

from .config import DIRECTION_COUNT, DIRECTION_NAMES_KO, DIRECTION_NAMES_EN


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 좌표의 직선거리(km). 실제 도보/대중교통 거리가 아니다."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    h = (math.sin(d_lat / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(d_lon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """북을 0도로 하는 시계방향 방위각(0~360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_lon = math.radians(lon2 - lon1)
    x = math.sin(d_lon) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(d_lon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def direction_index(bearing: float) -> int:
    """방위각을 8개 구역(각 45도) 중 하나로 변환한다."""
    return int((bearing + 22.5) // 45) % DIRECTION_COUNT


def get_direction(bearing: float, lang: str = "ko") -> str:
    """방위각의 한글/영문 방향 이름."""
    names = DIRECTION_NAMES_EN if lang == "en" else DIRECTION_NAMES_KO
    return names[direction_index(bearing)]


def analyze_directions(lat: float, lng: float, places: list, lang: str = "ko") -> dict:
    """장소들을 8개 방향 구역으로 나누고 요약한다."""
    sectors = {name: {"count": 0, "places": [], "avg_distance_km": 0.0}
               for name in (DIRECTION_NAMES_EN if lang == "en" else DIRECTION_NAMES_KO)}
    for place in places:
        bearing = calculate_bearing(lat, lng, place["lat"], place["lng"])
        name = get_direction(bearing, lang)
        sector = sectors[name]
        sector["count"] += 1
        sector["places"].append(place["id"])
        dist = place.get("distance_km", haversine(lat, lng, place["lat"], place["lng"]))
        sector["avg_distance_km"] = round(
            (sector["avg_distance_km"] * (sector["count"] - 1) + dist) / sector["count"], 2)
    return {"sectors": sectors, "top_directions":
            sorted(sectors, key=lambda k: sectors[k]["count"], reverse=True)[:3]}
