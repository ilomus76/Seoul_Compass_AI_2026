import io
import json
import math
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend import baseball_schedule, context_parser, venue_details
from backend.main import parse, region_recommend
from backend.optimizer import recommend_routes
from backend.region_planner import context_candidates, context_matches
from backend.route_corridor import HEADINGS, unique_courses
from backend.schemas import ParseRequest, RegionRecommendRequest


def activity(category, number, **values):
    return {'id': number, 'category': category, 'request_term': category, 'duration_minutes': 15, **values}


def place(name, degrees, radius=1):
    return {'id': name, 'name': name, 'lat': math.cos(math.radians(degrees)) * radius / 111.2,
            'lng': math.sin(math.radians(degrees)) * radius / 111.2, 'distance_km': radius, 'source': 'kakao'}


def model_intent(*rows, **overrides):
    empty_activity = dict(search_query=None, venue_kind=None, named_place=None, menu_terms=[], event_terms=[], start_time=None,
                          end_time=None, earliest_start=None, preferred_time=None, duration_minutes=None,
                          duration_estimated=True, fixed_time=False, required=True)
    values = dict(travel_date=None, region_scope=None, search_center_name=None, origin='unspecified', origin_name=None,
                  destination_name=None, departure_time=None, radius_km=None, bearing=None, warnings=[], clarification=None,
                  activities=[context_parser.IntentActivity(**{**empty_activity, **row}) for row in rows])
    return context_parser.TravelIntent(**{**values, **overrides})


class DirectionCoursesTests(unittest.TestCase):
    def setUp(self):
        self.start = {'latitude': 0, 'longitude': 0}

    def test_scan_36_headings_then_deduplicate(self):
        request = {'start_location': self.start, 'contextual': True, 'activities': [activity('park', 1)]}
        options = [[place(str(heading), heading) for heading in HEADINGS]]
        courses = recommend_routes(request, options)
        self.assertEqual([course['corridor']['heading'] for course in courses], list(HEADINGS))
        distinct = unique_courses(courses)
        self.assertGreaterEqual(len(distinct), 5)
        self.assertEqual(len(distinct), len({course['nodes'][0]['place']['id'] for course in distinct}))

    def test_heading_wrap_and_return(self):
        request = {'start_location': self.start, 'contextual': True, 'requested_bearing': 0,
                   'activities': [activity('park', 1), activity('cafe', 2),
                                  activity('return_to_start', 3)]}
        request['activities'][2]['duration_minutes'] = 0
        courses = recommend_routes(request, [[place('park', 353)], [place('cafe', 8)], [place('return', 0, 0)]])
        self.assertEqual([course['corridor']['heading'] for course in courses], [0])
        self.assertTrue(courses[0]['schedule']['feasible'])

    def test_left_and_right_when_no_primary_course_and_fixed_goal(self):
        goal = place('goal', 0, 2)
        request = {'start_location': self.start, 'route_goal': {'latitude': goal['lat'], 'longitude': goal['lng']},
                   'contextual': True, 'activities': [activity('park', 1), activity('destination', 2)]}
        courses = recommend_routes(request, [[place('left', 334), place('right', 25)], [goal]])
        self.assertEqual({course['corridor']['variant'] for course in courses}, {'left', 'right'})
        self.assertEqual({course['nodes'][1]['place']['id'] for course in courses}, {'goal'})

    def test_no_course_when_activities_miss_fixed_time(self):
        request = {'start_location': self.start, 'contextual': True, 'departure_time': '09:55',
                   'activities': [activity('park', 1, start_time='10:00', fixed_time=True)]}
        self.assertEqual(recommend_routes(request, [[place('park', 0)]]), [])

    @patch('backend.region_planner.context_candidates')
    def test_regions_api_caps_whole_result_at_five(self, candidates):
        candidates.return_value = [place(str(degrees), degrees) for degrees in HEADINGS]
        data = region_recommend(RegionRecommendRequest(search_center=self.start,
                                activities=[activity('park', 1)], contextual=True))
        self.assertEqual(data['scanned_headings'], 36)
        self.assertGreater(data['direction_candidate_count'], 5)
        self.assertEqual([course['rank'] for course in data['recommendations']], [1, 2, 3, 4, 5])
        self.assertEqual(data['regions'][0]['routes'], data['recommendations'])


