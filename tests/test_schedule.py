"""일정 충돌 테스트 (AGENTS.md 22.2)."""
import unittest

from backend.schedule import to_clock, to_minutes, travel_minutes, validate_schedule


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


if __name__ == "__main__":
    unittest.main()
