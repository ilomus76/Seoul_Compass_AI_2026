"""일정 충돌 테스트 (AGENTS.md 22.2)."""
import unittest

from backend.schedule import availability_warning, to_clock, to_minutes, travel_minutes, validate_schedule


class ScheduleTests(unittest.TestCase):
    def test_time_conversion(self):
        self.assertEqual(to_minutes("14:00"), 840)
        self.assertEqual(to_clock(840), "14:00")

    def test_travel_estimate(self):
        self.assertTrue(travel_minutes(0, "walking") >= 1)
        self.assertTrue(travel_minutes(10, "walking") > travel_minutes(1, "walking"))

    def test_fixed_time_kept(self):
        activity = {"id": 1, "category": "meeting", "start_time": "14:00",
                    "duration_minutes": 60, "fixed_time": True}
        route = {"nodes": [{"place": {"name": "신림역"}}]}
        result = validate_schedule([activity], route)
        self.assertTrue(result["feasible"])
        self.assertEqual(result["timeline"][0]["estimated_start"], "14:00")

    def test_published_hours_and_weekly_closure_are_evaluated_at_local_visit_time(self):
        place = {'operating_hours': {'hours': '18:00~02:00', 'holidays': '매주 월요일', 'source': '한국관광공사'}}
        self.assertIsNone(availability_warning(place, '2026-12-06', 25 * 60, 26 * 60))
        self.assertIn('정기 휴무', availability_warning(place, '2026-12-07', 18 * 60)['reason'])
        self.assertIn('영업시간', availability_warning(place, '2026-12-08', 17 * 60)['reason'])
        self.assertIn('영업시간', availability_warning(place, '2026-12-08', 25 * 60, 27 * 60)['reason'])
        self.assertIsNone(availability_warning({}, '2026-12-08', 17 * 60))
        self.assertIsNone(availability_warning(place, '2026-12-08', None))
        self.assertIn('폐업', availability_warning({'operating_hours': {'holidays': '폐업'}}, None, None)['reason'])
        food = {'operating_hours': {'hours': '10:00 ~ 22:00 (주문 마감 21:00)'}}
        self.assertIn('영업시간', availability_warning(food, None, 6 * 60)['reason'])
        self.assertIn('주문 마감', availability_warning(food, None, 21 * 60)['reason'])
        self.assertIsNone(availability_warning(food, None, 20 * 60 + 55, 21 * 60 + 25))


if __name__ == "__main__":
    unittest.main()
