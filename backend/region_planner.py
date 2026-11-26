"""목적지를 정하지 않은 요청에서 실제 검색된 활동 조합을 지역별로 비교한다."""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List

from .config import KAKAO_REST_API_KEY, SBDC_API_KEY
from .direction import haversine, calculate_bearing, get_direction
from .direction_context import annotate_land_use
from .location_context import normalize_name, resolve_place, within_region
from .merchant_catalog import industry_match, merge_merchants, search_merchants
from .menu_model import address_key, known_menu_shops, menu_rank
from .optimizer import recommend_routes
from .places import load_places
from .place_clusters import CANDIDATE_POOL_LIMIT, cluster_places
from .route_corridor import (HEADINGS, RECOMMENDATION_FACTORS, direction_rows, recommendation_rank,
                             sector_heading, unique_courses)
from .schedule import availability_warning, to_minutes, to_clock, travel_minutes
from .venue_details import annotate_menus, annotate_operating_hours, name_key

# 좌표나 시설을 만들지 않고, 이 이름으로 API에 존재하는 입구를 조회한다.
MOUNTAIN_QUERIES = ['관악산', '북한산', '아차산', '인왕산', '불암산']
SEOUL_PALACES = {'경복궁', '창덕궁', '창경궁', '덕수궁', '경희궁'}
MARKET_MENU_WORDS = ('빈대떡', '떡볶이', '칼국수', '꽈배기', '닭강정', '만두', '육회', '순대', '국수', '김밥')
ACTIVITY_QUERIES = {'swimming': '수영장', 'restaurant': '음식점', 'cafe': '카페',
                    'bowling': '볼링장', 'shower': '목욕탕', 'park': '공원', 'shopping': '쇼핑',
                    'culture': '박물관', 'night_view': '전망대', 'bar': '술집', 'subway_station': '지하철역'}
_search_cache = {}


def search_live(query: str, center: Dict | None = None, radius_km: float = 5,
                region_scope: str | None = '서울', *, sort_by_distance: bool = True, page: int = 1) -> List[Dict]:
    """기존 REST 키로 장소명·업종·좌표만 조회한다. 운영시간·가격은 만들어내지 않는다."""
    if not KAKAO_REST_API_KEY:
        return []
    params = {'query': query, 'size': 15}
    if page > 1:
        params['page'] = page
    if center:
        params.update(x=center['lng'], y=center['lat'], radius=int(radius_km * 1000))
        if sort_by_distance:
            params['sort'] = 'distance'
    cache_key = (region_scope, tuple(sorted(params.items())))
    cached = _search_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < 300:
        return [dict(p) for p in cached[1]]
    url = 'https://dapi.kakao.com/v2/local/search/keyword.json?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={'Authorization': 'KakaoAK ' + KAKAO_REST_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            documents = json.load(response).get('documents', [])
        places = []
        for p in documents:
            address = p.get('road_address_name') or p.get('address_name', '')
            if not within_region(address, region_scope) and not within_region(p.get('address_name') or '', region_scope):
                continue
            lat, lng = float(p['y']), float(p['x'])
            if not (33 <= lat <= 39 and 124 <= lng <= 132):
                continue
            distance = haversine(center['lat'], center['lng'], lat, lng) if center else 0
            if center and distance > radius_km:
                continue
            places.append({'id': 'kakao_' + str(p['id']), 'name': p['place_name'],
                           'lat': lat, 'lng': lng, 'address': address,
                           'provider_category': p.get('category_name', ''),
                           'place_url': p.get('place_url'), 'phone': p.get('phone'),
                           'distance_km': round(distance, 3), 'source': 'kakao',
                           'keywords': [p['place_name']], 'rating': None, 'hours': None,
                           'fee_krw': None, 'confidence': 0})
        _search_cache[cache_key] = (time.monotonic(), places)
        # 메모리 캐시는 작은 범위로 유지한다. 위치·여행 기록은 저장하지 않는다.
        if len(_search_cache) > 128:
            del _search_cache[next(iter(_search_cache))]
        return [dict(p) for p in places]
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError):
        # API 장애와 '검색 결과 없음'을 구분해 상위 응답에서 안내한다.
        raise RuntimeError('카카오 장소 조회에 실패했습니다. 키·호출 제한·네트워크를 확인해 주세요.') from None


