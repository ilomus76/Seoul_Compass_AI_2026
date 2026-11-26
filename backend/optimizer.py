"""경로 최적화: 후보 선정 → Beam Search → 상위 5개 경로."""
from typing import Dict, List

from .direction import calculate_bearing, get_direction, haversine
from .place_clusters import CANDIDATE_POOL_LIMIT, cluster_places
from .places import find_by_keywords, search_places
from .route_corridor import (RECOMMENDATION_FACTORS, corridor_options, direction_rows, point_bearing,
                             recommendation_rank, sector_heading)
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


def reference_rank(beam: dict, activities: list[dict]) -> tuple:
    legs = [(left, right) for activity, left, right in zip(activities[1:], beam['nodes'], beam['nodes'][1:])
            if not activity.get('fixed_location') and activity['category'] not in ('return_to_current', 'return_to_start')]
    same_venue = sum(bool(left['place'].get('event_warning') and left['place'].get('address')
                          and left['place']['address'] == right['place'].get('address')) for left, right in legs)
    overlapping = sum(right['travel_minutes'] == 0 for _, right in legs)
    return (beam['conflicts'], same_venue, overlapping, *recommendation_rank(beam))


def select_reference_directions(beams: list[dict], index: int | None, center: dict,
                                groups: list[list[dict]], activities: list[dict], review: dict | None) -> list[dict]:
    """기준 방문점에서 갈라지는 10° 구역마다 최상위 참고 동선 하나를 선택한다."""
    eligible = [beam for beam in beams if beam['has_visit_warning']]
    if index is None:
        return eligible[:1]
    if review is not None:
        origins = groups[index - 1] if index else []
        base = (origins[0]['representative']['name'] if len(origins) == 1 else '직전 방문점') if index else center.get('name')
        activity = activities[index]
        review.update(kind='reference', base=base, activity=activity.get('request_term') or activity.get('keyword') or activity['category'],
                      rows=direction_rows('missing_clusters'))
        if len(origins) == 1:
            point = origins[0]['center']
            review['land_use_origin'] = {'latitude':point['lat'], 'longitude':point['lng']}
        elif not index:
            review['land_use_origin'] = center
        for origin in origins or [{'center': {'lat':center['latitude'], 'lng':center['longitude']}}]:
            pivot = {'latitude':origin['center']['lat'], 'longitude':origin['center']['lng']}
            for group in groups[index]:
                bearing = point_bearing(pivot, group['center'])
                if bearing is not None:
                    review['rows'][sector_heading(bearing)]['status'] = 'no_combination'
    selected, seen_headings, seen_places = [], set(), set()
    for beam in eligible:
        nodes = beam['nodes']
        pivot = nodes[index - 1]['cluster']['center'] if index else None
        origin = {'latitude': pivot['lat'], 'longitude': pivot['lng']} if pivot else center
        bearing = point_bearing(origin, nodes[index]['cluster']['center'])
        if bearing is None:
            continue
        heading = sector_heading(bearing)
        place = meal_cluster(beam, index)
        if heading in seen_headings:
            continue
        row = review['rows'][heading] if review is not None else {}
        if row.get('status') == 'rank_limit':
            continue
        row.pop('walking_leg', None)
        row.update(place=nodes[index]['place']['name'], distance_km=round(sum(node['distance_km'] for node in nodes), 2),
                   leg_km=nodes[index]['distance_km'], leg_minutes=nodes[index]['travel_minutes'] if index else None)
        if review is not None and index:
            previous, current = nodes[index - 1]['place'], nodes[index]['place']
            if all(p.get('source') in ('kakao', 'sbiz') for p in (previous, current)):
                direct = haversine(previous['lat'], previous['lng'], current['lat'], current['lng'])
                if direct > .001:
                    row['walking_leg'] = {'start': {'lat': previous['lat'], 'lng': previous['lng']},
                                          'end': {'lat': current['lat'], 'lng': current['lng']},
                                          'straight_km': round(direct, 3)}
        if place in seen_places:
            row.update(status='duplicate_cluster')
            continue
        if len(selected) == TOP_N:
            factors = ('일정 충돌 수', '이전 장소와 같은 주소', '겹치는 경유 구간', *RECOMMENDATION_FACTORS)
            candidate = reference_rank(beam, activities)
            cutoff = reference_rank(selected[-1], activities)
            driver = next((factor for factor, a, b in zip(factors, candidate, cutoff) if a != b), None)
            row.update(status='rank_limit', factor=driver)
            continue
        seen_headings.add(heading)
        seen_places.add(place)
        selected.append({**beam, 'reference_heading': heading})
        row.update(status='selected', rank=len(selected))
        if len(selected) == TOP_N and review is None:
            break
    return selected or eligible[:1]


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
                     include_infeasible: bool = False, preview: bool = False,
                     reference: bool = False, direction_review: dict | None = None) -> List[Dict]:
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
        if preview and not reference:
            places = [p for p in places if not p.get('visit_warning')]
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

    if reference:
        # 식사 후보가 여러 군집이면 식사를 기준으로 비교하고, 그 외에는 먼저 갈라지는 활동을 쓴다.
        flexible = [i for i, (activity, groups) in enumerate(zip(activities, candidates_per_activity))
                    if groups and not activity.get('fixed_location')
                    and activity['category'] not in ('return_to_current', 'return_to_start')]
        varying = [i for i in flexible if len(candidates_per_activity[i]) > 1]
        if meal_index in varying:
            reference_index = meal_index
        else:
            reference_index = next(iter(varying or flexible), None)
        beams = search_sequences(candidates_per_activity, activities, start, mode, request, interests,
                                 weights, meal_index=reference_index, include_infeasible=True, preview=preview, reference=True)
        final_beams = select_reference_directions(beams, reference_index, center, candidates_per_activity, activities, direction_review)
    elif contextual:
        def find_courses(groups):
            return search_sequences(groups, activities, start, mode, request, interests, weights,
                                    meal_index=None, include_infeasible=False, preview=preview)
        final_beams = corridor_options(candidates_per_activity, activities, request, find_courses, direction_review)
    else:
        beams = search_sequences(candidates_per_activity, activities, start, mode, request, interests,
                                 weights, meal_index, include_infeasible, preview, candidate_groups is not None)
        final_beams = recommend_distinct_meals(beams, meal_index) if meal_index is not None else beams[:TOP_N]
    return build_routes(final_beams, activities, request, preview, reference)


