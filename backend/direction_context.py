"""서울시 공개 비오톱 자료에서 방향 구역별 토지 이용을 요약한다."""
import json
import math
from collections import Counter
from functools import lru_cache

from .config import DATA_DIR
from .direction import calculate_bearing, haversine
from .route_corridor import sector_heading

LAND_USE_SOURCE = {
    'name': '서울시 생태현황도(비오톱유형)',
    'year': 2025,
    'url': 'https://data.seoul.go.kr/dataList/OA-21145/S/1/datasetView.do',
}


@lru_cache(maxsize=1)
def load_land_use():
    try:
        return json.loads((DATA_DIR / 'seoul_land_use_2025.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def direction_samples(grid: dict, latitude: float, longitude: float, radius: float, headings: set[int]) -> dict:
    """반경과 방위각에 속한 격자 표본을 모은다. 서울시 외부 표본도 분모에 포함한다."""
    south, west = grid['south'], grid['west']
    dy, dx = grid['lat_step'], grid['lng_step']
    rows = grid['rows']
    height, width = len(rows), len(rows[0])
    north_span = radius / 110
    east_span = north_span / math.cos(math.radians(latitude))
    first_row = math.floor((latitude - north_span - south) / dy)
    last_row = math.ceil((latitude + north_span - south) / dy)
    first_col = math.floor((longitude - east_span - west) / dx)
    last_col = math.ceil((longitude + east_span - west) / dx)
    counts = {heading: Counter() for heading in headings}
    if last_row < 0 or first_row >= height or last_col < 0 or first_col >= width:
        return counts
    for row in range(first_row, last_row + 1):
        lat = south + row * dy
        for col in range(first_col, last_col + 1):
            lng = west + col * dx
            distance = haversine(latitude, longitude, lat, lng)
            if not .05 < distance <= radius:
                continue
            heading = sector_heading(calculate_bearing(latitude, longitude, lat, lng))
            if heading in counts:
                value = rows[row][col] if 0 <= row < height and 0 <= col < width else '.'
                counts[heading][value] += 1
    return counts


def annotate_land_use(review: dict, origin: dict | None, radius: float) -> None:
    """경로 미선정과 함께 읽을 자료를 추가한다. 경로 순위는 이 자료를 사용하지 않는다."""
    missing = {heading: row for heading, row in review.get('rows', {}).items()
               if row['status'] in ('missing_clusters', 'no_combination')}
    if not missing:
        return
    grid = load_land_use()
    if not origin or not grid:
        return
    lat, lng = origin.get('latitude'), origin.get('longitude')
    if lat is None or lng is None or not -89 < lat < 89:
        return
    counts = direction_samples(grid, lat, lng, radius, set(missing))
    review['land_use_source'] = LAND_USE_SOURCE
    for heading, row in missing.items():
        samples = counts[heading]
        total = sum(samples.values())
        known = total - samples.get('.', 0)
        coverage = round(100 * known / total) if total else 0
        evidence = {'coverage_percent': coverage, 'types': []}
        if known >= 12 and coverage >= 65:
            evidence['types'] = [
                {'name': grid['labels'][code], 'percent': round(100 * count / known)}
                for code, count in samples.most_common() if code in grid['labels']
            ][:2]
            evidence['commercial_percent'] = round(100 * samples.get('B', 0) / known)
        row['land_use'] = evidence