def matches_activity(place: Dict, activity: Dict) -> bool:
    """검색어만으로 업종·메뉴가 충족됐다고 단정하지 않고 반환 정보를 대조한다."""
    category = activity['category']
    name = place['name'].replace('순댓국', '순대국')
    provider = place.get('provider_category', '')
    if category == 'history_museum':
        return ('박물관' in provider and any(word in name for word in ('역사', '고궁', '민속', '고고'))
                and '어린이' not in name)
    if category == 'palace':
        return (name in SEOUL_PALACES and '고궁,궁' in provider
                and all(term == name for term in activity.get('required_keywords', [])))
    if category == 'market_food':
        return ('시장' in provider.split(' > ') and name.endswith('시장')
                and not any(word in name for word in ('야시장', '시즌', '타임투어')))
    if category == 'shopping' and activity.get('request_term') == '백화점':
        return '백화점' in provider or (place.get('source') == 'sample' and '백화점' in name)
    if category == 'swimming':
        if place.get('source') == 'sample':
            return place.get('category') == 'swimming'
        return '수영장' in provider and not any(w in provider + name for w in (
            '용품', '판매', '쇼핑', '어린이', '물놀이', '워터파크', '키즈', '리버파크'))
    required = activity.get('required_keywords', [])
    if required and not all(word.replace('순댓국', '순대국') in name for word in required):
        return False
    if category == 'restaurant' and place.get('source') == 'kakao':
        category_path = {part.strip() for part in provider.split('>')}
        return '음식점' in category_path and (bool(required) or not category_path.intersection({'카페', '간식'}))
    return place.get('category') == category or ACTIVITY_QUERIES.get(category, category) in provider


def find_candidates(anchor: Dict, activity: Dict, radius: float,
                    region_scope: str | None = '서울') -> List[Dict]:
    """군집화에 필요한 각 활동의 장소를 반경 안에서 조회한다."""
    category = activity['category']
    department_store = category == 'shopping' and activity.get('request_term') == '백화점'
    culture_query = {'history_museum': '서울 역사박물관', 'palace': '서울 고궁',
                     'market_food': '서울 전통시장'}.get(category)
    query = ' '.join(activity.get('required_keywords', [])) or ACTIVITY_QUERIES.get(category, category)
    if department_store:
        query = '백화점'
    if KAKAO_REST_API_KEY:
        if culture_query:
            places = search_live(culture_query, anchor, radius, region_scope=region_scope, sort_by_distance=False)
        elif department_store:
            # 거리순 결과에서 입점 매장만 먼저 반환되는 경우를 줄인다.
            places = search_live(query, anchor, radius, region_scope=region_scope, sort_by_distance=False)
        else:
            places = search_live(query, anchor, radius, region_scope=region_scope)
    else:
        places = []
        for p in load_places():
            distance = haversine(anchor['lat'], anchor['lng'], p['lat'], p['lng'])
            if distance <= radius:
                if not region_scope or p.get('address', '').startswith(region_scope):
                    places.append({**p, 'source': 'sample', 'distance_km': round(distance, 3)})
    found = [{**place, 'category': category} for place in places if matches_activity(place, activity)]
    if category == 'market_food':
        return markets_with_food(found, region_scope)
    # 첫 장이 역이나 건물 한 곳에 몰리면 같은 반경에서 다음 결과로 식사 선택지를 보완한다.
    if KAKAO_REST_API_KEY and category == 'restaurant' and len(places) == CANDIDATE_POOL_LIMIT:
        clusters = cluster_places(found)
        for by_distance, page in ((False, 1), (True, 2), (True, 3)):
            if len(clusters) >= 3:
                break
            try:
                extra = search_live(query, anchor, radius, region_scope=region_scope,
                                    page=page, sort_by_distance=by_distance)
            except RuntimeError:
                break  # 추가 조회 실패 시 이미 확인한 후보를 계속 사용한다.
            found.extend({**p, 'category': category} for p in extra if matches_activity(p, activity))
            clusters = cluster_places(found)
            if by_distance and len(extra) < CANDIDATE_POOL_LIMIT:
                break

        # 15곳 제한으로 다시 한 건물만 남지 않게 가장 가까운 군집별 한 곳을 먼저 확보한다.
        clusters.sort(key=lambda group: haversine(anchor['lat'], anchor['lng'],
                                                  group['center']['lat'], group['center']['lng']))
        representatives = [group['representative'] for group in clusters[:5]]
        priority = {place['id'] for place in representatives}
        found = representatives + sorted((p for p in found if p['id'] not in priority),
                                         key=lambda p: p['distance_km'])
    else:
        found.sort(key=lambda p: p['distance_km'])
    unique = {p['id']: p for p in found}
    return sorted(list(unique.values())[:CANDIDATE_POOL_LIMIT], key=lambda p: p['distance_km'])