class ContextAndMenuTests(unittest.TestCase):
    @patch('backend.main.CONTEXT_LLM_ENABLED', True)
    @patch('backend.context_parser.LLM_API_KEY', 'test-key')
    @patch('backend.context_parser.CONTEXT_LLM_ENABLED', True)
    @patch('backend.context_parser.urllib.request.urlopen')
    def test_model_request_and_structured_intent(self, urlopen):
        intent = {'travel_date': '2026-11-28', 'region_scope': '서울', 'search_center_name': None,
                  'origin': 'named', 'origin_name': '서울특별시', 'destination_name': None, 'departure_time': None,
                  'radius_km': None, 'bearing': None, 'warnings': [], 'clarification': None,
                  'activities': [
                      {'category': 'history_museum', 'request_term': '근현대사 박물관', 'search_query': '한국 근현대사 박물관',
                       'named_place': None, 'venue_kind': '박물관', 'menu_terms': [], 'event_terms': [], 'start_time': '10:00',
                       'end_time': '12:00', 'earliest_start': None, 'preferred_time': None, 'duration_minutes': None,
                       'duration_estimated': False, 'fixed_time': True, 'required': True}]}
        model = {'status': 'completed', 'output': [{
            'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(intent)}]}]}
        urlopen.return_value = io.BytesIO(json.dumps(model).encode())
        parsed = parse(ParseRequest(text='서울에서 근현대사 박물관을 가고 싶어. 010-1234-5678',
                       fallback_location={'latitude': 37.123456, 'longitude': 126.123456, 'type': 'current_location'}))
        self.assertEqual(parsed['analysis_method'], 'context')
        self.assertEqual(parsed['region_scope'], '서울')
        self.assertIsNone(parsed['search_center'])
        self.assertIsNone(parsed['start_location'])
        self.assertFalse(parsed['location_context']['needs_confirmation'])
        self.assertEqual(parsed['planning_mode'], 'region_discovery')
        self.assertEqual(parsed['activities'][0]['duration_minutes'], 120)
        payload = json.loads(urlopen.call_args.args[0].data)
        self.assertFalse(payload['store'])
        self.assertTrue(payload['text']['format']['strict'])
        self.assertNotIn('010-1234-5678', payload['input'])
        self.assertNotIn('37.123456', json.dumps(payload))

    @patch('backend.region_planner.search_live')
    def test_detailed_search_retries_same_venue_type_in_requested_city(self, search):
        museum = {**place('대한민국역사박물관', 15), 'provider_category': '문화시설 > 박물관'}
        search.side_effect = [[], [museum]]
        candidates = context_candidates(None, activity('history_museum', 1, search_query='한국 근현대사 박물관'), 5, '서울')
        self.assertEqual([call.args[0] for call in search.call_args_list],
                         ['서울 한국 근현대사 박물관', '서울 역사박물관'])
        self.assertTrue(all(call.kwargs['region_scope'] == '서울' for call in search.call_args_list))
        self.assertEqual(candidates[0]['venue_condition_unconfirmed'], '한국 근현대사 박물관')

    def test_seoul_palace_search_keeps_palaces_rather_than_related_facilities(self):
        palace = {'name': '경희궁', 'address': '서울 종로구 신문로2가', 'provider_category': '문화시설 > 고궁,궁'}
        request = activity('palace', 1)
        self.assertTrue(context_matches(palace, request))
        self.assertFalse(context_matches({**palace, 'name': '경희궁 숭정전'}, request))

    @patch('backend.baseball_schedule.daily_games', return_value=[])
    def test_december_fourth_baseball_game_keeps_seoul_and_shows_official_options(self, _daily_games):
        intent = model_intent({'category': 'baseball_game', 'request_term': '야구 경기'},
                              {'category': 'restaurant', 'request_term': '식사'},
                              {'category': 'return_to_current', 'request_term': '지금 위치로'}, travel_date='2026-12-04')
        bucheon = {'type': 'current_location', 'name': '현재 위치', 'latitude': 37.50, 'longitude': 126.76}
        parsed = context_parser.resolve_intent(intent, bucheon, 5)
        self.assertEqual(parsed['region_scope'], '서울')
        self.assertEqual(parsed['travel_date'], '2026-12-04')
        self.assertIsNone(parsed['search_center'])
        self.assertEqual(parsed['return_location'], bucheon)
        self.assertTrue(parsed['location_context']['needs_confirmation'])
        self.assertEqual([(event['date'], event['start_time'], event['kind']) for event in parsed['event_options']],
                         [('2026-12-04', '18:30', 'baseball_event'), ('2026-12-05', '14:00', 'baseball_game')])
        self.assertEqual(parsed['event_links'][0]['url'], 'https://dreamplayers.kr/')

    @patch('backend.baseball_schedule.daily_games', return_value=[])
    @patch('backend.context_parser.resolve_place')
    def test_december_fifth_game_anchors_food_search_at_stadium_even_with_outside_return(self, locate, _daily_games):
        stadium = {'name': '고척스카이돔', 'source': 'kakao', 'latitude': 37.498, 'longitude': 126.867,
                   'address': '서울 구로구 경인로 430'}
        locate.return_value = stadium
        intent = model_intent({'category': 'baseball_game', 'request_term': '야구 경기', 'duration_minutes': 150},
                              {'category': 'return_to_current', 'request_term': '지금 위치로'}, travel_date='2026-12-05')
        parsed = context_parser.resolve_intent(intent, None, 5)
        self.assertTrue(parsed['location_context']['needs_current_location'])
        self.assertTrue(parsed['live_place_plan'])
        self.assertEqual(parsed['search_center'], stadium)
        self.assertTrue(parsed['activities'][0]['fixed_time'])
        self.assertEqual(parsed['activities'][0]['start_time'], '14:00')

    @patch('backend.baseball_schedule.daily_games', side_effect=OSError('test outage'))
    def test_schedule_outage_keeps_requested_date_and_shows_kbo_homepage(self, _games):
        intent = model_intent({'category': 'baseball_game', 'request_term': '야구 경기'}, travel_date='2026-04-01')
        parsed = context_parser.resolve_intent(intent, None, 5)
        self.assertEqual(parsed['travel_date'], '2026-04-01')
        self.assertIn('API', parsed['location_context']['error'])
        self.assertFalse(parsed['live_place_plan'])
        self.assertEqual(parsed['event_links'][0]['url'], baseball_schedule.KBO_HOMEPAGE)

    @patch('backend.baseball_schedule.daily_games')
    @patch('backend.baseball_schedule.resolve_stadium')
    def test_kbo_game_from_api_uses_korean_time_and_excludes_postponed_game(self, stadium, games):
        stadium.return_value = ({'name': '잠실야구장', 'address': '서울 송파구', 'source': 'kakao',
                                 'latitude': 37.512, 'longitude': 127.072}, ('Jamsil Baseball Stadium',))
        game = {'idEvent': '1234', 'idLeague': '4830', 'strVenue': 'Jamsil Baseball Stadium', 'idVenue': '21259',
                'strHomeTeam': 'Doosan Bears', 'strAwayTeam': 'LG Twins', 'strTimestamp': '2026-09-01T09:30:00'}
        games.return_value = [game, {**game, 'idEvent': '1235', 'strStatus': 'Postponed'}]
        intent = model_intent({'category': 'baseball_game', 'request_term': '두산 경기', 'event_terms': ['두산']},
                              travel_date='2026-09-01')
        parsed = context_parser.resolve_intent(intent, None, 5)
        self.assertTrue(parsed['live_place_plan'])
        self.assertEqual(parsed['activities'][0]['start_time'], '18:30')
        self.assertEqual(parsed['activities'][0]['location'], '잠실야구장')
        self.assertEqual([option['source'] for option in parsed['event_options']], ['TheSportsDB'])

    def test_named_region_and_explicit_current_radius_take_precedence_over_seoul_default(self):
        origin = {'type': 'current_location', 'latitude': 37.5, 'longitude': 126.76}
        rows = ({'category': 'restaurant', 'request_term': '식사'},
                {'category': 'return_to_current', 'request_term': '지금 위치로'})
        named = context_parser.resolve_intent(model_intent(*rows, region_scope='부천'), origin, 5)
        self.assertEqual(named['region_scope'], '부천')
        self.assertIsNone(named['search_center'])
        nearby = context_parser.resolve_intent(model_intent(*rows, search_center_name='현재 위치'), origin, 5)
        self.assertIsNone(nearby['region_scope'])
        self.assertEqual(nearby['search_center'], origin)

    def test_return_point_can_be_outside_search_region_and_different_from_start(self):
        result = context_candidates(None, activity('return_to_current', 2), 1, '서울',
                                    start={'latitude': 37.52, 'longitude': 126.96},
                                    return_location={'latitude': 37.50, 'longitude': 126.76})
        self.assertEqual([(point['lat'], point['lng']) for point in result], [(37.50, 126.76)])

    @patch('backend.context_parser.CONTEXT_LLM_ENABLED', False)
    def test_explicit_context_request_does_not_fall_back_to_legacy(self):
        with self.assertRaises(HTTPException) as error:
            parse(ParseRequest(text='서울에서 식사', analysis_mode='context'))
        self.assertEqual(error.exception.status_code, 503)

    @patch('backend.venue_details.TOUR_API_KEY', 'example')
    @patch('backend.venue_details.tour_items')
    def test_menu_is_associated_with_the_same_location(self, items):
        restaurant = {**place('강변 식당', 10), 'phone': '+82 2-123-1234'}
        items.side_effect = [[
            {'title': restaurant['name'], 'tel': '02-123-1234', 'contentid': 'good',
             'mapx': restaurant['lng'], 'mapy': restaurant['lat']},
            {'title': restaurant['name'], 'tel': '02-234-5678', 'contentid': 'other_branch',
             'mapx': restaurant['lng'], 'mapy': restaurant['lat']},
        ], [{'firstmenu': '순댓국', 'treatmenu': '순댓국 / 수육'}]]
        found = venue_details.annotate_menus([restaurant], ['순대국'])[0]
        self.assertEqual(found['menu_status'], 'matched')
        self.assertEqual(items.call_args.kwargs['contentId'], 'good')

    @patch('backend.venue_details.TOUR_API_KEY', '')
    def test_public_phone_does_not_count_as_menu_confirmation(self):
        restaurant = {**place('식당', 10), 'phone': '02-123-1234'}
        found = venue_details.annotate_menus([restaurant], ['순대국'])[0]
        self.assertEqual(found['menu_status'], 'unconfirmed')
        self.assertEqual(found['menus'], [])
