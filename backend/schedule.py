"""시간대별 일정 계산과 충돌 검사 (AGENTS.md 8장)."""
from typing import Dict, List


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


def validate_schedule(activities: List[Dict], route: Dict,
                      buffer_minutes: int = 10) -> Dict:
    """고정시간 준수 여부와 충돌을 검사한다."""
    nodes = route.get("nodes", [])
    timeline, conflicts = [], []
    cursor = None

    for i, activity in enumerate(activities):
        # 고정 시간이 없으면 희망 시간(earliest/preferred)을 시작 기준으로 사용한다.
        start = next((value for value in (to_minutes(activity.get('start_time')),
                      to_minutes(activity.get('earliest_start')), to_minutes(activity.get('preferred_time')))
                      if value is not None), None)
        place = nodes[i]["place"] if i < len(nodes) else {}
        duration = int(activity['duration_minutes']) if activity.get('duration_minutes') is not None else 60
        travel = int(nodes[i].get('travel_minutes') or 0) if i < len(nodes) else 0
        departure = to_minutes(route.get('departure_time'))
        arrive = (cursor + travel + buffer_minutes if cursor is not None else
                  departure + travel + (buffer_minutes if travel else 0) if departure is not None else start)
        if arrive is None:
            arrive = 9 * 60
        real_start = max(arrive, start) if start is not None else arrive
        end = real_start + duration

        if activity.get('fixed_time') and start is not None and real_start > start:
            conflicts.append({
                "activity_id": activity.get("id"),
                "reason": "고정 시간을 이동시간 때문에 초과했습니다.",
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
            "duration_minutes": duration,
            "duration_estimated": activity.get('duration_estimated', True),
            "travel_minutes": travel,
            "fixed_time": bool(activity.get("fixed_time")),
        })
        cursor = end

    return {
        "timeline": timeline,
        "conflicts": conflicts,
        "feasible": len(conflicts) == 0,
        "note": "직선거리 기반 추정입니다. 실제 경로/영업시간은 확인이 필요합니다.",
    }
