"""경로 최적화: 후보 선정 → Beam Search → TOP 3 경로 (AGENTS.md 9장)."""
from typing import Dict, List

from .direction import calculate_bearing, get_direction, haversine
from .places import find_by_keywords, search_places
from .schedule import travel_minutes, validate_schedule
from .scoring import normalize_weights, score_place

BEAM_WIDTH = 5
TOP_N = 3


def route_score(nodes: List[Dict], interests: List[str], weights: Dict) -> float:
    """R = 0.35U + 0.25T + 0.20C + 0.20Q"""
    if not nodes:
        return 0.0
    satisfaction = sum(n.get("score", 0) for n in nodes) / len(nodes)
    minutes = sum(n.get("travel_minutes", 0) for n in nodes)
    cost = sum(n.get("place", {}).get("fee_krw", 0) for n in nodes)
    time_eff = max(0.0, 100 - minutes / 6)
    cost_eff = max(0.0, 100 - cost / 500)
    quality = sum(n.get("place", {}).get("confidence", 0) * 100 for n in nodes) / len(nodes)
    return round(0.35 * satisfaction + 0.25 * time_eff + 0.20 * cost_eff + 0.20 * quality, 1)


def recommend_routes(request: Dict) -> List[Dict]:
    """활동 순서를 유지하며 상위 3개 경로를 반환한다."""
    start = request.get("start_location", {})
    lat = start.get("latitude") or 37.5665
    lng = start.get("longitude") or 126.9780
    radius = float(request.get("radius_km") or 5.0)
    activities = request.get("activities", [])
    weights = normalize_weights(request.get("weights"))
    modes = request.get("transport_modes") or ["walking"]
    mode = modes[0]
    interests = []
    for act in activities:
        interests += act.get("keywords", [])
        if act.get("keyword"):
            interests.append(act["keyword"])

    # 활동별 후보 장소(최대 5개). 없으면 존재하지 않는 장소를 만들지 않는다.
    candidates_per_activity = []
    for act in activities:
        words = act.get("keywords", []) + [act.get("category", "")]
        places = find_by_keywords(words, lat, lng, radius, limit=BEAM_WIDTH)
        # 업종(category)으로도 검색해 다국어 키워드 누락을 보완한다.
        by_category = search_places(lat, lng, radius, category=act.get("category"), limit=BEAM_WIDTH)
        merged = {p["id"]: p for p in places}
        for p in by_category:
            merged.setdefault(p["id"], p)
        places = sorted(merged.values(), key=lambda p: p["distance_km"])[:BEAM_WIDTH]
        if not places and act.get("location"):
            places = search_places(lat, lng, radius, keyword=act["location"], limit=BEAM_WIDTH)
        # AGENTS.md 9.4: 필수 활동 후보가 없으면 탐색 반경을 확장한다.
        # 존재하지 않는 장소를 새로 만들지 않고 실제 데이터만 사용한다.
        if not places and act.get("required", True):
            for expanded in (radius * 2, radius * 4, 20.0):
                places = find_by_keywords(words, lat, lng, expanded, limit=BEAM_WIDTH)
                if places:
                    break
        scored = []
        for place in places:
            bearing = calculate_bearing(lat, lng, place["lat"], place["lng"])
            row = dict(place)
            row["direction"] = get_direction(bearing)
            row["bearing"] = round(bearing, 1)
            row["score"] = score_place(row, interests, radius, weights)
            scored.append(row)
        candidates_per_activity.append(scored)

    # Beam Search: 앞 활동의 후보와 거리·점수를 조합해 상위 후보만 유지
    beams: List[Dict] = [{"nodes": [], "score": 0.0, "last": {"lat": lat, "lng": lng}}]
    for options in candidates_per_activity:
        next_beams = []
        for beam in beams:
            for place in options:
                distance = haversine(beam["last"]["lat"], beam["last"]["lng"],
                                     place["lat"], place["lng"])
                node = {
                    "place": place,
                    "distance_km": round(distance, 2),
                    "travel_minutes": travel_minutes(distance, mode),
                }
                nodes = beam["nodes"] + [node]
                next_beams.append({
                    "nodes": nodes,
                    "score": route_score(nodes, interests, weights),
                    "last": place,
                })
        next_beams.sort(key=lambda b: b["score"], reverse=True)
        beams = next_beams[:BEAM_WIDTH]

    routes = []
    for beam in beams[:TOP_N]:
        route = {
            "nodes": beam["nodes"],
            "score": beam["score"],
            "total_distance_km": round(sum(n["distance_km"] for n in beam["nodes"]), 2),
            "total_travel_minutes": sum(n["travel_minutes"] for n in beam["nodes"]),
            "estimated_cost_krw": sum(n["place"].get("fee_krw", 0) for n in beam["nodes"]),
            "direction": beam["nodes"][0]["place"]["direction"],
            "data_confidence": round(
                sum(n["place"].get("confidence", 0) for n in beam["nodes"])
                / max(1, len(beam["nodes"])), 2),
        }
        route["schedule"] = validate_schedule(activities, route)
        routes.append(route)
    return routes
