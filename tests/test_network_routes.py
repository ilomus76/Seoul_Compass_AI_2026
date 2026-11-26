"""조회한 이동 선형을 경유지별로 분리하고 오류 시 추정을 유지한다."""
import unittest
from unittest.mock import patch

from backend import network_routes


class NetworkRoutesTests(unittest.TestCase):
    def tearDown(self):
        network_routes.road_chain.cache_clear()
        network_routes.rail_leg.cache_clear()

    @patch('backend.network_routes.read_json')
    def test_road_legs_keep_bends_and_do_not_bridge_waypoints(self, fetch):
        a, b, c = (126.97, 37.55), (126.972, 37.55), (126.974, 37.55)
        bend = (126.971, 37.551)

        def leg(*positions):
            return {'distance': 250, 'duration': 210, 'steps': [
                {'geometry': {'coordinates': positions}}]}

        fetch.return_value = {'code': 'Ok', 'routes': [{'legs': [leg(a, bend, b), leg(b, c)]}]}
        result = network_routes.lookup('cycling', [
            {'index': 1, 'start': network_routes.point(*a), 'end': network_routes.point(*b)},
            {'index': 2, 'start': network_routes.point(*b), 'end': network_routes.point(*c)},
        ])
        self.assertIn('/routed-bike/', fetch.call_args.args[0])
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual([p['index'] for p in result['legs']], [1, 2])
        self.assertEqual(result['legs'][0]['paths'][0][1], network_routes.point(*bend))

    @patch('backend.network_routes.ODSAY_API_KEY', 'test-key')
    @patch('backend.network_routes.odsay')
    def test_track_sections_remain_separate(self, provider):
        west = [{'x': 126.97, 'y': 37.55}, {'x': 126.98, 'y': 37.55}]
        east = [{'x': 127.01, 'y': 37.56}, {'x': 127.02, 'y': 37.56}]
        provider.side_effect = [
            {'path': [{'pathType': 1, 'info': {'mapObj': '126:37@1:2:10:12', 'totalTime': 20}}]},
            {'lane': [{'section': [{'graphPos': west}, {'graphPos': east}]}]},
        ]
        result = network_routes.lookup('subway', [{'index': 2, 'start': {'lat': 37.55, 'lng': 126.97},
                                                   'end': {'lat': 37.56, 'lng': 127.02}}])
        provider.assert_called_with('loadLane', mapObject='0:0@1:2:10:12')
        self.assertEqual([len(path) for path in result['legs'][0]['paths']], [2, 2])

    @patch('backend.network_routes.ODSAY_API_KEY', '')
    def test_train_without_key_has_no_fake_line(self):
        self.assertEqual(network_routes.lookup('train', []), {'status': 'missing_key', 'legs': []})