def markets_with_food(markets: List[Dict], region_scope: str | None, terms: list | None = None) -> List[Dict]:
    """시장점 주변의 음식점·간식을 조회하고 확인 가능한 먹거리만 제안한다."""
    nearby_markets = sorted(markets, key=lambda p: p['distance_km'])[:5]

    def lookup(market):
        try:
            shops = search_live(market['name'] + ' 음식점', market, .2, region_scope=region_scope,
                                sort_by_distance=False)
        except RuntimeError:
            shops = []
        # 분식·간식 상호에서 구체적인 먹거리도 함께 찾는다.
        if sum(any(word in shop['name'] for word in MARKET_MENU_WORDS) for shop in shops) < 3:
            try:
                shops += search_live(market['name'] + ' 분식', market, .2, region_scope=region_scope,
                                     sort_by_distance=False)
            except RuntimeError:
                pass
        options = []
        for shop in {p['id']: p for p in shops}.values():
            category = shop.get('provider_category', '').split(' > ')
            if '음식점' not in category or '카페' in category:
                continue
            menu = next((word for word in MARKET_MENU_WORDS if word in shop['name']), None)
            options.append({'id': shop['id'], 'name': shop['name'], 'menu_hint': menu, 'place_url': shop.get('place_url'),
                            'distance_m': round(shop['distance_km'] * 1000), 'phone': shop.get('phone')})
        options.sort(key=lambda option: (not option['menu_hint'], option['distance_m']))
        distinct_menu = {}
        for option in options:
            if option['menu_hint']:
                distinct_menu.setdefault(option['menu_hint'], option)
        preferred = list(distinct_menu.values())
        preferred.extend(option for option in options if option not in distinct_menu.values())
        if not preferred:
            return None
        result = {**market, 'food_options': preferred[:3]}
        if terms:
            by_id = {p['id']: p for p in shops}
            detailed = annotate_menus([by_id[option['id']] for option in preferred[:3]], terms)
            result['food_options'] = [{**option, **{key: shop.get(key) for key in (
                'menus', 'menu_status', 'menu_source', 'menu_evidence', 'menu_model', 'menu_match_hint')}}
                                      for option, shop in zip(preferred, detailed)]
            result['menu_status'] = 'matched' if any(shop['menu_status'] == 'matched' for shop in detailed) else 'unconfirmed'
        return result

    with ThreadPoolExecutor(max_workers=3) as executor:
        return [market for market in executor.map(lookup, nearby_markets) if market]


def discover_history_museums() -> List[Dict]:
    places = search_live('서울 역사박물관', region_scope='서울')
    museums = [{**p, 'category': 'history_museum'} for p in places
               if matches_activity(p, {'category': 'history_museum'})]
    return museums[:3]


def discover_anchors() -> List[Dict]:
    """서울의 5개 산 주변을 1차 비교하되, API에서 확인한 입구만 사용한다."""
    if not KAKAO_REST_API_KEY:
        return [{**p, 'source': 'sample', 'region_name': p['name']} for p in load_places()
                if p['category'] == 'hiking' and '하산' not in p['name']][:5]

    def lookup(mountain):
        results = search_live('서울 ' + mountain + ' 등산로 입구')
        return next(({**p, 'category': 'hiking', 'region_name': mountain, 'distance_km': 0}
                     for p in results if mountain in p['name'] and '입구' in p['name']), None)

    with ThreadPoolExecutor(max_workers=5) as executor:
        anchors = list(executor.map(lookup, MOUNTAIN_QUERIES))
    return [p for p in anchors if p]


CONTEXT_QUERIES = {**ACTIVITY_QUERIES, 'baseball_game': '야구장', 'baseball_event': '야구장',
                   'history_museum': '역사박물관', 'palace': '고궁',
                   'market_food': '전통시장', 'cinema': '영화관', 'amusement': '놀이공원',
                   'hiking': '등산로 입구', 'karaoke': '노래방'}
VENUE_TYPES = {'hiking': ('등산로', '산', '산입구'), 'shopping': ('백화점', '쇼핑센터', '아울렛', '복합쇼핑몰', '쇼핑'),
               'cinema': ('영화관', '극장'), 'amusement': ('놀이공원', '테마파크', '키즈카페', '워터파크'),
               'culture': ('박물관', '미술관', '전시관', '문화시설', '공연장'),
               'palace': ('고궁', '궁'), 'shower': ('목욕탕', '사우나', '찜질방'),
               'bar': ('술집', '주점', '호프', '바'), 'night_view': ('전망대', '전망시설'),
               'karaoke': ('노래방', '코인노래방', '노래연습장', '코인노래연습장')}


def context_matches(place: dict, activity: dict) -> bool:
    category = activity['category']
    words = {word.strip() for word in re.split('[>,]', place.get('provider_category') or '')}
    if category in ('baseball_game', 'baseball_event'):
        return '야구장' in words or ('경기장' in words and '고척스카이돔' in normalize_name(place['name']))
    if category == 'palace' and within_region(place.get('address') or '', '서울'):
        # 서울의 고궁 추천에서는 검색에 함께 올라오는 개별 전각·시설을 제외한다.
        return matches_activity(place, activity)
    if category in ('history_museum', 'market_food', 'swimming'):
        return matches_activity(place, activity)
    if industry_match(list(words), activity.get('industry_terms', [])):
        return True
    if category in VENUE_TYPES:
        if category == 'shopping' and '백화점' in (activity.get('venue_kind') or activity.get('request_term') or ''):
            return '백화점' in words
        if category == 'hiking' and '입구' in place['name'] and '등산로' in words:
            return True
        return bool(words.intersection(VENUE_TYPES[category]))
    if category in ('other', 'meeting'):
        kind = name_key(activity.get('venue_kind') or '')
        return bool(kind and any(kind in name_key(word) for word in words))
    return matches_activity(place, activity)


