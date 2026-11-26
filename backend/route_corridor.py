"""활동 군집 중심을 출발지 기준 방위각으로 비교한다."""
from typing import Callable

from .direction import calculate_bearing, haversine

HEADINGS = tuple(range(0, 360, 10))
HALF_SECTOR = 5
RECOMMENDATION_FACTORS = ('요청 메뉴 일치', '장소의 세부 조건', '유사 업소 공개 메뉴 관련도',
                          '추정 이동시간', '직선 연결 거리', '방향 범위')


def point_bearing(start: dict, point: dict) -> float | None:
    """출발점 군집은 방향이 불안정하므로 부채꼴 조건에서 제외한다."""
    coordinates = (start['latitude'], start['longitude'], point['lat'], point['lng'])
    return calculate_bearing(*coordinates) if haversine(*coordinates) > .05 else None


def sector_heading(bearing: float) -> int:
    """방위각을 겹치지 않는 폭 10° 구역 하나에 배정한다."""
    return int((bearing + HALF_SECTOR) // 10 * 10) % 360


def direction_rows(status: str) -> dict[int, dict]:
    return {heading: {'heading': heading, 'status': status} for heading in HEADINGS}


def corridor_options(groups: list[list[dict]], activities: list[dict], request: dict,
                     find_courses: Callable, review: dict | None = None) -> list[dict]:
    start = request['start_location']
    direction_center = request.get('direction_center')
    goal = request.get('route_goal')
    requested = request.get('requested_bearing')
    goal_axis = point_bearing(start, {'lat': goal['latitude'], 'lng': goal['longitude']}) if (
        not direction_center and goal and goal.get('latitude') is not None and goal.get('longitude') is not None) else None
    bearing_groups = []
    for activity, options in zip(activities, groups):
        fixed_segment = (activity['category'] in ('return_to_start', 'return_to_current') or
                         direction_center and activity['id'] != request.get('direction_activity_id'))
        bearing_groups.append([(group, None if bearing is None else sector_heading(bearing))
                               for group in options
                               for bearing in [None if fixed_segment else point_bearing(direction_center or start, group['center'])]])
    goal_sector = sector_heading(goal_axis) if goal_axis is not None else None
    headings = HEADINGS if requested is None else (sector_heading(requested),)
    if review is not None:
        review.update(kind='recommendation', rows=direction_rows('not_requested'))
    results = []
    for heading in headings:
        row = review['rows'][heading] if review is not None else {}
        row['status'] = 'goal_direction'
        core = (heading,)
        adjacent = ((heading - 10) % 360, heading, (heading + 10) % 360)
        for allowed in (core, adjacent):
            if goal_sector is not None and goal_sector not in allowed:
                continue
            scoped = [[group for group, sector in options if sector is None or sector in allowed]
                      for options in bearing_groups]
            if not scoped or not all(scoped):
                if row['status'] != 'schedule':
                    row.update(status='missing_clusters', missing=[a.get('request_term') or a.get('keyword') or a['category']
                                                                  for a, options in zip(activities, scoped) if not options])
                continue
            beams = find_courses(scoped)
            if beams:
                row.update(status='candidate', missing=[])
                pooled = len(allowed) > 1
                results.append({**beams[0], 'corridor': {
                    'heading': heading, 'variant': 'adjacent' if pooled else 'primary',
                    'left_degrees': 15 if pooled else 5, 'right_degrees': 15 if pooled else 5,
                    'sectors': list(allowed),
                }})
                break
            row.update(status='schedule', missing=[])
    return results


def recommendation_rank(route: dict) -> tuple:
    nodes = route['nodes']
    return (-sum(node['place'].get('menu_status') == 'matched' for node in nodes),
            sum(bool(node['place'].get('venue_condition_unconfirmed')) for node in nodes),
            -sum((node['place'].get('menu_model') or {}).get('relatedness', 0) for node in nodes),
            sum(node.get('travel_minutes') or 0 for node in nodes),
            sum(node['distance_km'] for node in nodes),
            route.get('corridor', {}).get('variant') == 'adjacent')


def unique_courses(routes: list[dict]) -> list[dict]:
    """방향 하나에 최상위 코스 하나를 남기고, 겹친 창의 중복 코스를 제거한다."""
    seen_courses, seen_headings = set(), set()
    ranked = []
    for route in sorted(routes, key=recommendation_rank):
        heading = route['corridor']['heading']
        course = tuple(node['place']['id'] for node in route['nodes'])
        if heading in seen_headings or course in seen_courses:
            continue
        seen_headings.add(heading)
        seen_courses.add(course)
        ranked.append(route)
    return ranked
