"""같은 활동의 장소를 반경 50m의 군집으로 묶는다."""
from .direction import haversine
from .menu_model import menu_rank

CLUSTER_RADIUS_KM = .05
CANDIDATE_POOL_LIMIT = 15


def distance(a: dict, b: dict) -> float:
    return haversine(a['lat'], a['lng'], b['lat'], b['lng'])


def cluster_places(places: list[dict]) -> list[dict]:
    """후보가 밀집한 점부터 묶고, 거리 조건을 지키는 범위에서 중앙으로 옮긴다."""
    pending = list({place['id']: place for place in places}.values())
    groups = []
    while pending:
        neighborhoods = [[q for q in pending if distance(p, q) <= CLUSTER_RADIUS_KM]
                         for p in pending]
        index = max(range(len(pending)), key=lambda i: len(neighborhoods[i]))
        seed, members = pending[index], neighborhoods[index]
        groups.append({'center': {'lat': seed['lat'], 'lng': seed['lng']}, 'members': members})
        member_ids = {p['id'] for p in members}
        pending = [p for p in pending if p['id'] not in member_ids]

    # 평균 좌표로 옮긴 뒤에도 모든 장소가 반경 안에 있고 다른 중심과 50m 이상 떨어져야 한다.
    for group in groups:
        members = group['members']
        center = {key: sum(p[key] for p in members) / len(members) for key in ('lat', 'lng')}
        if (all(distance(center, p) <= CLUSTER_RADIUS_KM for p in members)
                and all(other is group or distance(center, other['center']) >= CLUSTER_RADIUS_KM
                        for other in groups)):
            group['center'] = center

    for group in groups:
        center = group['center']
        members = group.pop('members')
        group.update(
            representative=min(members, key=lambda p: (*menu_rank(p),
                                                       p.get('menu_status') == 'unconfirmed' and bool(p.get('venue_condition_unconfirmed')),
                                                       distance(center, p))),
            place_ids=[p['id'] for p in members],
            size=len(members),
            radius_m=50,
        )
    return groups
