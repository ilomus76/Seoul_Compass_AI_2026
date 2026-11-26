"""질문의 검색 중심과 실제 출발지를 구분하고 확인된 좌표로 변환한다."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict

from .config import KAKAO_REST_API_KEY
from .direction import haversine
from .places import load_places


def normalize_name(name: str) -> str:
    """조사와 띄어쓰기 차이를 제외하고 장소명을 비교한다."""
    return re.sub(r"\s+", "", name).casefold()


def within_region(address: str, scope: str | None) -> bool:
    if not scope:
        return True

    def administrative_name(word):
        return re.sub(r'(특별시|광역시|특별자치시|특별자치도|[시군구도])$', '', word) or word

    region = [administrative_name(word) for word in scope.split()]
    address_words = [administrative_name(word) for word in address.split()[:3]]
    return any(address_words[i:i + len(region)] == region for i in range(len(address_words)))


def normalize_request_text(text: str) -> str:
    """장소에서 '발해서'처럼 출발의 앞 글자가 빠진 문맥만 제한적으로 보정한다."""
    return re.sub(r'(에서|부터)(\s*)발(?=해서|하여|해|할)', r'\1\2출발', text)


def context_names(text: str) -> Dict:
    """명시한 기준점 → 첫 산행지 → 약속 장소 → 첫 장소 순으로 해석한다."""
    text = normalize_request_text(text)
    token = r"([가-힣A-Za-z0-9·_-]+?)"
    explicit_matches = re.finditer(token + r"(?:을|를|에서|으로|로)?\s*(?:기준|중심|주변|근처|근방|인근|일대)", text)
    # '5km 근방', '반경 주변', '현재 위치 근처'는 장소 이름이 아니다.
    explicit = next((m for m in explicit_matches
                     if not re.fullmatch(r'\d+(?:km|키로|킬로)?', m.group(1), re.I)
                     and m.group(1) not in ('반경', '위치', '현재위치', '내위치', '여기', '이곳', '그곳', '근처', '주변')), None)
    departure = re.search(token + r"(?:에서|부터)\s*(?:출발|시작)", text)
    hike = re.search(r"([가-힣]+산)(?:에서|을|에|으로|로)?\s*(?:등산|산행|오르|올라|올랐)", text)
    mountain = next((m for m in re.finditer(r'([가-힣A-Za-z0-9]+산)(?=으로|로|에서|을|에|\s|$)', text)
                     if m.group(1) not in ('등산', '하산', '예산', '계산')), None)
    implicit_hike = bool(mountain and re.search(r'내려|하산|산행|등산|정상', text[mountain.end():]))
    destination = re.search(token + r'(?:으로|로)\s*.{0,35}?(?:출발|이동|향해|가서)', text)
    uses_current = bool(re.search(r'(?:지금\s*위치|현재\s*위치|현\s*위치|여기)(?:에서|부터)', text))
    if departure and departure.group(1) in ('위치', '현재위치', '지금위치', '여기'):
        departure = None
    mentions = []
    # 샘플에 있는 이름은 좌표를 꾸며내지 않고 그대로 조회할 수 있다.
    names = set()
    for place in load_places():
        names.add(place['name'])
        for word in place.get('keywords', []):
            if word.endswith(('역', '산')) and word not in ('등산', '하산'):
                names.add(word)
    for name in names:
        position = text.find(name)
        if position >= 0:
            mentions.append((position, name))
    for match in re.finditer(r"[가-힣A-Za-z0-9]+역", text):
        if match.group() not in ('지역', '구역', '권역', '지하철역'):
            mentions.append((match.start(), match.group()))
    mentions.sort(key=lambda item: (item[0], -len(item[1])))
    station = next((name for _, name in mentions if name.endswith('역')), None)
    if explicit:
        center, reason = explicit.group(1), '질문에 명시한 검색 기준점'
    elif destination:
        center, reason = destination.group(1), '질문에 명시한 이동 목적지'
    elif implicit_hike:
        center, reason = mountain.group(1), '하산 문맥으로 해석한 산행 목적지'
    elif departure:
        center, reason = departure.group(1), '질문에 명시한 출발지'
    elif hike:
        center, reason = hike.group(1), '일정의 첫 산행 장소'
    elif station and re.search(r'만나|만날|약속|미팅', text):
        center, reason = station, '질문에 명시한 약속 장소'
    elif mentions:
        center, reason = mentions[0][1], '질문에서 처음 언급한 장소'
    else:
        center, reason = None, None
    radius_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:km|㎞|킬로미터|키로|킬로)', text, re.I)
    radius = float(radius_match.group(1)) if radius_match else None
    return {'center_name': center, 'reason': reason,
            'departure_name': departure.group(1) if departure else (hike.group(1) if hike and not uses_current else None),
            'hiking_departure': bool(hike and not departure and not uses_current), 'radius_km': radius,
            'uses_current_location': uses_current, 'mountain_name': mountain.group(1) if mountain else None,
            'implicit_hiking': implicit_hike}


def resolve_place(name: str, hiking: bool = False, *, stadium_near: tuple[float, float] | None = None) -> Dict | None:
    """로컬 샘플 또는 기존 카카오 REST 키로 조회한 장소의 좌표만 사용한다."""
    wanted = normalize_name(name)
    matches = []
    for place in load_places():
        aliases = [place['name'], place.get('name_en', '')]
        aliases.extend(word for word in place.get('keywords', [])
                       if word.endswith(('역', '산')) and word not in ('등산', '하산'))
        normalized = [normalize_name(alias) for alias in aliases]
        if wanted in normalized or (wanted.startswith('서울') and wanted[2:] in normalized):
            if not hiking or place['category'] == 'hiking':
                matches.append(place)
    sample_match = None
    if matches:
        # 등산 시작점은 같은 산의 하산 지점 대신 입구를 선택한다.
        matches.sort(key=lambda place: (place['name'] != name, '입구' not in place['name']))
        place = matches[0]
        sample_match = {'type': 'context', 'name': name, 'resolved_name': place['name'],
                'latitude': place['lat'], 'longitude': place['lng'], 'source': 'sample',
                'note': '데모 장소 좌표입니다. 실제 위치 확인이 필요합니다.'}
    if stadium_near:
        sample_match = None
    if not KAKAO_REST_API_KEY:
        return sample_match
    query = name + (' 등산로 입구' if hiking else '')
    params = {'query': query, 'size': 5}
    if stadium_near:
        params.update(x=stadium_near[1], y=stadium_near[0], radius=700)
    url = 'https://dapi.kakao.com/v2/local/search/keyword.json?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={'Authorization': 'KakaoAK ' + KAKAO_REST_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            documents = json.load(response).get('documents', [])
        # 동일 명칭의 여러 지역이 있으면 첫 검색 결과를 임의로 확정하지 않는다.
        exact = [p for p in documents if normalize_name(p['place_name']) == wanted
                 or (normalize_name(p['place_name']).startswith(wanted) and
                     re.fullmatch(r'\d+호선', normalize_name(p['place_name'])[len(wanted):]))]
        if hiking:
            exact = [p for p in documents if wanted in normalize_name(p['place_name']) and '입구' in p['place_name']]
        if stadium_near:
            # API 좌표와 가까운 같은 이름의 야구장을 골라 매표소와 좌석을 제외한다.
            exact = [p for p in documents if wanted in normalize_name(p['place_name'])
                     and any(word.strip() in ('야구장', '프로야구장', '경기장')
                             for word in p.get('category_name', '').split('>'))
                     and haversine(*stadium_near, float(p['y']), float(p['x'])) <= .7]
        if not exact:
            return sample_match
        place = exact[0]
        if any(haversine(float(place['y']), float(place['x']), float(p['y']), float(p['x'])) > .3 for p in exact[1:]):
            return None
        lat, lng = float(place['y']), float(place['x'])
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return None
        return {'type': 'context', 'name': name, 'resolved_name': place['place_name'],
                'latitude': lat, 'longitude': lng, 'source': 'kakao',
                'address': place.get('road_address_name') or place.get('address_name'),
                'place_id': 'kakao_' + str(place['id']) if place.get('id') else None,
                'place_url': place.get('place_url'), 'phone': place.get('phone'),
                'provider_category': place.get('category_name', '')}
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError):
        return sample_match


def resolve_area(name: str, scope: str | None = None) -> Dict | None:
    """행정구역 좌표는 주소 검색의 유일한 일치 결과로 확인한다."""
    if not KAKAO_REST_API_KEY or not name.strip():
        return None
    query = f'{scope} {name}' if scope and not normalize_name(name).startswith(normalize_name(scope)) else name
    params = urllib.parse.urlencode({'query': query, 'size': 10})
    request = urllib.request.Request('https://dapi.kakao.com/v2/local/search/address.json?' + params,
                                    headers={'Authorization': 'KakaoAK ' + KAKAO_REST_API_KEY})
    wanted = normalize_name(name.split()[-1])
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            documents = json.load(response).get('documents', [])
        matches = {}
        for row in documents:
            address = row['address_name']
            district = normalize_name(address.split()[-1])
            if (row.get('address_type') != 'REGION' or not within_region(address, scope)
                    or wanted not in (district, re.sub(r'[동읍면리]$', '', district))):
                continue
            matches[address] = (float(row['y']), float(row['x']))
        if len(matches) == 1:
            address, (lat, lng) = next(iter(matches.items()))
            return {'type': 'area', 'name': name, 'resolved_name': address, 'latitude': lat, 'longitude': lng,
                    'address': address, 'source': 'kakao'}
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        pass
    return None


def apply_location_context(parsed: Dict, text: str, fallback: Dict | None = None,
                           fallback_radius: float | None = None) -> Dict:
    """해석한 기준점·출발지·반경을 분석 응답에 추가한다. 서울시청 대체는 하지 않는다."""
    context = context_names(text)
    parsed['location_context'] = context
    radius = context['radius_km'] or fallback_radius or 5.0
    parsed['radius_km'] = radius
    if radius not in (1, 3, 5, 10):
        context['error'] = '검색 반경은 1·3·5·10km 중에서 선택해 주세요.'
    center_name = context['center_name']
    # 장소를 고르라는 요청에는 기존 위치를 강요하지 않고 지역 후보 탐색으로 넘긴다.
    first_category = (parsed.get('activities') or [{}])[0].get('category')
    history_discovery = first_category == 'history_museum' and center_name in (None, '서울', '서울특별시')
    discovery = parsed.get('region_scope') == '서울' and (
        history_discovery or (not center_name and re.search(
            r'지역.*추천|어디.*(?:추천|좋|가)|산을.*등산|곳.*추천', text)))
    if discovery and not context.get('error'):
        parsed['planning_mode'] = 'region_discovery'
        parsed['search_center'] = None
        parsed['start_location'] = {'type': 'region_discovery', 'latitude': None, 'longitude': None}
        context.update(needs_confirmation=False, reason='활동 조건에 맞는 지역 후보 비교')
        return parsed
    parsed['planning_mode'] = 'center_search'
    if center_name:
        center = resolve_place(center_name)
    elif fallback and fallback.get('name') and fallback.get('latitude') is None:
        center = resolve_place(fallback['name'])
        context['reason'] = '사용자가 입력한 장소명'
    elif fallback and fallback.get('latitude') is not None and fallback.get('longitude') is not None:
        center = dict(fallback)
        center['source'] = fallback.get('type', 'custom')
        context['reason'] = '사용자가 지정한 위치'
    else:
        center = None
    if not center:
        context['error'] = (f"검색 기준점 '{center_name or (fallback or {}).get('name') or ''}'의 좌표를 확인할 수 없습니다. "
                            '정확한 장소명 또는 위도·경도를 입력하거나 현재 위치를 선택해 주세요.')
    departure_name = context['departure_name']
    if context['uses_current_location']:
        allowed = fallback and fallback.get('type') in ('current_location', 'custom', 'map')
        start = dict(fallback) if allowed and fallback.get('latitude') is not None and fallback.get('longitude') is not None else None
        context['needs_current_location'] = start is None
        if not start:
            parsed['warnings'].append('출발 구간 계산에는 현재 위치 또는 지도·좌표로 지정한 출발 위치가 필요합니다. 목적지 주변 시설 검색은 계속 진행합니다.')
    elif departure_name:
        start = resolve_place(departure_name, hiking=context['hiking_departure'])
        if not start:
            context['error'] = f"출발지 '{departure_name}'의 좌표를 확인할 수 없습니다. 정확한 출발지를 지정해 주세요."
    elif center_name and fallback and fallback.get('latitude') is not None and fallback.get('longitude') is not None:
        start = dict(fallback)
    else:
        start = center
    context['needs_confirmation'] = bool(context.get('error'))
    parsed['search_center'] = center
    parsed['start_location'] = start or {'type': 'unresolved', 'latitude': None, 'longitude': None}
    if context.get('error'):
        parsed['warnings'].append(context['error'])
    if center and center.get('note'):
        parsed['warnings'].append(center['note'])
    parsed['live_place_plan'] = bool(center and parsed.get('activities'))
    parsed['current_location_requested'] = context['uses_current_location']
    return parsed