def fixed_candidate(activity: dict, existing: list, center: dict, radius: float,
                    scope: str | None) -> list[dict]:
    name = activity['location']
    location = next((location for location in existing if location and normalize_name(location.get('name') or '')
                     == normalize_name(name)), None) or resolve_place(name)
    if not location or location.get('source') != 'kakao' or not within_region(location.get('address') or '', scope):
        return []
    lat, lng = location['latitude'], location['longitude']
    distance = haversine(center['lat'], center['lng'], lat, lng) if center else 0
    if distance > radius:
        return []
    return [{'id': location.get('place_id') or f'place_{lat}_{lng}', 'name': name,
             'lat': lat, 'lng': lng, 'address': location.get('address'), 'source': 'kakao',
             'place_url': location.get('place_url'), 'phone': location.get('phone'),
             'category': activity['category'], 'distance_km': round(distance, 3)}]


def search_listed_menus(center: dict, radius: float, scope: str | None, terms: list[str]) -> list[dict]:
    """공개 목록의 메뉴를 역검색하되 상호·주소·반경이 검증된 곳만 추가한다."""
    entries = known_menu_shops(terms, center.get('address') or '')[:8]
    if not KAKAO_REST_API_KEY or not entries:
        return []

    def lookup(entry):
        title, road = entry
        try:
            places = search_live(title, center, radius, region_scope=scope)
        except RuntimeError:
            return None
        return next((place for place in places
                     if name_key(place['name']) == name_key(title) and address_key(place['address']) == road), None)

    with ThreadPoolExecutor(max_workers=4) as executor:
        return [place for place in executor.map(lookup, entries) if place]


def context_candidates(center: dict | None, activity: dict, radius: float, scope: str | None,
                       start: dict | None = None, existing: list | None = None,
                       return_location: dict | None = None, *, include_venue_query: bool = False) -> list[dict]:
    """모델이 해석한 검색어로 찾되 군집에 쓰는 좌표는 실제 장소 조회에서만 가져온다."""
    category = activity['category']
    terms = activity.get('menu_terms', [])
    if category in ('return_to_start', 'return_to_current'):
        point = start if category == 'return_to_start' else return_location
        default_name = '현재 위치' if category == 'return_to_current' else '출발지'
        return [{'id': category, 'name': point.get('name') or default_name,
                 'lat': point['latitude'], 'lng': point['longitude'], 'category': category,
                 'source': 'user', 'distance_km': 0}] if point else []
    if activity.get('fixed_location') and activity.get('location'):
        candidates = fixed_candidate(activity, existing or [], center, radius, scope)
    else:
        specific = activity.get('search_query')
        industries = activity.get('industry_terms', [])
        query_alternates = activity.get('search_queries', [])
        venue_query = CONTEXT_QUERIES.get(category) or activity.get('venue_kind')
        queries = dict.fromkeys(query for query in (venue_query if include_venue_query else None,
                                                   specific, *query_alternates) if query)
        if not queries and venue_query:
            queries = {venue_query: None}
        candidates = []
        kakao_error = None

        def lookup(query, extra_distance=False):
            scoped_query = f'{scope} {query}' if not center and scope and scope not in query else query
            records = search_live(scoped_query, center, radius, region_scope=scope, sort_by_distance=False)
            if center and extra_distance:
                records += search_live(scoped_query, center, radius, region_scope=scope)
            return [{**place, 'category': category} for place in records if context_matches(place, activity)]

        for i, query in enumerate(queries):
            try:
                candidates.extend(lookup(query, extra_distance=(i == 0)))
            except RuntimeError as error:
                kakao_error = error
        if not candidates and venue_query and venue_query not in queries:
            try:
                candidates = [{**place, 'venue_condition_unconfirmed': specific}
                              for place in lookup(venue_query, extra_distance=True)]
            except RuntimeError as error:
                kakao_error = error
        if center and terms and category in ('restaurant', 'cafe', 'bar'):
            candidates.extend({**place, 'category': category}
                              for place in search_listed_menus(center, radius, scope, terms))
        candidates = list({place['id']: place for place in candidates}.values())
        if center and industries and category not in ('baseball_game', 'baseball_event', 'history_museum', 'palace', 'market_food'):
            try:
                merchants = search_merchants(center, radius, scope, industries)
            except (OSError, ValueError, TypeError, KeyError):
                merchants = []
            merchants = [{**place, 'category': category} for place in merchants]
            if specific:
                merchants = [{**place, 'venue_condition_unconfirmed': specific}
                             if not industry_match([place['name'], place['merchant'].get('industry')], [specific]) else place
                             for place in merchants]
            candidates = merge_merchants(candidates, merchants)
        if not candidates and kakao_error:
            raise kakao_error
    if category == 'market_food':
        return markets_with_food(candidates, scope, terms)
    if category in ('restaurant', 'cafe', 'bar'):
        candidates = annotate_menus(candidates, terms, limit=8 if terms else 5)
        if terms:
            return sorted(candidates, key=lambda place: (*menu_rank(place), place.get('distance_km', 0)))[:CANDIDATE_POOL_LIMIT]
    return annotate_operating_hours(candidates, category)


