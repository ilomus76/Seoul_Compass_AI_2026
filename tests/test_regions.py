"""목적지 미정 산행·수영·메뉴 일정의 회귀·오류 검증."""
import io
import json
import unittest
from unittest.mock import patch

from backend.ai_parser import parse_user_request
from backend.location_context import apply_location_context
from backend.region_planner import recommend_regions, matches_activity, search_live
from backend.schedule import validate_schedule
from backend.schemas import RegionRecommendRequest
from backend.main import region_recommend

QUESTION = '저는 내일 오전 10시에 서울에 있는 산을 등산을 하고 12시에 내려와 수영을 하고 15시에 순대국을 먹으려고 해요. 이 일정으로 괜찮은 지역을 추천해주세요'
HISTORY_QUESTION = ('내일 서울을 갈건데 역사에 관심이 많아서 역사 관련 박물관을 가고 싶어. '
                    '11월 28일 오전 10시에 말이야. 12시에 박물관에서 나와서 한국의 고궁을 들려서 '
                    '구경을 하고 시장에서 맛있은 음식을 즐기고 싶어. 이런 경로를 추천해줘')


def fixture_place(identifier, name, category, lat=37.57, lng=126.97):
    """실제 시설이라고 표시하지 않는 단위 테스트 전용 장소."""
    return {'id': identifier, 'name': name, 'category': category, 'lat': lat, 'lng': lng,
            'source': 'kakao', 'provider_category': '스포츠 > 수영장' if category == 'swimming' else '음식점',
            'keywords': [name], 'distance_km': .1, 'confidence': 0,
            'rating': None, 'hours': None, 'fee_krw': None}


