"""활동 군집 중심을 출발지 기준 방위각으로 비교한다."""
from typing import Callable

from .direction import calculate_bearing, haversine

HEADINGS = tuple(range(0, 360, 10))
PRIMARY_WIDTH = 10
ALTERNATE_WIDTH = 30


def angle_delta(angle: float, axis: float) -> float:
    return (angle - axis + 180) % 360 - 180


def point_bearing(start: dict, point: dict) -> float | None:
    """출발점 군집은 방향이 불안정하므로 부채꼴 조건에서 제외한다."""
    coordinates = (start['latitude'], start['longitude'], point['lat'], point['lng'])
    return calculate_bearing(*coordinates) if haversine(*coordinates) > .05 else None


def corridor_options(groups: list[list[dict]], activities: list[dict], request: dict,
                     find_courses: Callable) -> list[dict]:
    start = request['start_location']
    goal = request.get('route_goal')
    axis = request.get('requested_bearing')
    goal_axis = point_bearing(start, {'lat': goal['latitude'], 'lng': goal['longitude']}) if (
        goal and goal.get('latitude') is not None and goal.get('longitude') is not None) else None
    if axis is None:
        axis = goal_axis
    bearing_groups = [[(group, None if activity['category'] in ('return_to_start', 'return_to_current')
                        else point_bearing(start, group['center'])) for group in options]
                      for activity, options in zip(activities, groups)]
    if not bearing_groups or not all(bearing_groups):
        return []

    def evaluate(heading, lower, upper, label):
        if label == 'primary' and request.get('requested_bearing') is not None and abs(angle_delta(axis, heading)) > PRIMARY_WIDTH:
            return []
        scoped = [[group for group, bearing in options if bearing is None
                   or lower - 1e-7 <= angle_delta(bearing, heading) <= upper + 1e-7]
                  for options in bearing_groups]
        if not all(scoped) or (goal_axis is not None and not lower - 1e-7 <= angle_delta(goal_axis, heading) <= upper + 1e-7):
            return []
        beams = find_courses(scoped)
        return [{**beam, 'corridor': {'heading': heading, 'variant': label,
                                     'left_degrees': -lower, 'right_degrees': upper}}
                for beam in beams[:1 if label == 'primary' else 5]]

    primary = [beam for heading in HEADINGS for beam in evaluate(heading, -PRIMARY_WIDTH, PRIMARY_WIDTH, 'primary')]
    if primary:
        return primary

    if axis is None:
        # 마지막 활동부터 실제 후보가 가리키는 방향을 비교한다. 귀환은 제외된다.
        references = [bearing for options in reversed(bearing_groups) for _, bearing in options if bearing is not None]
        axis = references[0] if references else None
    if axis is None:
        return []
    return evaluate(axis, -ALTERNATE_WIDTH, 0, 'left') + evaluate(axis, 0, ALTERNATE_WIDTH, 'right')


def recommendation_rank(route: dict) -> tuple:
    nodes = route['nodes']
    return (-sum(node['place'].get('menu_status') == 'matched' for node in nodes),
            sum(node.get('travel_minutes') or 0 for node in nodes),
            sum(node['distance_km'] for node in nodes))


def unique_courses(routes: list[dict]) -> list[dict]:
    """방향 하나에 최상위 코스 하나를 남기고, 겹친 창의 중복 코스를 제거한다."""
    primary = [route for route in routes if route['corridor']['variant'] == 'primary']
    seen_courses, seen_headings = set(), set()
    ranked = []
    for route in sorted(primary or routes, key=recommendation_rank):
        corridor = route['corridor']
        if primary:
            heading = corridor['heading']
            if heading in seen_headings:
                continue
            seen_headings.add(heading)
        course = tuple(node['place']['id'] for node in route['nodes'])
        if course not in seen_courses:
            seen_courses.add(course)
            ranked.append(route)
    if not primary:
        # 양쪽에 결과가 있으면 먼저 한 코스씩 확보한 뒤 나머지 코스를 순서대로 제공한다.
        first_on_side = {}
        other_courses = []
        for route in ranked:
            side = route['corridor']['variant']
            if side in first_on_side:
                other_courses.append(route)
            else:
                first_on_side[side] = route
        return list(first_on_side.values()) + other_courses
    return ranked
