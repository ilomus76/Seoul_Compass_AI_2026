"""여행 기록 저장/조회/삭제 테스트 (AGENTS.md 22.5)."""
import unittest
import uuid

from backend import history


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.trip_id = "test_" + uuid.uuid4().hex[:8]
        self.payload = {
            "trip_id": self.trip_id, "user_id": "test_user", "date": "2026-12-11",
            "start_location": {"type": "custom", "latitude": 37.5, "longitude": 127.0},
            "activities": [], "routes": []
        }

    def tearDown(self):
        history.delete_trip(self.trip_id)

    def test_save_and_get(self):
        history.save_trip(self.payload)
        trip = history.get_trip(self.trip_id)
        self.assertIsNotNone(trip)
        self.assertEqual(trip["date"], "2026-12-11")

    def test_visit_and_delete(self):
        history.save_trip(self.payload)
        history.add_visit(self.trip_id, {"place_name": "관악산", "status": "visited"})
        visits = history.list_visits(self.trip_id)
        self.assertEqual(len(visits), 1)
        self.assertTrue(history.delete_trip(self.trip_id))
        self.assertIsNone(history.get_trip(self.trip_id))


if __name__ == "__main__":
    unittest.main()
