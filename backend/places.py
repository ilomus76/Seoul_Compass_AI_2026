"""장소 데이터 로딩과 검색.

샘플 JSON을 사용하며, 외부 API를 쓰지 않을 때도 동작한다.
"""
import json
from typing import Dict, List

from .config import PLACES_PATH
from .direction import haversine

_cache: List[Dict] | None = None


def load_places() -> List[Dict]:
    """샘플 장소 JSON을 읽어 캐시한다."""
    global _cache
    if _cache is None:
        with open(PLACES_PATH, "r", encoding="utf-8") as f:
            _cache = json.load(f)["places"]
    return _cache


def search_places(lat: float, lng: float, radius_km: float,
                  category: str | None = None, keyword: str | None = None,
                  limit: int = 5) -> List[Dict]:
    """출발지 반경 안의 장소를 카테고리/키워드로 검색한다."""
    found = []
    kw = (keyword or "").strip().lower()
    for place in load_places():
        distance = haversine(lat, lng, place["lat"], place["lng"])
        if distance > radius_km:
            continue
        if category and place["category"] != category:
            continue
        if kw:
            hay = " ".join([place["name"], place.get("name_en", ""),
                            *place.get("keywords", [])]).lower()
            if kw not in hay:
                continue
        row = dict(place)
        row["distance_km"] = round(distance, 2)
        found.append(row)
    found.sort(key=lambda p: p["distance_km"])
    return found[:limit]


def find_by_keywords(keywords: List[str], lat: float, lng: float,
                     radius_km: float, limit: int = 5) -> List[Dict]:
    """여러 키워드 중 하나라도 일치하는 장소를 찾는다."""
    result: Dict[str, Dict] = {}
    for word in keywords:
        for place in search_places(lat, lng, radius_km, keyword=word, limit=limit):
            result[place["id"]] = place
    return sorted(result.values(), key=lambda p: p["distance_km"])[:limit]
