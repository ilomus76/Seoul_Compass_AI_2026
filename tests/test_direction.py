"""방위각과 방향 구역 테스트 (AGENTS.md 22.1)."""
import unittest

from backend.direction import (calculate_bearing, direction_index, get_direction,
                               haversine)


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


if __name__ == "__main__":
    unittest.main()
