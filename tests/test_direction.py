"""방위각과 방향 구역 테스트 (AGENTS.md 22.1)."""
import unittest
from unittest.mock import patch

from backend.direction import (calculate_bearing, direction_index, get_direction,
                               haversine)
from backend.direction_context import annotate_land_use


class DirectionTests(unittest.TestCase):
    def test_haversine_same_point(self):
        self.assertAlmostEqual(haversine(37.5665, 126.978, 37.5665, 126.978), 0.0)

    def test_bearing_cardinals(self):
        lat, lng = 37.5665, 126.9780
        self.assertAlmostEqual(calculate_bearing(lat, lng, lat + 0.01, lng), 0, delta=1)
        self.assertAlmostEqual(calculate_bearing(lat, lng, lat, lng + 0.01), 90, delta=1)
        self.assertAlmostEqual(calculate_bearing(lat, lng, lat - 0.01, lng), 180, delta=1)
        self.assertAlmostEqual(calculate_bearing(lat, lng, lat, lng - 0.01), 270, delta=1)

    def test_boundary(self):
        self.assertEqual(get_direction(0), "북")
        self.assertEqual(get_direction(360), "북")
        self.assertEqual(get_direction(22.4), "북")
        self.assertEqual(get_direction(22.5), "북동")  # 경계는 다음 구역 포함
        self.assertEqual(get_direction(90), "동")

    def test_index_range(self):
        for deg in (0, 45, 90, 180, 270, 359):
            self.assertTrue(0 <= direction_index(deg) < 8)

    @patch('backend.direction_context.load_land_use')
    def test_land_use_explains_only_missing_directions_with_enough_coverage(self, load_grid):
        load_grid.return_value = {
            'south': 37.45, 'west': 126.85, 'lat_step': .001, 'lng_step': .001,
            'labels': {'R': '주거지', 'B': '상업·업무지'},
            'rows': ['.' * 50 + 'R' * 51] * 101,
        }
        review = {'rows': {90: {'status': 'missing_clusters'}, 270: {'status': 'missing_clusters'},
                           0: {'status': 'selected'}}}
        annotate_land_use(review, {'latitude': 37.50, 'longitude': 126.90}, 3)
        self.assertEqual(review['rows'][90]['land_use'],
                         {'coverage_percent': 100, 'types': [{'name': '주거지', 'percent': 100}],
                          'commercial_percent': 0})
        self.assertEqual(review['rows'][270]['land_use'], {'coverage_percent': 0, 'types': []})
        self.assertNotIn('land_use', review['rows'][0])
        self.assertEqual(review['land_use_source']['year'], 2025)


if __name__ == "__main__":
    unittest.main()
