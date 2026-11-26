"""공개 상점 정보가 같은 시설로 확인될 때만 TourAPI 메뉴를 연결한다."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from urllib.parse import unquote, urlencode
from urllib.request import urlopen

from .config import TOUR_API_KEY
from .direction import haversine

TOUR_API = 'https://apis.data.go.kr/B551011/KorService2/'


def public_phone(value: str | None) -> str:
    number = re.sub(r'\D', '', value or '')
    if (value or '').lstrip().startswith('+82'):
        number = '0' + number[2:].lstrip('0')
    return number if 8 <= len(number) <= 11 else ''


def name_key(value: str) -> str:
    return re.sub(r'[^\w]|_', '', value.casefold()).replace('댓', '대')


def same_venue(item: dict, name: str, lat: float, lng: float, phone: str) -> bool:
    other_phone = public_phone(item.get('tel'))
    if phone and other_phone and phone != other_phone:
        return False
    if name_key(item.get('title') or '') != name_key(name):
        return False
    try:
        return haversine(lat, lng, float(item['mapy']), float(item['mapx'])) <= .10
    except (ValueError, TypeError, KeyError):
        return bool(phone and phone == other_phone)


def tour_items(operation: str, **query) -> list[dict]:
    params = {'serviceKey': unquote(TOUR_API_KEY), 'MobileOS': 'ETC', 'MobileApp': 'SeoulCompassAI',
              '_type': 'json', 'contentTypeId': '39', **query}
    with urlopen(TOUR_API + operation + '?' + urlencode(params), timeout=2) as response:
        data = json.load(response)
    items = (data.get('response', {}).get('body', {}).get('items') or {})
    rows = items.get('item', []) if isinstance(items, dict) else []
    return rows if isinstance(rows, list) else [rows]


@lru_cache(maxsize=256)
def confirmed_menus(name: str, lat: float, lng: float, phone: str) -> tuple[str, ...]:
    results = tour_items('searchKeyword2', keyword=name, numOfRows=10)
    ids = {p['contentid'] for p in results if p.get('contentid') and same_venue(p, name, lat, lng, phone)}
    if len(ids) != 1:
        return ()
    intro = tour_items('detailIntro2', contentId=next(iter(ids)))
    menus = (row.get(field) for row in intro for field in ('firstmenu', 'treatmenu'))
    return tuple(dict.fromkeys(str(menu).strip() for menu in menus if menu))


def annotate_menus(places: list[dict], terms: list[str], *, limit: int = 5) -> list[dict]:
    def enrich(pair):
        i, place = pair
        menus = ()
        if TOUR_API_KEY and place.get('source') == 'kakao' and i < limit:
            try:
                menus = confirmed_menus(place['name'], place['lat'], place['lng'], public_phone(place.get('phone')))
            except (ValueError, OSError, TypeError, KeyError):
                pass
        menu_text = name_key(' '.join(menus))
        matched = [term for term in terms if name_key(term) and name_key(term) in menu_text]
        status = 'matched' if terms and len(matched) == len(terms) else 'unconfirmed' if terms else 'published' if menus else 'unavailable'
        return {**place, 'menus': list(menus), 'menu_status': status, 'matched_menu_terms': matched,
                'menu_source': '한국관광공사' if menus else None}

    if not TOUR_API_KEY:
        return [enrich(pair) for pair in enumerate(places)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        return list(executor.map(enrich, enumerate(places)))