def search_sequences(groups, activities, start, mode, request, interests, weights,
                     meal_index, include_infeasible, preview, live_candidates=False, reference=False):
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
                    activities[:len(nodes)], {'nodes': nodes, 'departure_time': request.get('departure_time'),
                                               'travel_date': request.get('travel_date')}
                )
                has_visit_warning = any(conflict.get('kind') == 'visit_unavailable' for conflict in timing['conflicts']) if timing else any(
                    node['place'].get('visit_warning') or node['place'].get('event_warning') for node in nodes)
                if not reference and timing and has_visit_warning:
                    continue
                if not include_infeasible and timing and not timing['feasible']:
                    continue
                next_beams.append({
                    "nodes": nodes,
                    "score": route_score(nodes, interests, weights),
                    "last": point,
                    "conflicts": len(timing['conflicts']) if timing else 0,
                    "has_visit_warning": has_visit_warning,
                })
        if reference:
            next_beams.sort(key=lambda beam: reference_rank(beam, activities))
        elif contextual:
            next_beams.sort(key=recommendation_rank)
        elif preview:
            next_beams.sort(key=lambda b: sum(n['distance_km'] for n in b['nodes']))
        elif live_candidates:
            next_beams.sort(key=lambda b: (b['conflicts'], sum(n['travel_minutes'] for n in b['nodes']),
                                          sum(n['distance_km'] for n in b['nodes'])))
        else:
            next_beams.sort(key=lambda b: b["score"], reverse=True)
        if reference and meal_index is not None and activity_index >= meal_index:
            beams = keep_meal_alternatives(next_beams, meal_index)
        elif contextual and activity_index < len(groups) - 1:
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


def build_routes(final_beams, activities, request, preview, reference=False):
    routes = []
    for beam in final_beams:
        route = {
            'departure_time': request.get('departure_time'),
            'travel_date': request.get('travel_date'),
            "nodes": [dict(node) for node in beam['nodes']],
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
        if reference:
            route['reference'] = True
            if 'reference_heading' in beam:
                heading = beam['reference_heading']
                route.update(reference_heading=heading, reference_direction=get_direction(heading))
        timeline = (route['schedule'] or {}).get('timeline', [])
        for index, node in enumerate(route['nodes']):
            warning = timeline[index]['visit_warning'] if timeline else (node['place'].get('visit_warning') or node['place'].get('event_warning'))
            if warning:
                node['place'] = {**node['place'], 'visit_warning': warning}
            elif node['place'].get('visit_warning'):
                node['place'] = {key: value for key, value in node['place'].items() if key != 'visit_warning'}
        routes.append(route)
    return routes
