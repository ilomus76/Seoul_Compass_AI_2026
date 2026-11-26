"""경로 최적화: 후보 선정 → Beam Search → 상위 5개 경로."""
from typing import Dict, List

from .direction import calculate_bearing, get_direction, haversine
from .place_clusters import CANDIDATE_POOL_LIMIT, cluster_places
from .places import find_by_keywords, search_places
from .route_corridor import corridor_options, recommendation_rank
from .schedule import travel_minutes, validate_schedule
from .scoring import normalize_weights, score_place

BEAM_WIDTH = 5
TOP_N = 5


def meal_cluster(beam: Dict, meal_index: int) -> str:
    """군집의 실제 대표 장소 ID로 식사 대안을 구분한다."""
    return beam['nodes'][meal_index]['place']['id']


def keep_meal_alternatives(beams: List[Dict], meal_index: int) -> List[Dict]:
    """식사 다음 단계에서도 다른 군집 경로가 너무 일찍 탈락하지 않게 한다."""
    counts = {}
    kept = []
    for beam in beams:
        key = meal_cluster(beam, meal_index)
        if counts.get(key, 0) < BEAM_WIDTH:
            counts[key] = counts.get(key, 0) + 1
            kept.append(beam)
    return kept


def recommend_distinct_meals(beams: List[Dict], meal_index: int) -> List[Dict]:
    """일정 충돌이 같은 경로끼리 비교할 때 다른 식사 군집의 최상위 동선을 먼저 제공한다."""
    selected = []
    for conflict_count in sorted({beam['conflicts'] for beam in beams}):
        seen = set()
        alternates, repeats = [], []
        for beam in beams:
            if beam['conflicts'] != conflict_count:
                continue
            key = meal_cluster(beam, meal_index)
            if key in seen:
                repeats.append(beam)
            else:
                seen.add(key)
                alternates.append(beam)
        selected.extend(alternates + repeats)
        if len(selected) >= TOP_N:
            break
    return selected[:TOP_N]


def route_score(nodes: List[Dict], interests: List[str], weights: Dict) -> float:
    """R = 0.35U + 0.25T + 0.20C + 0.20Q"""
    if not nodes:
        return 0.0
    satisfaction = sum(n.get("score", 0) for n in nodes) / len(nodes)
    minutes = sum(n.get("travel_minutes", 0) for n in nodes)
    cost = sum(n.get("place", {}).get("fee_krw") or 0 for n in nodes)
    time_eff = max(0.0, 100 - minutes / 6)
    cost_eff = max(0.0, 100 - cost / 500)
    quality = sum(n.get("place", {}).get("confidence", 0) * 100 for n in nodes) / len(nodes)
    return round(0.35 * satisfaction + 0.25 * time_eff + 0.20 * cost_eff + 0.20 * quality, 1)


def recommend_routes(request: Dict, candidate_groups: List[List[Dict]] | None = None,
                     include_infeasible: bool = False, preview: bool = False) -> List[Dict]:
    """장소 조합을 중복 없이 골라 활동 순서를 유지한다."""
    start = request.get("start_location", {})
    center = request.get('search_center') or start
    lat, lng = center.get('latitude'), center.get('longitude')
    if any(value is None for value in (lat, lng, start.get('latitude'), start.get('longitude'))):
        raise ValueError('검색 기준점과 출발지의 좌표가 필요합니다.')
    radius = float(request.get("radius_km") or 5.0)
    activities = request.get("activities", [])
    contextual = request.get('contextual', False)
    meal_index = next((i for i, act in enumerate(activities)
                       if act['category'] == 'restaurant' and not act.get('fixed_location')), None)
    weights = normalize_weights(request.get("weights"))
    modes = request.get("transport_modes") or ["walking"]
    mode = modes[0]
    interests = []
    for act in activities:
        interests += act.get("keywords", [])
        if act.get("keyword"):
            interests.append(act["keyword"])

    # 넓게 조회한 후보를 먼저 군집으로 묶은 뒤 활동별 우수 군집을 최대 5개 비교한다.
    candidates_per_activity = []
    for activity_index, act in enumerate(activities):
        if candidate_groups is not None:
            places = candidate_groups[activity_index]
        else:
            words = act.get("keywords", []) + [act.get("category", "")]
            places = find_by_keywords(words, lat, lng, radius, limit=CANDIDATE_POOL_LIMIT)
            by_category = search_places(lat, lng, radius, category=act.get("category"), limit=CANDIDATE_POOL_LIMIT)
            merged = {p["id"]: p for p in [*places, *by_category]}
            places = sorted(merged.values(), key=lambda p: p["distance_km"])[:CANDIDATE_POOL_LIMIT]
        if not contextual and not places and act.get("location"):
            places = search_places(lat, lng, radius, keyword=act["location"], limit=BEAM_WIDTH)
        if act.get('required_keywords'):
            places = [p for p in places if all(
                word.replace('순댓국', '순대국') in (' '.join([p['name'], *p.get('keywords', [])])).replace('순댓국', '순대국')
                for word in act['required_keywords'])]
        if act.get('category') == 'swimming':
            places = [p for p in places if p['category'] == 'swimming']
        places = list({p["id"]: p for p in places}.values())
        # 방향 탐색 확장은 선택 반경 안에서만 수행한다. 반경을 임의로 늘리지 않는다.
        scored = []
        for place in places:
            bearing = calculate_bearing(lat, lng, place["lat"], place["lng"])
            row = dict(place)
            row["direction"] = get_direction(bearing)
            row["bearing"] = round(bearing, 1)
            if candidate_groups is not None:
                # 실제 제공되지 않은 평점·가격·영업시간을 가산점으로 만들지 않는다.
                row['score'] = round(max(0, 100 * (1 - float(row.get('distance_km', 0)) / radius)), 1)
            else:
                row["score"] = score_place(row, interests, radius, weights)
            scored.append(row)
        if act.get('fixed_location') and act.get('location'):
            # 고정 장소의 좌표는 주변 후보와 평균 내지 않는다.
            named = act['location'].replace(' ', '')
            exact = [place for place in scored if named in place['name'].replace(' ', '')]
            clusters = cluster_places(exact[:1])
        else:
            clusters = cluster_places(scored)
        # 동일한 활동에서 가까운 대안이 한 군집이면 방문점도 하나만 사용한다.
        clusters.sort(key=lambda group: haversine(lat, lng, group['center']['lat'], group['center']['lng']))
        candidates_per_activity.append(clusters if contextual else clusters[:BEAM_WIDTH])

    if contextual:
        def find_courses(groups):
            return search_sequences(groups, activities, start, mode, request, interests, weights,
                                    meal_index=None, include_infeasible=False, preview=preview)
        final_beams = corridor_options(candidates_per_activity, activities, request, find_courses)
    else:
        beams = search_sequences(candidates_per_activity, activities, start, mode, request, interests,
                                 weights, meal_index, include_infeasible, preview, candidate_groups is not None)
        final_beams = recommend_distinct_meals(beams, meal_index) if meal_index is not None else beams[:TOP_N]
    return build_routes(final_beams, activities, request, preview)


