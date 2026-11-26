"""회귀 검증: 질문의 문맥이 서울시청 기본값보다 우선해야 한다."""
import unittest
from unittest.mock import patch

from backend.ai_parser import parse_user_request
from backend.direction import haversine
from backend.location_context import apply_location_context, context_names, resolve_place
from backend.optimizer import recommend_routes
from backend.schemas import ParseRequest, RouteRecommendRequest
from backend.main import parse, route_recommend
from fastapi import HTTPException


class LocationContextTests(unittest.TestCase):
    def setUp(self):
        # 로컬 샘플을 검증하는 테스트는 실제 서비스 키·네트워크에 의존하지 않는다.
        key_patch = patch('backend.location_context.KAKAO_REST_API_KEY', '')
        key_patch.start()
        self.addCleanup(key_patch.stop)

    def analyze(self, text, fallback=None, radius=None):
        return apply_location_context(parse_user_request(text), text, fallback, radius)

    def test_explicit_center_overrides_previous_city_hall(self):
        result = self.analyze('관악산 기준으로 3km 안에서 볼링장을 찾아줘',
                              {'name': '서울시청', 'latitude': 37.5665, 'longitude': 126.978})
        self.assertEqual(result['search_center']['name'], '관악산')
        self.assertEqual(result['radius_km'], 3)
        self.assertAlmostEqual(result['search_center']['latitude'], 37.478)
        self.assertEqual(result['start_location']['name'], '서울시청')

    def test_first_hike_and_later_meeting(self):
        result = self.analyze('9시 관악산을 등산하고 14시 신림역에서 만나 볼링을 칠거야')
        self.assertEqual(result['search_center']['name'], '관악산')
        self.assertIn('입구', result['start_location']['resolved_name'])
        result = self.analyze('9시 서울관악산을 등산하고 신림역에서 친구를 만날거야')
        self.assertFalse(result['location_context']['needs_confirmation'])

    def test_station_meeting_is_center(self):
        self.assertEqual(context_names('오후 2시에 용산역에서 만나서 볼링')['center_name'], '용산역')
        self.assertEqual(context_names('오후 2시에 용산역에서 만나서 볼링. 5km 근방에서 찾아줘')['center_name'], '용산역')

    def test_explicit_center_and_departure_are_separate(self):
        result = self.analyze('서울역에서 출발하고 명동 기준으로 1km 주변 카페를 찾아줘')
        self.assertEqual(result['search_center']['name'], '명동')
        self.assertEqual(result['start_location']['name'], '서울역')

    def test_center_without_hiking_does_not_imply_hike(self):
        names = context_names('관악산 기준으로 볼링장')
        self.assertIsNone(names['departure_name'])
        result = self.analyze('관악산 기준으로 볼링장')
        self.assertEqual([a['category'] for a in result['activities']], ['bowling'])

    @patch('backend.location_context.KAKAO_REST_API_KEY', '')
    def test_unknown_explicit_center_does_not_use_old_coordinates(self):
        result = self.analyze('없는장소 기준으로 카페',
                              {'latitude': 37.5665, 'longitude': 126.978})
        self.assertTrue(result['location_context']['needs_confirmation'])
        self.assertIsNone(result['search_center'])

    def test_no_location_requires_confirmation(self):
        result = self.analyze('볼링을 치고 싶어')
        self.assertTrue(result['location_context']['needs_confirmation'])
        self.assertIsNone(result['start_location']['latitude'])

    def test_manual_position_is_used_only_without_context(self):
        result = self.analyze('근처 카페를 찾아줘',
                              {'name': '선택 위치', 'latitude': 37.5, 'longitude': 127.0}, 3)
        self.assertFalse(result['location_context']['needs_confirmation'])
        self.assertEqual(result['search_center']['latitude'], 37.5)
        self.assertEqual(result['radius_km'], 3)

    def test_parse_endpoint_passes_resolved_center(self):
        result = parse(ParseRequest(text='명동 주변 1km에서 쇼핑', analysis_mode='legacy'))
        self.assertEqual(result['search_center']['name'], '명동')
        self.assertEqual(result['radius_km'], 1)

    def test_route_does_not_expand_selected_radius(self):
        request = {'start_location': {'latitude': 37.5547, 'longitude': 126.9707},
                   'search_center': {'latitude': 37.478, 'longitude': 126.952}, 'radius_km': 1,
                   'activities': [{'id': 1, 'category': 'bowling', 'keywords': ['볼링']}]}
        routes = recommend_routes(request)
        self.assertTrue(routes)
        for route in routes:
            for node in route['nodes']:
                self.assertLessEqual(haversine(37.478, 126.952, node['place']['lat'], node['place']['lng']), 1)
            self.assertGreater(route['nodes'][0]['distance_km'], 5)
        request['activities'] = [{'id': 1, 'category': 'night_view', 'keywords': ['야경']}]
        self.assertEqual(recommend_routes(request), [])

    def test_route_endpoint_rejects_missing_position(self):
        with self.assertRaises(HTTPException) as raised:
            route_recommend(RouteRecommendRequest(start_location={}, activities=[]))
        self.assertEqual(raised.exception.status_code, 422)

    @patch('backend.location_context.KAKAO_REST_API_KEY', 'test-key')
    @patch('backend.location_context.urllib.request.urlopen')
    def test_ambiguous_live_place_is_not_chosen_arbitrarily(self, urlopen):
        import io
        urlopen.return_value.__enter__.return_value = io.StringIO(
            '{"documents":[{"place_name":"중앙역","x":"126.9","y":"37.5"},'
            '{"place_name":"중앙역","x":"129.0","y":"35.1"}]}')
        self.assertIsNone(resolve_place('중앙역'))


if __name__ == '__main__':
    unittest.main()
