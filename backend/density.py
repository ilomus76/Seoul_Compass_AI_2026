"""시간별 플랜 장소와 전체 지역 장소의 연관 분석 및 밀집도 계산."""
from typing import Dict, List

from .direction import calculate_bearing, get_direction, haversine
from .places import load_places
from .scoring import score_place


def analyze_density(lat: float, lng: float, activities: List[Dict], radius_km: float = 5.0) -> Dict:
    """활동별로 주변 장소를 모아 방향 구역별 밀집도를 계산한다."""
    places = load_places()
    results = []
    for act in activities:
        words = [w.lower() for w in act.get("keywords", [])]
        nearby = []
        for place in places:
            distance = haversine(lat, lng, place["lat"], place["lng"])
            if distance > radius_km:
                continue
            hay = " ".join([place.get("category", ""), *place.get("keywords", [])]).lower()
            score = score_place({**place, "distance_km": distance}, words, radius_km)
            if any(w in hay for w in words) or score > 45:
                bearing = calculate_bearing(lat, lng, place["lat"], place["lng"])
                nearby.append({"id": place["id"], "name": place["name"], "category": place["category"],
                               "distance_km": round(distance, 2), "score": score,
                               "direction": get_direction(bearing), "crowd": place.get("crowd_by_hour", {})})
        nearby.sort(key=lambda p: p["score"], reverse=True)
        clusters: Dict[str, List[Dict]] = {}
        for p in nearby:
            clusters.setdefault(p["direction"], []).append(p)
        ranked = sorted(clusters.items(), key=lambda kv: len(kv[1]), reverse=True)
        results.append({
            "activity_id": act.get("id"), "category": act.get("category"),
            "time": act.get("start_time") or act.get("preferred_time"),
            "total_places": len(nearby),
            "clusters": [{"direction": name, "count": len(items),
                          "avg_score": round(sum(i["score"] for i in items) / len(items), 1),
                          "places": items[:5]} for name, items in ranked],
            "top_places": nearby[:5]
        })
    return {"sectors": results, "note": "직선거리 기반 밀집도이며 실제 교통 상황과 다를 수 있습니다."}
