"""장소/방향 점수 계산 (AGENTS.md 7.3, 7.4)."""
from typing import Dict, List

BASE_WEIGHTS = {"M": 0.40, "D": 0.25, "Q": 0.20, "V": 0.15}


def normalize_weights(weights: Dict[str, float] | None) -> Dict[str, float]:
    """사용자 가중치를 받아 합계가 1이 되도록 정규화한다."""
    w = dict(BASE_WEIGHTS)
    if weights:
        for key in w:
            if key in weights and weights[key] >= 0:
                w[key] = float(weights[key])
    total = sum(w.values())
    if total <= 0:
        return dict(BASE_WEIGHTS)
    return {k: v / total for k, v in w.items()}


def interest_match(place: Dict, interests: List[str]) -> float:
    """관심사 키워드 일치도(0~100). 정보가 없으면 0으로 둔다."""
    if not interests:
        return 60.0
    hay = " ".join([place.get("category", ""), *place.get("keywords", [])]).lower()
    hits = sum(1 for word in interests if word.lower() in hay)
    return min(100.0, hits / len(interests) * 100)


def distance_score(distance_km: float, radius_km: float) -> float:
    """거리 적합도: 가까울수록 높은 점수."""
    if radius_km <= 0:
        return 0.0
    return max(0.0, min(100.0, (1 - distance_km / radius_km) * 100))


def quality_score(place: Dict) -> float:
    """품질/신뢰도: 평점과 데이터 신뢰도를 결합한다."""
    rating = float(place.get("rating", 0)) / 5 * 100
    confidence = float(place.get("confidence", 0)) * 100
    # 확인되지 않은 항목은 임의 점수를 만들지 않고 신뢰도를 낮춘다.
    return round(rating * 0.6 + confidence * 0.4, 1)


def visitability_score(place: Dict) -> float:
    """실제 방문 가능성: 영업시간 정보와 실내 여부로 추정한다."""
    score = 70.0 if place.get("hours") else 40.0
    if place.get("indoor"):
        score += 15
    return min(100.0, score)


def score_place(place: Dict, interests: List[str], radius_km: float,
                weights: Dict[str, float] | None = None) -> float:
    """P = 0.40M + 0.25D + 0.20Q + 0.15V"""
    w = normalize_weights(weights)
    values = {
        "M": interest_match(place, interests),
        "D": distance_score(float(place.get("distance_km", 0)), radius_km),
        "Q": quality_score(place),
        "V": visitability_score(place),
    }
    return round(sum(w[k] * values[k] for k in w), 1)


def score_directions(sectors: Dict, interests: List[str], candidates: List[Dict],
                     weights: Dict[str, float] | None = None) -> Dict[str, float]:
    """S = 0.7A + 0.3C : 상위 후보 평균 점수와 필수 관심사 충족률."""
    result = {}
    for name, info in sectors.items():
        top = [p for p in candidates if p.get("direction") == name][:5]
        if not top:
            result[name] = 0.0  # 후보가 없으면 0점
            continue
        avg = sum(p.get("score", 0) for p in top) / len(top)
        covered = sum(1 for word in interests
                      if any(word.lower() in " ".join(p.get("keywords", [])).lower()
                             for p in top))
        rate = covered / len(interests) * 100 if interests else 60.0
        result[name] = round(0.7 * avg + 0.3 * rate, 1)
    return result
