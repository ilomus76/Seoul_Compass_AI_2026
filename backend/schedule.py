"""시간대별 일정 계산과 충돌 검사 (AGENTS.md 8장)."""
from typing import Dict, List

from .opening_hours import resolve_visit


def to_minutes(value: str | None) -> int | None:
    """'14:00' → 840분. 값이 없으면 None."""
    if not value:
        return None
    parts = str(value).split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None


def to_clock(minutes: int) -> str:
    """840 → '14:00'"""
    minutes = int(minutes) % (24 * 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def travel_minutes(distance_km: float, mode: str = "walking") -> int:
    """직선거리 기반 이동시간 추정(실제 경로 API 값이 아니다)."""
    if mode == "walking":
        return max(1, round(distance_km / 5 * 60))     # 시속 5km
    if mode == "bus":
        return max(4, round(distance_km / 20 * 60) + 5)
    return max(4, round(distance_km / 30 * 60) + 6)    # subway


def availability_warning(place: dict, travel_date: str | None, start: int | None,
                         end: int | None = None) -> dict | None:
    duration = end - start if start is not None and end is not None else 0
    return resolve_visit(place, travel_date, start, duration).warning


def validate_schedule(activities: List[Dict], route: Dict,
                      buffer_minutes: int = 10) -> Dict:
    """고정시간 준수 여부와 충돌을 검사한다."""
    nodes = route.get("nodes", [])
    timeline, conflicts = [], []
    cursor = None
    departure = to_minutes(route.get('departure_time'))
    has_visit_time = departure is not None

    travel_date = route.get('travel_date')

    for i, activity in enumerate(activities):
        fixed = bool(activity.get('fixed_time'))
        requested = to_minutes(activity.get('start_time'))
        bounds = (requested, to_minutes(activity.get('earliest_start')), to_minutes(activity.get('preferred_time')))
        start = requested if fixed and requested is not None else max((value for value in bounds if value is not None), default=None)
        node = nodes[i] if i < len(nodes) else {}
        place = node.get('place', {})
        duration = int(activity['duration_minutes']) if activity.get('duration_minutes') is not None else 60
        travel = int(node.get('travel_minutes') or 0)
        previous_end = cursor if cursor is not None else departure
        buffer = buffer_minutes if previous_end is not None and (cursor is not None or travel) else 0
        arrival = previous_end + travel + buffer if previous_end is not None else None
        earliest = max((value for value in (arrival, start) if value is not None), default=9 * 60)
        has_visit_time = has_visit_time or start is not None
        visit = resolve_visit(place, travel_date, earliest if has_visit_time or travel_date else None,
                              duration, allow_wait=not fixed)
        real_start = visit.start if visit.start is not None else earliest
        end = real_start + duration
        warning = visit.warning
        if warning:
            conflicts.append({'activity_id': activity.get('id'), 'reason': warning['reason'],
                              'shortage_minutes': 0, 'kind': 'visit_unavailable'})

        if fixed and start is not None and real_start > start:
            conflicts.append({
                "activity_id": activity.get("id"),
                "reason": "이전 활동, 이동 및 여유시간을 반영하면 고정 시각에 늦습니다.",
                "shortage_minutes": real_start - start,
            })
        for field in ('end_time', 'latest_end'):
            deadline = to_minutes(activity.get(field))
            if deadline is not None and end > deadline:
                conflicts.append({'activity_id': activity.get('id'), 'reason': '지정한 종료시각을 초과했습니다.',
                                  'shortage_minutes': end - deadline})
        if duration < 0 or (duration == 0 and activity['category'] not in ('return_to_start', 'return_to_current', 'destination')):
            conflicts.append({'activity_id': activity.get('id'), 'reason': '활동 시작·종료시간을 확인해 주세요.',
                              'shortage_minutes': 0})
        if not place and activity.get('required', True):
            conflicts.append({'activity_id': activity.get('id'), 'reason': '필수 활동의 장소가 없습니다.',
                              'shortage_minutes': 0})

        timeline.append({
            "activity_id": activity.get("id"),
            "category": activity.get("category"),
            "place": place.get("name"),
            "planned_start": to_clock(start) if start is not None else None,
            "estimated_start": to_clock(real_start),
            "estimated_end": to_clock(end),
            "arrival_time": to_clock(arrival) if arrival is not None else None,
            "duration_minutes": duration,
            "duration_estimated": activity.get('duration_estimated', True),
            "travel_minutes": travel,
            "travel_source": node.get("travel_source"),
            "buffer_minutes": buffer,
            "opening_wait_minutes": real_start - earliest,
            "availability_checked": visit.checked,
            "fixed_time": fixed,
            "official_event_time": bool(activity.get('official_event_time')),
            'visit_warning': warning,
        })
        cursor = end

    return {
        "timeline": timeline,
        "conflicts": conflicts,
        "feasible": len(conflicts) == 0,
        "note": ("조회한 길찾기 시간과 나머지 구간의 이동 추정을 적용했습니다."
                 if any(row["travel_source"] for row in timeline) else "이동시간은 직선거리 기반 추정입니다.")
                + " 공개 운영시간이 없는 장소는 방문 전에 확인해 주세요.",
    }
