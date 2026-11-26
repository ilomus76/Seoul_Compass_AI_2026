"""새 지명·현재 위치·오타가 있는 명시 목적지 요청 회귀 검증."""
import io
import json
import unittest
from unittest.mock import patch

from backend.ai_parser import parse_user_request
from backend.location_context import apply_location_context, context_names, normalize_request_text
from backend.region_planner import recommend_regions, search_live

QUESTION = '저는 내일 오전 10시에 소래산으로 지금 위치에서 발해서 12시에 내려와 수영을 하고 15시에 순대국을 먹으려고 해요.'
CENTER = {'type': 'context', 'name': '소래산', 'latitude': 37.45, 'longitude': 126.78,
          'source': 'kakao', 'address': '인천 테스트용 주소'}


def place(identifier, name, category):
    """실제 시설로 사용되지 않는 테스트 전용 fixture."""
    return {'id': identifier, 'name': name, 'lat': 37.451, 'lng': 126.781,
            'provider_category': category, 'source': 'kakao', 'keywords': [name],
            'distance_km': .14, 'confidence': 0, 'hours': None, 'fee_krw': None}


class NamedPlanTests(unittest.TestCase):
    def request(self, origin=None):
        return {**parse_user_request(QUESTION), 'search_center': dict(CENTER), 'destination_name': '소래산',
                'start_location': origin, 'current_location_requested': True, 'transport_modes': ['walking']}

    def search_fixture(self, query, *args, **kwargs):
        if query == '수영장':
            return [place('test_pool', '테스트 수영장', '스포츠 > 수영장')]
        if query == '순대국':
            return [place('test_food', '테스트 순대국', '음식점 > 한식')]
        return []

    def test_original_sentence_has_destination_hiking_and_departure(self):
        context = context_names(QUESTION)
        self.assertEqual(context['center_name'], '소래산')
        self.assertTrue(context['uses_current_location'])
        parsed = parse_user_request(QUESTION)
        self.assertEqual(parsed['departure_time'], '10:00')
        self.assertIsNone(parsed['region_scope'])
        hike, swim, meal = parsed['activities']
        self.assertEqual([a['category'] for a in parsed['activities']], ['hiking', 'swimming', 'restaurant'])
        self.assertIsNone(hike['start_time'])
        self.assertIsNone(hike['duration_minutes'])
        self.assertEqual(hike['end_time'], '12:00')
        self.assertEqual(swim['earliest_start'], '12:00')
        self.assertEqual(meal['start_time'], '15:00')

    def test_typo_correction_is_limited_to_departure_context(self):
        self.assertIn('위치에서 출발해서', normalize_request_text(QUESTION))
        self.assertEqual(normalize_request_text('발이 아파서 쉬어요'), '발이 아파서 쉬어요')
        corrected = QUESTION.replace('발해서', '출발해서')
        self.assertEqual(context_names(corrected)['center_name'], '소래산')

    def test_unlisted_mountain_is_inferred_without_hardcoding(self):
        text = '내일 10시에 문수산으로 현재 위치에서 출발해서 12시 하산 후 수영'
        self.assertEqual(context_names(text)['center_name'], '문수산')
        self.assertEqual(parse_user_request(text)['activities'][0]['category'], 'hiking')

    def test_departure_city_is_not_a_search_region_restriction(self):
        parsed = parse_user_request('서울역에서 출발해서 소래산으로 이동해 12시에 하산 후 수영')
        self.assertIsNone(parsed['region_scope'])
        self.assertEqual(parse_user_request('서울 안에서 등산할 지역 추천')['region_scope'], '서울')

    def test_explicit_hiking_start_is_not_changed_to_departure_time(self):
        parsed = parse_user_request('현재 위치에서 출발해서 오전 10시에 소래산을 등산하고 12시에 하산')
        self.assertIsNone(parsed['departure_time'])
        self.assertEqual(parsed['activities'][0]['start_time'], '10:00')

    @patch('backend.location_context.resolve_place', return_value=CENTER)
    def test_missing_gps_does_not_block_destination_search(self, resolve):
        parsed = apply_location_context(parse_user_request(QUESTION), QUESTION)
        self.assertEqual(parsed['search_center']['name'], '소래산')
        self.assertTrue(parsed['live_place_plan'])
        self.assertFalse(parsed['location_context']['needs_confirmation'])
        self.assertTrue(parsed['location_context']['needs_current_location'])
        self.assertIsNone(parsed['start_location']['latitude'])
        resolve.assert_called_once_with('소래산')

    @patch('backend.location_context.resolve_place', return_value=CENTER)
    def test_origin_and_destination_stay_separate(self, resolve):
        origin = {'type': 'current_location', 'latitude': 37.44, 'longitude': 126.77, 'name': '테스트 위치'}
        parsed = apply_location_context(parse_user_request(QUESTION), QUESTION, origin)
        self.assertEqual(parsed['start_location']['latitude'], 37.44)
        self.assertEqual(parsed['search_center']['latitude'], 37.45)
        self.assertFalse(parsed['location_context']['needs_current_location'])

    @patch('backend.location_context.resolve_place', return_value=CENTER)
    def test_ip_estimate_is_not_used_as_current_departure(self, resolve):
        origin = {'type': 'ip_estimate', 'latitude': 37.44, 'longitude': 126.77}
        parsed = apply_location_context(parse_user_request(QUESTION), QUESTION, origin)
        self.assertTrue(parsed['location_context']['needs_current_location'])

    @patch('backend.region_planner.KAKAO_REST_API_KEY', 'test-key')
    @patch('backend.region_planner.search_live')
    def test_actual_facility_groups_are_returned_before_gps(self, search):
        search.side_effect = self.search_fixture
        result = recommend_regions(self.request())
        region = result['regions'][0]
        self.assertEqual(region['coverage_percent'], 100)
        self.assertEqual(region['status'], 'needs_origin')
        self.assertEqual(region['first_leg']['planned_departure'], '10:00')
        self.assertIsNone(region['draft_route'])
        self.assertTrue(region['routes'])
        self.assertTrue(all(route['preview'] and route['schedule'] is None for route in region['routes']))
        self.assertEqual(region['search_center']['longitude'], 126.78)

    @patch('backend.region_planner.KAKAO_REST_API_KEY', 'test-key')
    @patch('backend.region_planner.search_live')
    def test_first_journey_reduces_available_hiking_window(self, search):
        search.side_effect = self.search_fixture
        region = recommend_regions(self.request({'type': 'custom', 'latitude': 37.44, 'longitude': 126.78}))['regions'][0]
        draft = region['draft_route']
        self.assertIsNotNone(draft)
        self.assertGreater(region['first_leg']['estimated_minutes'], 0)
        hike = draft['schedule']['timeline'][0]
        self.assertGreater(hike['estimated_start'], '10:00')
        self.assertEqual(hike['estimated_end'], '12:00')
        self.assertLess(hike['duration_minutes'], 120)
        self.assertEqual(draft['schedule']['timeline'][-1]['planned_start'], '15:00')
        self.assertFalse(draft['schedule']['verified_feasible'])

    @patch('backend.region_planner.KAKAO_REST_API_KEY', 'test-key')
    @patch('backend.region_planner.search_live')
    def test_far_origin_reports_descent_deadline_conflict(self, search):
        search.side_effect = self.search_fixture
        region = recommend_regions(self.request({'type': 'custom', 'latitude': 37.8, 'longitude': 126.78}))['regions'][0]
        self.assertEqual(region['status'], 'time_conflict')
        self.assertTrue(any(c['activity_id'] == 1 for c in region['draft_route']['schedule']['conflicts']))

    @patch('backend.region_planner.KAKAO_REST_API_KEY', 'test-key')
    @patch('backend.region_planner.urllib.request.urlopen')
    def test_non_seoul_results_are_allowed_only_without_scope(self, urlopen):
        doc = {'id': 'sorae_fixture', 'place_name': '테스트 수영장', 'x': '126.78', 'y': '37.45',
               'address_name': '경기 시흥시 테스트', 'category_name': '스포츠 > 수영장'}
        urlopen.return_value.__enter__.side_effect = lambda: io.StringIO(json.dumps({'documents': [doc]}))
        self.assertEqual(len(search_live('테스트지역제한확인', region_scope=None)), 1)
        self.assertEqual(search_live('테스트지역제한확인', region_scope='서울'), [])


if __name__ == '__main__':
    unittest.main()
