"""선택한 경로의 실제 도로 및 철도 선형을 공급자 API에서 조회한다."""
import json
import math
import threading
import time
import urllib.parse
import urllib.request
from functools import lru_cache

from .config import ODSAY_API_KEY
from .direction import haversine

ROAD_PROFILES = {'walking': 'foot', 'cycling': 'bike', 'driving': 'car'}
_road_lock = threading.Lock()
_last_road_request = 0.0


def read_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'SeoulCompassAI/1.0 (route display)'})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def point(lng, lat):
    """공급자 결과를 확인 가능한 WGS84 좌표로 통일한다."""
    lng, lat = float(lng), float(lat)
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise ValueError('Invalid route coordinate')
    return {'lat': lat, 'lng': lng}


def coord_pair(value):
    return round(value['lng'], 6), round(value['lat'], 6)


def gap(a, b):
    return haversine(a['lat'], a['lng'], b['lat'], b['lng'])


@lru_cache(maxsize=96)
def road_chain(mode, coordinates):
    """인접한 경유지를 한 번에 조회하고 경유지마다 선형을 분리한다."""
    global _last_road_request
    token = ';'.join(f'{lng:.6f},{lat:.6f}' for lng, lat in coordinates)
    url = (f'https://routing.openstreetmap.de/routed-{ROAD_PROFILES[mode]}/route/v1/driving/{token}'
           '?steps=true&geometries=geojson&overview=false')
    with _road_lock:
        wait = 1.05 - (time.monotonic() - _last_road_request)
        if wait > 0:
            time.sleep(wait)
        _last_road_request = time.monotonic()
        result = read_json(url)
    if result.get('code') != 'Ok':
        return []
    legs = result['routes'][0]['legs']
    if len(legs) != len(coordinates) - 1:
        return []
    output = []
    for i, leg in enumerate(legs):
        path = []
        for step in leg['steps']:
            for lng, lat in step['geometry']['coordinates']:
                vertex = point(lng, lat)
                if not path or path[-1] != vertex:
                    path.append(vertex)
        # 멀리 떨어진 도로에 붙은 결과는 장소 사이의 확인된 경로로 표시하지 않는다.
        if (len(path) < 2 or gap(path[0], point(*coordinates[i])) > .2
                or gap(path[-1], point(*coordinates[i + 1])) > .2):
            output.append(None)
            continue
        output.append({'paths': [path], 'source': 'osm', 'distance_km': round(leg['distance'] / 1000, 3),
                       'minutes': math.ceil(leg['duration'] / 60)})
    return output


def odsay(endpoint, **params):
    params['apiKey'] = ODSAY_API_KEY
    url = f'https://api.odsay.com/v1/api/{endpoint}?{urllib.parse.urlencode(params)}'
    return read_json(url).get('result', {})


def rail_shapes(map_object):
    """기준점 보정 후 좌표가 있는 구간만 반환하며 떨어진 노선을 이어 붙이지 않는다."""
    # 기준점 0:0을 요청하면 절대 경위도를 받는다.
    absolute_object = '0:0@' + map_object.split('@', 1)[1]
    result = odsay('loadLane', mapObject=absolute_object)
    return [path for lane in result.get('lane', []) for section in lane.get('section', [])
            if len(path := [point(p['x'], p['y']) for p in section.get('graphPos', [])]) >= 2]


@lru_cache(maxsize=96)
def rail_leg(mode, start, end):
    params = dict(SX=start[0], SY=start[1], EX=end[0], EY=end[1])
    if mode == 'train':
        result = odsay('searchPubTransPathR', SearchType=1, **params)
        choices = [entry for entry in result.get('trainRequest', {}).get('OBJ', []) if entry.get('mapOBJ')]
        if not choices:
            return None
        selected = min(choices, key=lambda item: item['time'])
        map_object = selected['mapOBJ']
    else:
        result = odsay('searchPubTransPathT', SearchType=0, SearchPathType=1, **params)
        choices = [entry['info'] for entry in result.get('path', [])
                   if entry.get('pathType') == 1 and entry.get('info', {}).get('mapObj')]
        if not choices:
            return None
        selected = min(choices, key=lambda item: item['totalTime'])
        map_object = selected['mapObj']
    paths = rail_shapes(map_object)
    if not paths:
        return None
    # ODsay 선형에는 건물에서 역까지의 접근 도보 및 환승 도보 선형이 포함되지 않는다.
    return {'paths': paths, 'source': 'odsay', 'minutes': None, 'distance_km': None}


def road_groups(legs):
    """누락된 구간을 건너뛰어 도로망을 이어 붙이지 않는다."""
    groups = []
    for leg in legs:
        if not groups or coord_pair(groups[-1][-1]['end']) != coord_pair(leg['start']):
            groups.append([])
        groups[-1].append(leg)
    return groups


def lookup(mode, legs):
    if mode not in ROAD_PROFILES and not ODSAY_API_KEY:
        return {'status': 'missing_key', 'legs': []}
    output = []
    errors = (OSError, ValueError, KeyError, IndexError, TypeError)
    if mode in ROAD_PROFILES:
        for group in road_groups(legs):
            coordinates = (coord_pair(group[0]['start']), *(coord_pair(leg['end']) for leg in group))
            try:
                matches = road_chain(mode, coordinates)
            except errors:
                continue
            output.extend({'index': leg['index'], **shape} for leg, shape in zip(group, matches) if shape)
    else:
        for leg in legs:
            try:
                shape = rail_leg(mode, coord_pair(leg['start']), coord_pair(leg['end']))
            except errors:
                continue
            if shape:
                output.append({'index': leg['index'], **shape})
    return {'status': 'ok' if output else 'unavailable', 'legs': output}