def search_sequences(groups, activities, start, mode, request, interests, weights,
                     meal_index, include_infeasible, preview, live_candidates=False):
    """각 시간 단계에서 다음 군집으로 이어질 상위 경로 조합을 유지한다."""
    beams: List[Dict] = [{"nodes": [], "score": 0.0,
                         "last": {"lat": start['latitude'], "lng": start['longitude']}}]
    if not groups:
        return []
    contextual = request.get('contextual', False)
    for activity_index, options in enumerate(groups):
        next_beams = []
        for beam in beams:
            for group in options:
                place = group['representative']
                point = group['center']
                distance = haversine(beam["last"]["lat"], beam["last"]["lng"],
                                     point["lat"], point["lng"])
                if preview and activity_index == 0:
                    distance = 0
                node = {
                    "place": place,
                    "request_term": activities[activity_index].get('request_term') or activities[activity_index].get('keyword'),
                    "cluster": {key: value for key, value in group.items() if key != 'representative'},
                    "distance_km": round(distance, 2),
                    "travel_minutes": travel_minutes(distance, mode) if distance > .001 else 0,
                }
                nodes = beam["nodes"] + [node]
                timing = None if preview else validate_schedule(
                    activities[:len(nodes)], {'nodes': nodes, 'departure_time': request.get('departure_time')}
                )
                if not include_infeasible and timing and not timing['feasible']:
                    continue
                next_beams.append({
                    "nodes": nodes,
                    "score": route_score(nodes, interests, weights),
                    "last": point,
                    "conflicts": len(timing['conflicts']) if timing else 0,
                })
        if contextual:
            next_beams.sort(key=recommendation_rank)
        elif preview:
            next_beams.sort(key=lambda b: sum(n['distance_km'] for n in b['nodes']))
        elif live_candidates:
            next_beams.sort(key=lambda b: (b['conflicts'], sum(n['travel_minutes'] for n in b['nodes']),
                                          sum(n['distance_km'] for n in b['nodes'])))
        else:
            next_beams.sort(key=lambda b: b["score"], reverse=True)
        if contextual and activity_index < len(groups) - 1:
            counts = {}
            beams = []
            for beam in next_beams:
                key = beam['nodes'][-1]['place']['id']
                if counts.get(key, 0) < BEAM_WIDTH:
                    counts[key] = counts.get(key, 0) + 1
                    beams.append(beam)
        elif meal_index is not None and activity_index >= meal_index:
            beams = keep_meal_alternatives(next_beams, meal_index)
        else:
            beams = next_beams[:BEAM_WIDTH]

    return beams


def build_routes(final_beams, activities, request, preview):
    routes = []
    for beam in final_beams:
        route = {
            'departure_time': request.get('departure_time'),
            "nodes": beam["nodes"],
            "score": beam["score"],
            "total_distance_km": round(sum(n["distance_km"] for n in beam["nodes"]), 2),
            "total_travel_minutes": sum(n["travel_minutes"] for n in beam["nodes"]),
            "estimated_cost_krw": sum(n["place"].get("fee_krw") or 0 for n in beam["nodes"]),
            "direction": beam["nodes"][0]["place"]["direction"],
            "data_confidence": round(
                sum(n["place"].get("confidence", 0) for n in beam["nodes"])
                / max(1, len(beam["nodes"])), 2),
        }
        if beam.get('corridor'):
            route['corridor'] = beam['corridor']
        if preview:
            route.update(preview=True, schedule=None, departure_time=None, total_travel_minutes=None)
            route['nodes'] = [{**node, 'travel_minutes': None} for node in route['nodes']]
        else:
            route["schedule"] = validate_schedule(activities, route)
        routes.append(route)
    return routes
