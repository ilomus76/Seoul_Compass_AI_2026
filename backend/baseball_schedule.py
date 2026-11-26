"""TheSportsDB KBO 일정과 주최 측이 별도로 공지한 행사를 조회한다."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from time import monotonic
from urllib.parse import urlencode
from urllib.request import urlopen

from .config import DATA_DIR, SPORTSDB_API_KEY
from .location_context import normalize_name, resolve_place, within_region

BASEBALL_CATEGORIES = ('baseball_game', 'baseball_event')
KBO_LEAGUE = '4830'
KBO_HOMEPAGE = 'https://www.koreabaseball.com/Schedule/Schedule.aspx'
KBO_SOURCE = 'https://www.thesportsdb.com/league/4830-korean-kbo-league'
KOREA_TIME = timezone(timedelta(hours=9))
TEAMS = {
    'Doosan Bears': '두산 베어스', 'LG Twins': 'LG 트윈스', 'Kiwoom Heroes': '키움 히어로즈',
    'SSG Landers': 'SSG 랜더스', 'KT Wiz': 'KT 위즈', 'Hanwha Eagles': '한화 이글스',
    'Kia Tigers': 'KIA 타이거즈', 'Samsung Lions': '삼성 라이온즈',
    'Lotte Giants': '롯데 자이언츠', 'NC Dinos': 'NC 다이노스',
}


def sportsdb_data(endpoint: str, **query) -> dict:
    url = f'https://www.thesportsdb.com/api/v1/json/{SPORTSDB_API_KEY}/{endpoint}.php?{urlencode(query)}'
    with urlopen(url, timeout=4) as response:
        body = json.load(response)
    if not isinstance(body, dict) or body.get('Message'):
        raise ValueError('Invalid sports schedule response')
    return body


@lru_cache(maxsize=128)
def daily_games(day: date, refresh_slot: int) -> list[dict]:
    """5분 간격으로 당일 일정과 취소 상태를 갱신한다."""
    body = sportsdb_data('eventsday', d=day.isoformat(), l=KBO_LEAGUE)
    rows = body['events']
    if rows is not None and not isinstance(rows, list):
        raise ValueError('Invalid sports schedule list')
    return rows or []


@lru_cache(maxsize=64)
def venue_details(venue_id: str, refresh_slot: int) -> dict:
    rows = sportsdb_data('lookupvenue', id=venue_id).get('venues') or []
    return rows[0] if rows else {}


@lru_cache(maxsize=64)
def resolve_stadium(venue_id: str, name: str, refresh_slot: int) -> tuple[dict | None, tuple[str, ...]]:
    """일정의 실제 경기장 ID와 장소 검색 결과를 연결한다."""
    venue = venue_details(venue_id, refresh_slot) if venue_id.isdigit() else {}
    aliases = tuple(part.strip() for part in (venue.get('strVenueAlternate') or '').split(',') if part.strip())
    names = dict.fromkeys([*(alias for alias in aliases if re.search('[가-힣]', alias)), name])
    try:
        lat, lng = map(float, (venue.get('strMap') or '').split(','))
    except ValueError:
        lat, lng = None, None
    for candidate in names:
        location = resolve_place(candidate, stadium_near=(lat, lng)) if lat is not None else resolve_place(candidate)
        if not location or location.get('source') != 'kakao' or not location.get('address'):
            continue
        return location, aliases + (name,)
    return None, aliases + (name,)


def local_start(row: dict) -> datetime | None:
    try:
        if row.get('dateEventLocal') and row.get('strTimeLocal'):
            return datetime.fromisoformat(f"{row['dateEventLocal']}T{row['strTimeLocal']}").replace(tzinfo=KOREA_TIME)
        value = row.get('strTimestamp') or f"{row.get('dateEvent')}T{row.get('strTime')}"
        timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return (timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=timezone.utc)).astimezone(KOREA_TIME)
    except (TypeError, ValueError):
        return None


def kbo_event(row: dict) -> dict | None:
    status = str(row.get('strStatus') or '').strip().casefold()
    if (str(row.get('idLeague')) != KBO_LEAGUE or not row.get('strVenue')
            or status in {'pst', 'canc', 'abd', 'susp', 'ppd', 'tbd'}
            or any(word in status for word in ('postpon', 'cancel', 'abandon', 'suspend'))
            or str(row.get('strPostponed') or '').strip().casefold() in {'yes', 'true', '1'}):
        return None
    start = local_start(row)
    if start is None:
        return None
    venue, aliases = resolve_stadium(str(row.get('idVenue') or ''), row['strVenue'], int(monotonic() // 3600))
    if not venue:
        return None
    teams = tuple(team for team in (row.get('strHomeTeam'), row.get('strAwayTeam')) if team)
    korean = tuple(TEAMS.get(team, team) for team in teams)
    name = ' vs '.join(korean) if len(teams) == 2 else row.get('strEvent')
    if not name:
        return None
    return {'name': name, 'kind': 'baseball_game', 'date': start.date().isoformat(), 'start_time': start.strftime('%H:%M'),
            'venue': venue['name'], 'address': venue['address'], 'location': venue, 'venue_aliases': aliases,
            'source_url': KBO_SOURCE, 'source': 'TheSportsDB', 'official_url': KBO_HOMEPAGE,
            'search_names': [*teams, *korean, 'KBO 리그', '프로야구']}


@lru_cache(maxsize=1)
def events() -> list[dict]:
    return json.loads((DATA_DIR / 'baseball_events.json').read_text(encoding='utf-8'))


def event_options(activity: dict, travel_date: date, region: str | None) -> tuple[list[dict], bool]:
    """날짜·지역·구장·대진 조건을 적용하고 API 실패를 빈 응답과 구별한다."""
    venue = normalize_name(activity.get('location') or '')
    terms = [normalize_name(term) for term in activity.get('event_terms', []) if term.strip()]

    def matches(event):
        venues = [event['venue'], *event.get('venue_aliases', ())]
        names = normalize_name(' '.join([event['name'], *event.get('search_names', [])]))
        return (within_region(event['address'], region)
                and (not venue or any(venue == normalize_name(name) for name in venues))
                and all(term in names for term in terms))

    registered = [event for event in events()
                  if abs((date.fromisoformat(event['date']) - travel_date).days) <= 1
                  and within_region(event['address'], region)
                  and (not venue or venue == normalize_name(event['venue']))]
    options = [{**event, 'source': '주최 측', 'official_url': event['source_url']}
               for event in registered if matches(event)]
    if activity['category'] != 'baseball_game':
        return options, False

    def fetch(day):
        try:
            return daily_games(day, int(monotonic() // 300)), False
        except (OSError, ValueError, KeyError, TypeError):
            return [], True

    def translate(row):
        try:
            return kbo_event(row), False
        except (OSError, ValueError, KeyError, TypeError):
            return None, True

    with ThreadPoolExecutor(max_workers=6) as executor:
        responses = list(executor.map(fetch, (travel_date + timedelta(days=i) for i in (0, -1, 1))))
        records = {str(row['idEvent']): row for rows, _ in responses for row in rows
                   if isinstance(row, dict) and row.get('idEvent')}
        converted = list(executor.map(translate, records.values()))
    options.extend(event for event, _ in converted if event and matches(event)
                   and abs((date.fromisoformat(event['date']) - travel_date).days) <= 1)
    options.sort(key=lambda event: (abs((date.fromisoformat(event['date']) - travel_date).days),
                                   event['date'], event['start_time'], event['name']))
    return options, any(failed for _, failed in [*responses, *converted])


def schedule_links(activity: dict, travel_date: date | None, region: str | None) -> list[dict]:
    """확인되지 않은 날짜의 다음 행동으로 공식 일정 페이지를 제공한다."""
    links = [{'label': 'KBO 공식 경기 일정', 'url': KBO_HOMEPAGE}]
    for event in events():
        if (travel_date and abs((date.fromisoformat(event['date']) - travel_date).days) <= 1
                and within_region(event['address'], region)
                and (not activity.get('location') or normalize_name(activity['location']) == normalize_name(event['venue']))):
            link = {'label': '한일 드림 플레이어즈 게임 공식 홈페이지', 'url': event['source_url']}
            if link not in links:
                links.insert(0, link)
    return links
