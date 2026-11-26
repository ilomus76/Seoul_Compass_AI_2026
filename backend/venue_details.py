"""같은 시설로 확인된 TourAPI 장소에 메뉴와 운영시간을 연결한다."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from urllib.parse import unquote, urlencode
from urllib.request import urlopen

from .config import TOUR_API_KEY
from .direction import haversine
from .menu_model import (PUBLIC_MENU_DATE, PUBLIC_MENU_SOURCE, PUBLIC_MENU_URL, address_matched_menus,
                         menu_entries, menu_matches, name_key, related_menu_score)

TOUR_API = 'https://apis.data.go.kr/B551011/KorService2/'
TOUR_SOURCE = '한국관광공사'
TOUR_URL = 'https://www.data.go.kr/data/15101578/openapi.do'
OPERATING_FIELDS = {
    '12': ('usetime', 'restdate'),
    '14': ('usetimeculture', 'restdateculture'),
    '28': ('usetimeleports', 'restdateleports'),
    '38': ('opentime', 'restdateshopping'),
    '39': ('opentimefood', 'restdatefood'),
}
VENUE_TYPES = {
    'palace': '12', 'park': '12', 'night_view': '12', 'history_museum': '14', 'culture': '14',
    'cinema': '14', 'swimming': '28', 'bowling': '28', 'karaoke': '28', 'amusement': '28', 'shopping': '38',
}


def public_phone(value: str | None) -> str:
    number = re.sub(r'\D', '', value or '')
    if (value or '').lstrip().startswith('+82'):
        number = '0' + number[2:].lstrip('0')
    return number if 8 <= len(number) <= 11 else ''


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
def confirmed_venue_intro(name: str, lat: float, lng: float, phone: str, content_type: str) -> dict:
    results = tour_items('searchKeyword2', keyword=name, numOfRows=10, contentTypeId=content_type)
    ids = {p['contentid'] for p in results if p.get('contentid') and same_venue(p, name, lat, lng, phone)}
    if len(ids) != 1:
        return {}
    intro = tour_items('detailIntro2', contentId=next(iter(ids)), contentTypeId=content_type)
    return intro[0] if intro else {}


def venue_intro(place: dict, content_type: str) -> dict:
    if not TOUR_API_KEY or place.get('source') not in ('kakao', 'sbiz'):
        return {}
    try:
        return confirmed_venue_intro(place['name'], place['lat'], place['lng'],
                                     public_phone(place.get('phone')), content_type)
    except (ValueError, OSError, TypeError, KeyError):
        return {}


def operating_details(intro: dict, content_type: str) -> dict | None:
    hours, holidays = (re.sub(r'\s*<br\s*/?>\s*', '\n', str(intro.get(field) or ''), flags=re.I).strip()
                       for field in OPERATING_FIELDS[content_type])
    if hours or holidays:
        return {'hours': hours, 'holidays': holidays, 'source': TOUR_SOURCE, 'source_url': TOUR_URL}
    return None


def annotate_operating_hours(places: list[dict], category: str, *, limit: int = 5) -> list[dict]:
    content_type = VENUE_TYPES.get(category)
    if not content_type or not TOUR_API_KEY or not places:
        return places

    def enrich(place):
        if place.get('operating_hours'):
            return place
        operating = operating_details(venue_intro(place, content_type), content_type)
        return {**place, 'operating_hours': operating} if operating else place

    with ThreadPoolExecutor(max_workers=4) as executor:
        return list(executor.map(enrich, places[:limit])) + places[limit:]


def annotate_menus(places: list[dict], terms: list[str], *, limit: int = 5) -> list[dict]:
    """판매 근거와 예측값을 독립적으로 만든다. 이 단계에서는 후보를 제외하지 않는다."""
    profiles = []
    for i, place in enumerate(places):
        local = address_matched_menus(place)
        model = related_menu_score(place, terms) if terms else None
        profiles.append((i, place, local, model))

    def lookup_order(profile):
        _, place, local, model = profile
        missing = any(not any(menu_matches(term, entry) for entry in local) for term in terms)
        return (not missing, -(model or {}).get('relatedness', 0), place.get('distance_km', 0))

    # 이미 메뉴를 확인한 곳보다 관련도가 높은 미확인 업소의 공개 메뉴를 먼저 조회한다.
    ordered = sorted(profiles, key=lookup_order) if terms else profiles
    checked = {profile[0] for profile in ordered[:limit]}

    def enrich(profile):
        i, place, local, model = profile
        intro = venue_intro(place, '39') if i in checked else {}
        tour_menus = menu_entries([str(intro[field]) for field in ('firstmenu', 'treatmenu') if intro.get(field)])
        menus = list(dict.fromkeys((*tour_menus, *local)))
        operating = operating_details(intro, '39') or place.get('operating_hours')
        evidence = []
        for entries, source, url, date in ((tour_menus, TOUR_SOURCE, TOUR_URL, None),
                                           (local, PUBLIC_MENU_SOURCE, PUBLIC_MENU_URL, PUBLIC_MENU_DATE)):
            for entry in entries:
                supporting = [term for term in terms if menu_matches(term, entry)]
                if supporting:
                    evidence.append({'terms': supporting, 'menu': entry, 'source': source,
                                     'source_url': url, 'published_date': date})
        matched = [term for term in terms if any(term in row['terms'] for row in evidence)]
        status = 'matched' if terms and len(matched) == len(terms) else 'unconfirmed' if terms else 'published' if menus else 'unavailable'
        sources = [source for entries, source in ((tour_menus, TOUR_SOURCE), (local, PUBLIC_MENU_SOURCE)) if entries]
        result = {**place, 'menus': menus, 'menu_status': status, 'matched_menu_terms': matched,
                  'operating_hours': operating, 'menu_source': ' · '.join(sources) or None}
        if terms:
            result['menu_evidence'] = evidence
            result['menu_model'] = model
        if status == 'matched' and name_key(result.get('venue_condition_unconfirmed') or '') in map(name_key, terms):
            result.pop('venue_condition_unconfirmed')
        if status == 'unconfirmed':
            venue_text = name_key(' '.join(filter(None, (place['name'], place.get('provider_category'),
                                                       (place.get('merchant') or {}).get('industry')))))
            if all(name_key(term) and name_key(term) in venue_text for term in terms):
                result['menu_match_hint'] = True
            else:
                result.setdefault('venue_condition_unconfirmed', ', '.join(terms))
        return result

    if not TOUR_API_KEY:
        return [enrich(profile) for profile in profiles]
    with ThreadPoolExecutor(max_workers=4) as executor:
        return list(executor.map(enrich, profiles))
