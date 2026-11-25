"""경로 최적화 테스트 (AGENTS.md 22.3)."""
import unittest

from backend.optimizer import recommend_routes
from backend.places import load_places


class OptimizerTests(unittest.TestCase):
    def test_top3_limit(self):
        request = {
            "start_location": {"latitude": 37.4783, "longitude": 126.9514},
            "activities": [
                {"id": 1, "category": "hiking", "keywords": ["등산"], "required": True,
                 "start_time": "09:00", "duration_minutes": 60},
                {"id": 2, "category": "restaurant", "keywords": ["고등어"], "required": True,
                 "duration_minutes": 60},
            ],
            "radius_km": 5,
        }
        routes = recommend_routes(request)
        self.assertLessEqual(len(routes), 3)

    def test_no_fake_places(self):
        ids = {p["id"] for p in load_places()}
        request = {
            "start_location": {"latitude": 37.5665, "longitude": 126.978},
            "activities": [{"id": 1, "category": "shopping", "keywords": ["쇼핑"],
                            "required": True, "duration_minutes": 60}],
            "radius_km": 5,
        }
        for route in recommend_routes(request):
            for node in route["nodes"]:
                self.assertIn(node["place"]["id"], ids)


if __name__ == "__main__":
    unittest.main()