def recommend_regions(request: Dict) -> Dict:
    """필수 활동 충족률·충돌·직선거리 추정으로 지역 후보를 비교한다."""
    activities = request.get('activities', [])
    explicit_center = request.get('search_center')
    contextual = request.get('contextual', False)
    scope = request.get('region_scope')
    radius = request.get('radius_km', 5)
    existing = [explicit_center, request.get('start_location'), request.get('route_goal'),
                *(activity.get('search_anchor') for activity in activities)]
    return_location = request.get('return_location')
    if return_location and any(return_location.get(key) is None for key in ('latitude', 'longitude')):
        return_location = None
    if not activities:
        return {'regions': [], 'warnings': ['활동 조건을 입력해 주세요.']}
    if explicit_center and any(explicit_center.get(k) is None for k in ('latitude', 'longitude')):
        return {'regions': [], 'warnings': ['목적지 좌표를 먼저 확인해 주세요.']}
    first_category = activities[0]['category']
    if not contextual and not explicit_center and (scope != '서울' or first_category not in ('hiking', 'history_museum')):
        return {'regions': [], 'warnings': ['지역 비교는 서울의 산행이나 역사 박물관에서 시작하는 일정을 지원합니다.'],
                'note': '장소를 확인할 수 없는 활동은 임의로 만들지 않습니다.'}
    try:
        if contextual:
            if explicit_center:
                anchors = [{'id': 'search_center', 'name': explicit_center.get('name') or '지정 장소',
                            'lat': explicit_center['latitude'], 'lng': explicit_center['longitude'],
                            'source': explicit_center.get('source') or 'user'}]
            else:
                anchors = []
                for place in context_candidates(None, activities[0], radius, scope, existing=existing):
                    if not any(haversine(place['lat'], place['lng'], other['lat'], other['lng']) < .2 for other in anchors):
                        anchors.append(place)
                    if len(anchors) == 3:
                        break
        elif explicit_center:
            center_point = {'lat': explicit_center['latitude'], 'lng': explicit_center['longitude']}
            destination = request.get('destination_name') or explicit_center.get('name') or ''
            entrances = search_live(destination + ' 등산로 입구', center_point, request.get('radius_km', 5),
                                    region_scope=request.get('region_scope')) if KAKAO_REST_API_KEY and activities[0]['category'] == 'hiking' else []
            entrances = [p for p in entrances if destination.replace(' ', '') in p['name'].replace(' ', '') and '입구' in p['name']]
            if not entrances and KAKAO_REST_API_KEY and activities[0]['category'] == 'hiking':
                entrances = [p for p in search_live(destination + ' 입구', center_point,
                             request.get('radius_km', 5), region_scope=request.get('region_scope'))
                             if destination.replace(' ', '') in p['name'].replace(' ', '') and '입구' in p['name']]
            anchors = [{**p, 'category': 'hiking', 'region_name': p['name'], 'entry_confirmed': True} for p in entrances[:3]]
            if not anchors:
                anchors = [{'id': 'resolved_destination', 'name': destination or '지정 목적지',
                            **center_point, 'category': activities[0]['category'], 'distance_km': 0,
                            'source': explicit_center.get('source') or 'user', 'confidence': 0,
                            'keywords': [destination], 'region_name': destination, 'entry_confirmed': False}]
        else:
            anchors = discover_history_museums() if first_category == 'history_museum' else discover_anchors()
    except RuntimeError as error:
        return {'regions': [], 'warnings': [str(error)], 'note': '실제 장소 조회 실패'}
    def evaluate(anchor):
        center = {'lat': explicit_center['latitude'], 'lng': explicit_center['longitude'],
                  'address': explicit_center.get('address')} if explicit_center else anchor
        first_is_anchor = (not explicit_center or (not contextual and first_category == 'hiking'))
        groups = [[anchor]] if first_is_anchor else []
        search_center = explicit_center or {'type': 'region_candidate', 'name': anchor['name'],
                                           'latitude': anchor['lat'], 'longitude': anchor['lng'], 'source': anchor['source']}
        start = request.get('start_location')
        has_start = start and all(start.get(k) is not None for k in ('latitude', 'longitude'))
        needs_start = request.get('current_location_requested') and not has_start
        needs_return = any(a['category'] == 'return_to_current' for a in activities) and not return_location
        needs_origin = needs_start or needs_return
        if not has_start:
            start = None if needs_start else {**search_center, 'type': 'region_candidate'}
        issues = ['직선거리 기반 이동 추정 · 실제 길찾기 확인 필요']
        if first_category == 'hiking':
            issues.append('산행 코스의 상행·하행 시간과 실제 하산 출구 확인 필요')
        if anchor['source'] == 'sample':
            issues.append('API 키가 없어 데모 데이터만 비교했습니다.')
        if not contextual and explicit_center and activities[0]['category'] == 'hiking' and not anchor.get('entry_confirmed'):
            issues.append('산의 위치만 확인했습니다. 실제 등산로 입구 선택이 필요합니다.')
        current_anchor = center
        search_anchors = {(center['lat'], center['lng']):search_center}
        last_anchor_index = 0
        for index, activity in enumerate(activities[len(groups):], start=len(groups)):
            try:
                if contextual:
                    local = activity.get('search_anchor')
                    if local and local.get('latitude') is not None and local.get('longitude') is not None:
                        lat, lng = local['latitude'], local['longitude']
                        current_anchor = {'lat':lat, 'lng':lng, 'address':local.get('address')}
                        search_anchors[(lat, lng)] = local
                        last_anchor_index = index
                    local_scope = local['address'] if local and local.get('type') == 'area' and local.get('address') and not activity.get('fixed_location') else scope
                    # 관람 일정 미확인 시 구장 안 매장과 주변 업소를 함께 비교한다.
                    event_meal = (activity['category'] == 'restaurant' and index > 0
                                  and bool(activities[index - 1].get('visit_warning')))
                    places = context_candidates(current_anchor, activity, radius, local_scope, start, existing, return_location,
                                               include_venue_query=event_meal)
                elif explicit_center and activity.get('fixed_location') and activity.get('location') == explicit_center.get('name'):
                    places = [{**anchor, 'category': activity['category']}]
                elif explicit_center:
                    places = find_candidates(center, activity, radius, region_scope=request.get('region_scope'))
                else:
                    places = find_candidates(center, activity, radius)
            except RuntimeError as error:
                places = []
                issues.append(str(error))
            groups.append(places)
        for index, (activity, places) in enumerate(zip(activities, groups)):
            start_minute = to_minutes(activity.get('start_time')) if activity.get('fixed_time') else None
            duration = activity.get('duration_minutes')
            end_minute = start_minute + duration if start_minute is not None and duration is not None else None
            checked = []
            for place in places:
                row = dict(place)
                if activity.get('visit_warning'):
                    row['event_warning'] = activity['visit_warning']
                warning = availability_warning(row, request.get('travel_date'), start_minute, end_minute)
                if warning:
                    row['visit_warning'] = warning
                checked.append(row)
            groups[index] = checked
        missing = [a.get('keyword') or a['category'] for a, group in zip(activities, groups)
                   if a.get('required', True) and not group]
        covered = sum(any(not p.get('visit_warning') for p in group) for group in groups)
        first_leg = {'status': 'needs_origin' if needs_origin else 'estimate',
                     'planned_departure': request.get('departure_time'), 'estimated_minutes': None}
        plan_activities = [dict(a) for a in activities]
        if start:
            distance = haversine(start['latitude'], start['longitude'], anchor['lat'], anchor['lng'])
            minutes = travel_minutes(distance, (request.get('transport_modes') or ['walking'])[0]) if distance > .001 else 0
            first_leg.update(estimated_minutes=minutes, distance_km=round(distance, 3))
            departure = to_minutes(request.get('departure_time'))
            if departure is not None:
                arrival = departure + minutes + (10 if minutes else 0)
                first_leg['estimated_arrival'] = to_clock(arrival)
                end = to_minutes(plan_activities[0].get('end_time'))
                if not contextual and activities[0]['category'] == 'hiking' and end is not None:
                    plan_activities[0].update(duration_minutes=max(1, end - arrival), duration_estimated=True,
                                              duration_source='출발 후 이동 추정을 제외한 산행 가능 시간창')
            issues.append('출발 위치에서 목적지까지의 첫 이동시간도 직선거리 기반 추정입니다.')
        if needs_origin:
            issues.append('현재 위치 또는 직접 선택한 위치가 있어야 출발·복귀 구간과 시간표를 계산할 수 있습니다.')
        # 출발지를 모르면 목적지 내부 조합만 비교하며 첫 이동과 시간표는 만들지 않는다.
        comparison_start = start or {'latitude': anchor['lat'], 'longitude': anchor['lng']}
        route_request = {**request, 'activities': plan_activities, 'start_location': comparison_start,
                         'search_center': search_center}
        base_name = ('출발지' if comparison_start.get('type') in ('current_location', 'custom', 'map')
                     else comparison_start.get('name') or search_center['name'])
        if len(search_anchors) > 1:
            direction_center = next(reversed(search_anchors.values()))
            direction_activity_id = next((a['id'] for a in reversed(activities[last_anchor_index:])
                                          if not a.get('fixed_location') and a['category'] not in ('return_to_start', 'return_to_current')), None)
            route_request.update(direction_center=direction_center, direction_activity_id=direction_activity_id)
            base_name = direction_center['name']
        recommendation_review = {'base': base_name}
        if contextual and missing:
            requested = request.get('requested_bearing')
            directions = HEADINGS if requested is None else (sector_heading(requested),)
            rows = direction_rows('not_requested')
            for heading in directions:
                rows[heading].update(status='missing_clusters', missing=missing)
            recommendation_review.update(kind='recommendation', rows=rows)
        routes = recommend_routes(route_request, groups, include_infeasible=True, preview=needs_origin,
                                  direction_review=recommendation_review if contextual else None) if not missing else []
        # 방문이 어려운 지점도 지도에서 확인할 수 있도록 방문 순서대로 참고 동선을 만든다.
        prefix = next((i for i, group in enumerate(groups) if not group), len(groups))
        reference_groups = groups[:prefix]
        warned = next((i for i, group in enumerate(reference_groups) if any(p.get('visit_warning') for p in group)), None)
        references = []
        reference_review = {}
        if warned is not None or (not routes and any(p.get('operating_hours') for g in reference_groups for p in g)):
            if warned is not None:
                reference_groups[warned] = [p for p in reference_groups[warned] if p.get('visit_warning')]
            references = recommend_routes({**route_request, 'activities': plan_activities[:prefix]},
                                          reference_groups, preview=needs_origin, reference=True, direction_review=reference_review)
            for rank, route in enumerate(references, 1):
                route.update(reference_rank=rank, partial=prefix < len(groups))
            if references and references[0]['partial']:
                issues.append('확인된 경유지까지의 참고 동선입니다. 빠진 구간은 장소 또는 위치를 확인해 주세요.')
        if contextual and not routes and not missing:
            issues.append('검색한 활동 군집으로 방향 범위와 일정 조건을 함께 충족하는 경로가 없습니다.')
        # 정상 추천과 혼동되지 않도록 검토용 일정에 확인 상태를 명시한다.
        draft = routes[0] if routes and not needs_origin else None
        for route in routes + references:
            route_issues = list(issues)
            timeline = (route['schedule'] or {}).get('timeline', [])
            for index, (activity, node) in enumerate(zip(activities, route['nodes'])):
                place = node['place']
                if place.get('visit_warning'):
                    route_issues.append(f"{place['name']}: {place['visit_warning']['reason']}")
                elif (not activity.get('official_event_time')
                      and not (timeline and timeline[index]['availability_checked'])
                      and activity['category'] not in ('return_to_start', 'return_to_current')):
                    route_issues.append(f"{place['name']}: 방문일 영업시간·이용 가능 여부 확인 필요")
                if activity['category'] == 'swimming':
                    route_issues.append(f"{place['name']}: 자유수영 시간·입장 조건·환복시간 확인 필요")
                if activity.get('required_keywords') and activity['category'] == 'restaurant':
                    route_issues.append(f"{place['name']}: 요청 메뉴의 당일 판매 여부 확인 필요")
                if activity.get('menu_terms') and place.get('menu_status') != 'matched':
                    route_issues.append(f"{place['name']}: 요청 메뉴 {', '.join(activity['menu_terms'])} 확인 필요")
                if place.get('venue_condition_unconfirmed'):
                    route_issues.append(f"{place['name']}: 세부 조건 ‘{place['venue_condition_unconfirmed']}’ 확인 필요")
                if activity['category'] == 'market_food':
                    route_issues.append(f"{place['name']}: 시장 주변 먹거리 후보의 메뉴·방문일 영업 여부 확인 필요")
            route.update(verification_status='unverified', score=None, estimated_cost_krw=None,
                         data_confidence=0, cautions=route_issues)
            if contextual:
                route['start_location'] = start
                route['region_id'] = anchor['id']
            if route['schedule']:
                route['schedule'].update(verified_feasible=False,
                    timing_feasible_estimate=route['schedule']['feasible'], feasible=None,
                    note='입력 시간창과 직선거리 이동 추정으로 만든 검토용 일정입니다. 실제 방문 가능성은 미검증입니다.')
        if draft:
            issues = draft['cautions']
        flat = {p['id']: p for group in groups for p in group}
        for group in groups:
            flat.update((p['id'], p) for p in group if p.get('visit_warning'))
        for reference in references:
            for node in reference['nodes']:
                place = node['place']
                if place.get('visit_warning'):
                    flat[place['id']] = place
        for place in flat.values():
            place['bearing'] = calculate_bearing(center['lat'], center['lng'], place['lat'], place['lng'])
            place['direction'] = get_direction(place['bearing'])
        annotate_land_use(recommendation_review, route_request.get('direction_center') or comparison_start, radius)
        annotate_land_use(reference_review, reference_review.pop('land_use_origin', None), radius)
        return {'id': anchor['id'], 'name': anchor.get('region_name', anchor['name']),
                'search_center': search_center, 'start_location': start,
                'search_anchors': list(search_anchors.values()),
                'first_leg': first_leg,
                'evaluated_activities': plan_activities,
                'coverage_percent': round(covered / len(activities) * 100), 'missing_activities': missing,
                'status': 'reference_available' if references and not routes else 'needs_origin' if needs_origin else 'missing_places' if missing else ('no_corridor' if contextual and not routes else
                           'missing_places' if not routes else 'needs_origin' if needs_origin else
                           'time_conflict' if draft and draft['schedule']['conflicts'] else 'needs_confirmation'),
                'candidate_groups': [{'activity_id': a['id'], 'category': a['category'], 'places': group}
                                     for a, group in zip(activities, groups)],
                'draft_route': draft, 'routes': routes, 'reference_routes': references,
                'reference_route': references[0] if references else None,
                'direction_reviews': [review for review in (recommendation_review, reference_review) if review.get('rows')],
                'places': list(flat.values()), 'checks_needed': issues,
                'radius_km': radius}

    with ThreadPoolExecutor(max_workers=4) as executor:
        regions = list(executor.map(evaluate, anchors))
    if contextual:
        ranked = unique_courses([route for region in regions for route in region['routes']])
        recommendations = ranked[:5]
        for rank, route in enumerate(ranked, 1):
            route['rank'] = rank
        for region in regions:
            recommendation_review = next((item for item in region['direction_reviews'] if item['kind'] == 'recommendation'), None)
            if recommendation_review is not None:
                for route in region['routes']:
                    row = recommendation_review['rows'][route['corridor']['heading']]
                    rank = route.get('rank')
                    row.update(status='selected' if rank is not None and rank <= 5 else 'rank_limit' if rank is not None else 'duplicate_route',
                               rank=rank, distance_km=route['total_distance_km'], minutes=route['total_travel_minutes'])
                    if rank is not None and rank > 5:
                        row['factor'] = next((name for name, a, b in zip(RECOMMENDATION_FACTORS, recommendation_rank(route),
                                                                       recommendation_rank(recommendations[-1])) if a != b), None)
            region['routes'] = [route for route in recommendations if route['region_id'] == region['id']]
            region['draft_route'] = next((route for route in region['routes'] if not route.get('preview')), None)
        regions.sort(key=lambda region: (not region['routes'],
                     recommendations.index(region['routes'][0]) if region['routes'] else len(region['missing_activities'])))
        has_merchant = any(place.get('merchant') for region in regions for place in region['places'])
        merchant_status = 'matched' if has_merchant else 'unconfirmed' if SBDC_API_KEY else 'unconfigured'
        return {'regions': regions, 'recommendations': recommendations, 'alternative_routes': ranked[5:],
                'searched_region_count': len(regions), 'merchant_lookup': merchant_status,
                'scanned_headings': len(HEADINGS) if request.get('requested_bearing') is None else 1,
                'direction_candidate_count': len(ranked),
                'warnings': [] if regions else ['방문 지역에서 첫 활동에 맞는 장소를 확인하지 못했습니다.'],
                'note': '폭 10° 방향별로 비교하며 필요할 때 양옆 구역을 함께 탐색합니다. 이동시간은 추정치입니다.'}
    regions.sort(key=lambda region: (len(region['missing_activities']), region['status'] == 'time_conflict',
                                     (region['draft_route'] or {}).get('total_travel_minutes', 100000)))
    anchor_label = '역사 박물관' if first_category == 'history_museum' else '등산로 입구'
    note = '지정 목적지의 선택 반경 내 실제 시설 후보입니다.' if explicit_center else f'서울의 {anchor_label} 주변 활동 후보를 비교했습니다.'
    return {'regions': regions[:3], 'searched_region_count': len(regions),
            'warnings': [] if regions else [f'조건에 맞는 서울의 {anchor_label}을 찾지 못했습니다.'],
            'note': note + (' 영업시간·산행시간·실제 경로는 확인이 필요합니다.' if first_category == 'hiking'
                            else ' 관람·영업시간과 실제 경로는 확인이 필요합니다.')}
