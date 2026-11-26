"""소상공인시장진흥공단 업종 코드와 실제 상가 위치를 조회한다."""
import json
import math
import re
from functools import lru_cache
from time import monotonic
from urllib.parse import unquote, urlencode
from urllib.request import urlopen

from .config import SBDC_API_KEY
from .direction import calculate_bearing, haversine
from .location_context import within_region
from .route_corridor import sector_heading
from .venue_details import name_key, public_phone

ENDPOINT = 'https://apis.data.go.kr/B553077/api/open/sdsc2/'
PAGE_SIZE = 1000


def industry_items(endpoint: str, **query) -> tuple[list[dict], int]:
    params = {'serviceKey': unquote(SBDC_API_KEY), 'type': 'json', **query}
    with urlopen(ENDPOINT + endpoint + '?' + urlencode(params), timeout=4) as response:
        payload = json.load(response)
    if str(payload.get('header', {}).get('resultCode')) not in ('0', '00', '0000'):
        raise ValueError('상권정보 API 요청 실패')
    body = payload['body']
    rows = body.get('items') or []
    if isinstance(rows, dict):
        rows = rows.get('item', [])
    if not isinstance(rows, list):
        rows = [rows]
    return rows, int(body.get('totalCount') or len(rows))


@lru_cache(maxsize=4)
def industry_catalog(refresh_slot: int) -> list[dict]:
    rows, _ = industry_items('smallUpjongList')
    return rows


def industry_match(labels: list[str], terms: list[str]) -> bool:
    keys = [name_key(label) for label in labels if label]
    return any(term in label for term in (name_key(term) for term in terms) if len(term) >= 2 for label in keys)


def matching_codes(rows: list[dict], terms: list[str]) -> list[str]:
    keys = [name_key(term) for term in terms if len(name_key(term)) >= 2]
    matches = {}
    for row in rows:
        code = row.get('indsSclsCd') or ''
        name = name_key(row.get('indsSclsNm') or '')
        strengths = [len(term) * (2 if term == name else 1) for term in keys if term in name]
        if strengths and re.fullmatch(r'[A-Z0-9]{6}', code):
            matches[code] = max(strengths)
    return sorted(matches, key=matches.get, reverse=True)[:3]


@lru_cache(maxsize=96)
def merchants_in_box(lat: float, lng: float, radius: float, code: str, refresh_slot: int) -> list[dict]:
    # 반경 조회 API의 2km 한계 때문에 경계 상자를 조회한 뒤 원 밖 후보를 다시 걸러낸다.
    dy = radius / 110
    dx = radius / (110 * math.cos(math.radians(lat)))
    query = {'minx': lng - dx, 'maxx': lng + dx, 'miny': lat - dy, 'maxy': lat + dy,
             'indsSclsCd': code, 'numOfRows': PAGE_SIZE}
    rows, count = industry_items('storeListInRectangle', pageNo=1, **query)
    if count > PAGE_SIZE:
        rows += industry_items('storeListInRectangle', pageNo=2, **query)[0]
    return rows


def search_merchants(center: dict, radius: float, scope: str | None, terms: list[str]) -> list[dict]:
    """공개 분류에 해당하는 업체만 찾고 10° 방향마다 가까운 후보를 보존한다."""
    if not SBDC_API_KEY or not terms:
        return []
    lat, lng = center['lat'], center['lng']
    if not (33 <= lat <= 39 and 124 <= lng <= 132):
        return []
    courses = {}
    codes = matching_codes(industry_catalog(int(monotonic() // 86400)), terms)
    for code in codes:
        for row in merchants_in_box(round(lat, 5), round(lng, 5), radius, code, int(monotonic() // 600)):
            address = row.get('rdnmAdr') or row.get('lnoAdr') or ''
            if (not address or not (within_region(address, scope) or within_region(row.get('lnoAdr') or '', scope))
                    or not row.get('bizesId') or not row.get('bizesNm')):
                continue
            try:
                y, x = float(row['lat']), float(row['lon'])
            except (ValueError, TypeError, KeyError):
                continue
            if not (33 <= y <= 39 and 124 <= x <= 132):
                continue
            distance = haversine(lat, lng, y, x)
            if distance > radius:
                continue
            store_id = str(row['bizesId'])
            branch = str(row.get('brchNm') or '').strip()
            name = str(row['bizesNm']).strip()
            if branch and name_key(branch) not in name_key(name):
                name = f'{name} {branch}'
            courses[store_id] = {
                'id': 'sbiz_' + store_id, 'name': name, 'address': address, 'lat': y, 'lng': x,
                'distance_km': round(distance, 3), 'source': 'sbiz',
                'merchant': {'store_id': store_id, 'industry_code': code, 'industry': row.get('indsSclsNm'),
                             'standard_industry': row.get('ksicNm'), 'standard_code': row.get('ksicCd')},
            }
    sectors = {}
    for place in sorted(courses.values(), key=lambda item: item['distance_km']):
        heading = sector_heading(calculate_bearing(lat, lng, place['lat'], place['lng']))
        bucket = sectors.setdefault(heading, [])
        if len(bucket) < 2:
            bucket.append(place)
    return [place for group in sectors.values() for place in group]


def merge_merchants(places: list[dict], merchants: list[dict]) -> list[dict]:
    """상호와 주소 또는 근접 좌표가 맞는 단일 지점에만 공공 분류를 연결한다."""
    result = []
    attached = set()
    for place in places:
        matches = []
        for merchant in merchants:
            if name_key(place['name']) != name_key(merchant['name']):
                continue
            phone = public_phone(place.get('phone'))
            other = public_phone(merchant.get('phone'))
            if phone and other and phone != other:
                continue
            address = name_key(place.get('address') or '')
            if address != name_key(merchant['address']) and haversine(place['lat'], place['lng'], merchant['lat'], merchant['lng']) > .05:
                continue
            matches.append(merchant)
        if len(matches) == 1:
            merchant = matches[0]
            attached.add(merchant['id'])
            place = {**place, 'merchant': merchant['merchant']}
        result.append(place)
    return result + [merchant for merchant in merchants if merchant['id'] not in attached]
