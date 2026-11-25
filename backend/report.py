"""기대치 리포트 생성 (AGENTS.md 10장)."""
from typing import Dict


def build_report(route: Dict, preferences: Dict | None = None) -> Dict:
    """추천 근거, 예상 시간/비용, 충돌, 신뢰도, 주의사항을 정리한다."""
    preferences = preferences or {}
    nodes = route.get("nodes", [])
    schedule = route.get("schedule", {})
    conflicts = schedule.get("conflicts", [])
    reasons = []
    for node in nodes:
        place = node.get("place", {})
        reasons.append(f"{place.get('name')} — 관심사 일치 점수 {place.get('score', 0)}점, "
                       f"{place.get('direction', '미확인')} 방향, {node.get('distance_km', 0)}km")

    cautions = ["직선거리 기반 추정이며 실제 경로 API로 검증되지 않았습니다."]
    if route.get("data_confidence", 0) < 0.8:
        cautions.append("일부 장소의 정보 신뢰도가 낮아 방문 전 확인이 필요합니다.")
    if conflicts:
        cautions.append(f"고정 시간 충돌 {len(conflicts)}건이 있습니다.")

    return {
        "recommended_direction": route.get("direction"),
        "route_score": route.get("score"),
        "interest_satisfaction": round(
            sum(n.get("place", {}).get("score", 0) for n in nodes) / max(1, len(nodes)), 1),
        "places": [n["place"]["name"] for n in nodes],
        "timeline": schedule.get("timeline", []),
        "total_travel_minutes": route.get("total_travel_minutes", 0),
        "total_activity_minutes": sum(t.get("duration_minutes", 0)
                                      for t in schedule.get("timeline", [])),
        "estimated_transport_cost_krw": None,  # 확인되지 않으면 추정하지 않는다
        "estimated_facility_cost_krw": route.get("estimated_cost_krw", 0),
        "reasons": reasons,
        "conflicts": conflicts,
        "data_confidence": route.get("data_confidence"),
        "cautions": cautions,
        "alternatives": ["상위 경로의 다른 순위를 확인하세요."],
    }
