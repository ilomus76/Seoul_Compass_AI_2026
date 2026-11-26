"""경로 최적화 테스트 (AGENTS.md 22.3)."""
import unittest

from backend.optimizer import recommend_routes
from backend.places import load_places
from backend.ai_parser import parse_user_request
from backend.direction import haversine
from backend.place_clusters import cluster_places


class OptimizerTests(unittest.TestCase):
    def test_route_list_keeps_meal_alternatives_after_later_stops(self):
        latitude, longitude = 37.55, 126.97

        def place(name, category, meters):
            return {'id': name, 'name': name, 'category': category, 'lat': latitude + meters / 111195,
                    'lng': longitude, 'distance_km': meters / 1000}

        meals = [place('near', 'restaurant', 0), place('other', 'restaurant', 400),
                 place('too_far', 'restaurant', 2000)]
        stops = [place(f'shop-{i}', 'shopping', i * 60) for i in range(5)]
        request = {'start_location': {'latitude': latitude, 'longitude': longitude},
                   'activities': [{'id': 1, 'category': 'restaurant', 'start_time': '12:00', 'duration_minutes': 20},
                                  {'id': 2, 'category': 'shopping', 'start_time': '12:40', 'fixed_time': True}]}
        routes = recommend_routes(request, [meals, stops], include_infeasible=True)
        self.assertEqual([r['nodes'][0]['place']['id'] for r in routes[:2]], ['near', 'other'])
        self.assertTrue(all(not r['schedule']['conflicts'] for r in routes))

    def test_ten_cafes_form_three_distinct_route_stops(self):
        latitude, longitude = 37.55, 126.97
        offsets = (0, 5, 10, 100, 105, 110, 200, 205, 210, 215)
        cafes = [{"id": str(i), "name": f"커피숍 {i}", "category": "cafe", "lat": latitude + m / 111195,
                  "lng": longitude, "distance_km": m / 1000} for i, m in enumerate(offsets)]
        groups = cluster_places(cafes)
        self.assertEqual(sorted(g['size'] for g in groups), [3, 3, 4])
        by_id = {c['id']: c for c in cafes}
        for group in groups:
            center = group['center']
            for member in group['place_ids']:
                place = by_id[member]
                self.assertLessEqual(haversine(center['lat'], center['lng'], place['lat'], place['lng']), .05)
            for other in groups:
                if group is not other:
                    self.assertGreaterEqual(haversine(center['lat'], center['lng'],
                                                      other['center']['lat'], other['center']['lng']), .05)
        origin = {'latitude': latitude + .0013, 'longitude': longitude}
        routes = recommend_routes({'start_location': origin, 'activities': [
            {'id': 1, 'category': 'cafe', 'request_term': '커피'}]}, [cafes])
        self.assertEqual(len(routes), 3)
        for route in routes:
            node = route['nodes'][0]
            center = node['cluster']['center']
            self.assertEqual(node['request_term'], '커피')
            self.assertEqual(node['distance_km'], round(haversine(origin['latitude'], longitude,
                                                                center['lat'], center['lng']), 2))
        self.assertTrue(any(r['nodes'][0]['place']['lat'] != r['nodes'][0]['cluster']['center']['lat']
                            for r in routes))

    def test_request_words_preserved_for_display(self):
        parsed = parse_user_request('서울역에서 출발해서 커피를 마시고 식사를 한 뒤 백화점에 가고 싶어요.')
        self.assertEqual([a['request_term'] for a in parsed['activities']], ['커피', '식사', '백화점'])
        parsed = parse_user_request('15시에 순댓국을 먹어요.')
        self.assertEqual(parsed['activities'][0]['request_term'], '순댓국')

    def test_five_distinct_routes_with_duplicate_inputs(self):
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
        start = request["start_location"]
        def place(id, lat, category):
            return {"id": id, "name": id, "lat": lat, "lng": start["longitude"],
                    "category": category, "distance_km": 0, "keywords": []}

        hike = place("hike", start["latitude"], "hiking")
        food = [place(f"food-{i}", start["latitude"] + i / 1000, "restaurant") for i in range(1, 7)]
        groups = [[hike, hike], food]
        for preview in (False, True):
            routes = recommend_routes(request, groups, preview=preview)
            combinations = {tuple(n["place"]["id"] for n in route["nodes"]) for route in routes}
            self.assertEqual(len(routes), 5)
            self.assertEqual(len(combinations), 5)
            if preview:
                self.assertTrue(all(r["schedule"] is None and r["total_travel_minutes"] is None for r in routes))

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
