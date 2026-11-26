"""공개 메뉴 목록으로 학습한 최근접 이웃 모델과 동일 업소 메뉴 확인."""
import csv
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from heapq import nlargest

from .config import DATA_DIR

MENU_DATA = DATA_DIR / 'public_menus_seoul.csv'
PUBLIC_MENU_SOURCE = '행정안전부 착한가격업소'
PUBLIC_MENU_URL = 'https://www.data.go.kr/data/3045247/fileData.do'
PUBLIC_MENU_DATE = '2026-09-30'
ROAD_ADDRESS = re.compile(r'^서울(?:특별시)?\s+(\S+구)\s+(.+?[로길])\s*(\d+(?:-\d+)?)(?=\s|\(|$)')
UNAVAILABLE = ('미판매', '판매중단', '판매안함', '판매하지않', '품절', '제외', '대신')
GENERIC_INDUSTRIES = {'음식점', '한식', '일식', '중식', '양식', '기타요식업'}


def name_key(value: str) -> str:
    return re.sub(r'[^\w]|_', '', value.casefold()).replace('댓', '대')


def address_key(address: str) -> tuple[str, str, str] | None:
    """서울의 구·도로명·건물번호를 비교해 같은 지점의 메뉴만 붙인다."""
    match = ROAD_ADDRESS.match(address.strip())
    return tuple(name_key(part) if i < 2 else part for i, part in enumerate(match.groups())) if match else None


def menu_matches(term: str, entry: str) -> bool:
    term_key = name_key(term)
    entry_key = name_key(entry)
    return bool(term_key and term_key in entry_key and not any(label in entry_key for label in UNAVAILABLE))


def menu_entries(values: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(
        item.strip() for value in values for item in re.split(r'<br\s*/?>|[/;,·\n]', value, flags=re.I) if item.strip()
    ))


def shop_features(name: str, industries: list[str]) -> frozenset[str]:
    """상호와 개별 업종명에서 한글 띄어쓰기에 영향을 덜 받는 문자 조각을 얻는다."""
    fields = [name] + [word for value in industries for word in re.split(r'[,>]', value)
                       if word.strip() not in GENERIC_INDUSTRIES]
    keys = [name_key(value) for value in fields]
    return frozenset(key[i:i + length] for key in keys for length in (2, 3)
                     for i in range(len(key) - length + 1))


@dataclass(frozen=True)
class ListedShop:
    name: str
    menus: tuple[str, ...]
    features: frozenset[str]


@lru_cache(maxsize=1)
def menu_catalog() -> tuple[list[ListedShop], dict]:
    """공개 메뉴가 있는 식당을 학습 표본으로 읽고 지점별 메뉴 조회 색인을 만든다."""
    examples, matches = [], defaultdict(list)
    try:
        with MENU_DATA.open(encoding='utf-8-sig', newline='') as snapshot:
            rows = list(csv.DictReader(snapshot))
    except (OSError, UnicodeError):
        return [], {}
    for row in rows:
        menus = menu_entries([row.get(f'menu_{i}') or '' for i in range(1, 5)])
        name, address = row.get('name') or '', row.get('address') or ''
        if not name or not menus:
            continue
        shop = ListedShop(name, menus, shop_features(name, [row.get('industry') or '']))
        examples.append(shop)
        road = address_key(address)
        if road is not None:
            matches[(name_key(name), road)].append(shop)
    return examples, dict(matches)


def address_matched_menus(place: dict) -> tuple[str, ...]:
    if place.get('source') not in ('kakao', 'sbiz'):
        return ()
    key = (name_key(place['name']), address_key(place.get('address') or ''))
    shops = menu_catalog()[1].get(key, [])
    return shops[0].menus if len(shops) == 1 else ()


def known_menu_shops(terms: list[str], center_address: str) -> list[tuple[str, tuple[str, str, str]]]:
    """기준점 주소에서 구를 확인하고 같은 구의 메뉴 등재 업소를 보완 검색한다."""
    city = re.match(r'^서울(?:특별시)?\s+(\S+구)(?=\s|$)', center_address.strip())
    if not city:
        return []
    district = name_key(city[1])
    center_road = address_key(center_address)
    matches = []
    for (_, road), shops in menu_catalog()[1].items():
        if road[0] != district or len(shops) != 1:
            continue
        shop = shops[0]
        if all(any(menu_matches(term, entry) for entry in shop.menus) for term in terms):
            matches.append((shop.name, road))
    return sorted(matches, key=lambda match: (not (center_road and match[1][1].startswith(center_road[1])), match[0]))


def related_menu_score(place: dict, terms: list[str]) -> dict:
    """유사 업소의 공개 메뉴 표지로 가중 투표한다. 관련도는 후보 순서에만 사용한다."""
    industries = [place.get('provider_category') or '', (place.get('merchant') or {}).get('industry') or '']
    features = shop_features(place['name'], industries)
    neighbors = []
    if features and terms:
        for shop in menu_catalog()[0]:
            shared = len(features & shop.features)
            if shared:
                similarity = shared / len(features | shop.features)
                neighbors.append((similarity, shop))
    closest = nlargest(7, neighbors, key=lambda neighbor: neighbor[0])
    votes = [weight for weight, shop in closest
             if all(any(menu_matches(term, entry) for entry in shop.menus) for term in terms)]
    total_weight = sum(weight for weight, _ in closest)
    return {'relatedness': round(100 * sum(votes) / (1 + total_weight)),
            'supporting_neighbors': len(votes)}


def menu_rank(place: dict) -> tuple:
    return (place.get('menu_status') != 'matched', not place.get('menu_match_hint'),
            -(place.get('menu_model') or {}).get('relatedness', 0))