class RegionTests(unittest.TestCase):
    def setUp(self):
        key_patch = patch('backend.location_context.KAKAO_REST_API_KEY', '')
        key_patch.start()
        self.addCleanup(key_patch.stop)

    def request(self):
        parsed = parse_user_request(QUESTION)
        return {'activities': parsed['activities'], 'region_scope': '서울', 'radius_km': 5,
                'travel_date': parsed['travel_date'], 'transport_modes': ['walking']}

    def test_original_sentence_keeps_every_activity_and_time(self):
        parsed = apply_location_context(parse_user_request(QUESTION), QUESTION)
        self.assertEqual(parsed['planning_mode'], 'region_discovery')
        self.assertFalse(parsed['location_context']['needs_confirmation'])
        self.assertIsNone(parsed['search_center'])
        hike, swim, meal = parsed['activities']
        self.assertEqual([a['category'] for a in parsed['activities']], ['hiking', 'swimming', 'restaurant'])
        self.assertEqual((hike['start_time'], hike['end_time'], hike['duration_minutes']), ('10:00', '12:00', 120))
        self.assertEqual(swim['earliest_start'], '12:00')
        self.assertIsNone(swim['start_time'])
        self.assertTrue(swim['duration_estimated'])
        self.assertEqual(meal['start_time'], '15:00')
        self.assertTrue(meal['fixed_time'])
        self.assertEqual(meal['required_keywords'], ['순대국'])

    def test_explicit_mountain_stays_center_search(self):
        parsed = apply_location_context(parse_user_request('관악산 기준 3km 안에서 수영하고 순대국'), '관악산 기준 3km 안에서 수영하고 순대국')
        self.assertEqual(parsed['planning_mode'], 'center_search')

    def test_later_activity_does_not_copy_earlier_time(self):
        activities = parse_user_request('10시 서울에서 등산을 하고 수영 후 15시 순댓국을 먹자')['activities']
        self.assertIsNone(activities[1]['start_time'])
        self.assertEqual(activities[-1]['required_keywords'], ['순대국'])

    @patch('backend.region_planner.discover_history_museums')
    @patch('backend.region_planner.find_candidates')
    def test_seoul_history_itinerary_overrides_bucheon_fallback(self, candidates, anchors):
        fallback = {'type': 'custom', 'name': '부천', 'latitude': 37.5, 'longitude': 126.77}
        parsed = apply_location_context(parse_user_request(HISTORY_QUESTION), HISTORY_QUESTION, fallback)
        self.assertEqual(parsed['region_scope'], '서울')
        self.assertEqual(parsed['planning_mode'], 'region_discovery')
        self.assertIsNone(parsed['search_center'])
        self.assertTrue(parsed['travel_date'].endswith('-11-28'))
        museum, palace, market = parsed['activities']
        self.assertEqual((museum['category'], palace['category'], market['category']),
                         ('history_museum', 'palace', 'market_food'))
        self.assertEqual((museum['start_time'], museum['end_time'], museum['duration_minutes']),
                         ('10:00', '12:00', 120))
        self.assertEqual(palace['earliest_start'], '12:00')
        self.assertIsNone(market['earliest_start'])
        anchors.return_value = [fixture_place('museum', '검증용 역사박물관', 'history_museum')]
        candidates.side_effect = [
            [fixture_place('palace', '경희궁', 'palace')],
            [{**fixture_place('market', '검증용 시장', 'market_food'),
              'food_options': [{'name': '검증용 김밥', 'menu_hint': '김밥'}]}]
        ]
        region = recommend_regions(parsed)['regions'][0]
        self.assertEqual(region['coverage_percent'], 100)
        self.assertEqual(region['search_center']['latitude'], 37.57)
        self.assertEqual(region['draft_route']['schedule']['timeline'][0]['estimated_end'], '12:00')
        self.assertEqual(region['draft_route']['nodes'][2]['place']['food_options'][0]['menu_hint'], '김밥')

    def test_explicit_pool_time_keeps_conflict(self):
        activities = self.request()['activities']
        activities[1].update(start_time='12:00', fixed_time=True, earliest_start=None)
        nodes = [{'place': {'name': '검증용 장소'}, 'travel_minutes': travel} for travel in (0, 20, 10)]
        schedule = validate_schedule(activities, {'nodes': nodes})
        self.assertFalse(schedule['feasible'])
        self.assertEqual(schedule['timeline'][1]['planned_start'], '12:00')
        self.assertEqual(schedule['timeline'][1]['estimated_start'], '12:30')

    def test_long_pool_session_conflicts_with_fixed_meal(self):
        activities = self.request()['activities']
        activities[1]['duration_minutes'] = 180
        nodes = [{'place': {'name': '검증용 장소'}, 'travel_minutes': travel} for travel in (0, 20, 20)]
        schedule = validate_schedule(activities, {'nodes': nodes})
        self.assertFalse(schedule['feasible'])
        self.assertTrue(any(c['activity_id'] == 3 for c in schedule['conflicts']))
        self.assertEqual(schedule['timeline'][-1]['planned_start'], '15:00')

    def test_menu_and_pool_type_are_required(self):
        meal = self.request()['activities'][-1]
        self.assertFalse(matches_activity(fixture_place('r', '검증용 일반식당', 'restaurant'), meal))
        self.assertTrue(matches_activity(fixture_place('r', '검증용 순댓국집', 'restaurant'), meal))
        swim = {'category': 'swimming'}
        self.assertFalse(matches_activity(fixture_place('p', '어린이물놀이장', 'swimming'), swim))
        self.assertFalse(matches_activity(fixture_place('p', '수영용품 판매점', 'swimming'), swim))
        self.assertTrue(matches_activity(fixture_place('p', '검증용 수영장', 'swimming'), swim))

    @patch('backend.region_planner.discover_anchors')
    @patch('backend.region_planner.find_candidates')
    def test_complete_region_still_requires_real_visit_confirmation(self, candidates, anchors):
        anchors.return_value = [fixture_place('a', '검증용산 입구', 'hiking')]
        candidates.side_effect = lambda anchor, activity, radius: [fixture_place(
            activity['category'], '검증용 수영장' if activity['category'] == 'swimming' else '검증용 순대국',
            activity['category'], lat=37.571)]
        result = region_recommend(RegionRecommendRequest(**self.request()))
        region = result['regions'][0]
        self.assertEqual(region['coverage_percent'], 100)
        self.assertEqual(region['status'], 'needs_confirmation')
        draft = region['draft_route']
        self.assertEqual(len(draft['nodes']), 3)
        self.assertIsNone(draft['estimated_cost_krw'])
        self.assertIsNone(draft['score'])
        self.assertIsNone(draft['schedule']['feasible'])
        self.assertFalse(draft['schedule']['verified_feasible'])
        self.assertEqual(draft['schedule']['timeline'][-1]['planned_start'], '15:00')

    @patch('backend.region_planner.discover_anchors')
    @patch('backend.region_planner.find_candidates', return_value=[])
    def test_missing_facilities_never_produce_a_complete_route(self, candidates, anchors):
        anchors.return_value = [fixture_place('a', '검증용산 입구', 'hiking')]
        region = recommend_regions(self.request())['regions'][0]
        self.assertEqual(region['status'], 'missing_places')
        self.assertEqual(len(region['missing_activities']), 2)
        self.assertIsNone(region['draft_route'])

    @patch('backend.region_planner.discover_anchors', side_effect=RuntimeError('조회 실패'))
    def test_provider_failure_has_actionable_warning(self, anchors):
        result = recommend_regions(self.request())
        self.assertEqual(result['regions'], [])
        self.assertIn('조회 실패', result['warnings'])

    @patch('backend.region_planner.KAKAO_REST_API_KEY', '')
    def test_offline_mode_does_not_invent_pools_or_menu(self):
        result = recommend_regions(self.request())
        self.assertTrue(result['regions'])
        self.assertTrue(all(r['draft_route'] is None and r['missing_activities'] for r in result['regions']))
        self.assertTrue(all(r['search_center']['source'] == 'sample' for r in result['regions']))

    @patch('backend.region_planner.KAKAO_REST_API_KEY', 'test-key')
    @patch('backend.region_planner.urllib.request.urlopen')
    def test_live_results_outside_radius_or_seoul_are_excluded(self, urlopen):
        docs = [{'id': 'outside', 'place_name': '검증용 수영장', 'x': '127.2', 'y': '37.7', 'address_name': '서울 강동구'},
                {'id': 'othercity', 'place_name': '검증용 수영장', 'x': '126.97', 'y': '37.57', 'address_name': '경기 과천시'}]
        urlopen.return_value.__enter__.return_value = io.StringIO(json.dumps({'documents': docs}))
        self.assertEqual(search_live('단위테스트전용검색', {'lat': 37.57, 'lng': 126.97}, 1), [])


if __name__ == '__main__':
    unittest.main()
