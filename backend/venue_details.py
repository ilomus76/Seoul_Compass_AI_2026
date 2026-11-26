"""공개 상점 정보가 같은 시설로 확인될 때만 TourAPI 메뉴와 운영시간을 연결한다."""
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
def confirmed_food_intro(name: str, lat: float, lng: float, phone: str) -> dict:
    results = tour_items('searchKeyword2', keyword=name, numOfRows=10)
    ids = {p['contentid'] for p in results if p.get('contentid') and same_venue(p, name, lat, lng, phone)}
    if len(ids) != 1:
        return {}
    intro = tour_items('detailIntro2', contentId=next(iter(ids)))
    return intro[0] if intro else {}


def annotate_menus(places: list[dict], terms: list[str], *, limit: int = 5) -> list[dict]:
    def enrich(pair):
        i, place = pair
        intro = {}
        if TOUR_API_KEY and place.get('source') == 'kakao' and i < limit:
            try:
                intro = confirmed_food_intro(place['name'], place['lat'], place['lng'], public_phone(place.get('phone')))
            except (ValueError, OSError, TypeError, KeyError):
                pass
        menus = list(dict.fromkeys(str(intro[field]).strip() for field in ('firstmenu', 'treatmenu') if intro.get(field)))
        hours = re.sub(r'\s*<br\s*/?>\s*', ' / ', str(intro.get('opentimefood') or ''), flags=re.I).strip()
        holidays = re.sub(r'\s*<br\s*/?>\s*', ' / ', str(intro.get('restdatefood') or ''), flags=re.I).strip()
        operating = {'hours': hours, 'holidays': holidays, 'source': '한국관광공사',
                     'source_url': 'https://www.data.go.kr/data/15101578/openapi.do'} if hours or holidays else None
        menu_text = name_key(' '.join(menus))
        matched = [term for term in terms if name_key(term) and name_key(term) in menu_text]
        status = 'matched' if terms and len(matched) == len(terms) else 'unconfirmed' if terms else 'published' if menus else 'unavailable'
        return {**place, 'menus': menus, 'menu_status': status, 'matched_menu_terms': matched,
                'operating_hours': operating,
                'menu_source': '한국관광공사' if menus else None}

    if not TOUR_API_KEY:
        return [enrich(pair) for pair in enumerate(places)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        return list(executor.map(enrich, enumerate(places)))
