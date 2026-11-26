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

    def test_public_schedule_uses_the_requested_weekday_and_last_entry(self):
        museum = {'operating_hours': {
            'hours': '- 월요일~화요일/목요일~금요일/일요일 10:00~18:00 (입장 마감 17:30)'
                     '- 수요일/토요일 10:00~21:00 (입장 마감 20:30)',
            'holidays': '1월 1일 / 설·추석 당일',
        }}
        self.assertIsNone(availability_warning(museum, '2026-12-05', 19 * 60, 20 * 60))
        self.assertIn('영업시간', availability_warning(museum, '2026-12-04', 19 * 60)['reason'])
        self.assertIn('입장 마감', availability_warning(museum, '2026-12-05', 20 * 60 + 30)['reason'])

    def test_flexible_visit_waits_for_break_and_flags_late_fixed_game(self):
        activities = [
            {'id': 1, 'category': 'restaurant', 'preferred_time': '12:45', 'duration_minutes': 45},
            {'id': 2, 'category': 'baseball_game', 'start_time': '14:00', 'duration_minutes': 150,
             'fixed_time': True, 'official_event_time': True},
        ]
        restaurant = {'name': '식당', 'operating_hours': {
            'hours': '평일 18:00~23:00 / 주말 12:00~20:00 (브레이크타임 13:00~14:00) / 월요일 휴무',
        }}
        route = {'travel_date': '2026-12-05', 'nodes': [
            {'place': restaurant}, {'place': {'name': '경기장'}, 'travel_minutes': 20, 'travel_source': 'osm'},
        ]}
        result = validate_schedule(activities, route)
        meal, game = result['timeline']
        self.assertTrue(meal['availability_checked'])
        self.assertEqual((meal['estimated_start'], meal['estimated_end'], meal['opening_wait_minutes']),
                         ('14:00', '14:45', 75))
        self.assertEqual((game['planned_start'], game['arrival_time'], game['buffer_minutes'], game['travel_source']),
                         ('14:00', '15:15', 10, 'osm'))
        self.assertTrue(game['official_event_time'])
        self.assertFalse(result['feasible'])
        self.assertEqual(result['conflicts'][0]['shortage_minutes'], 75)
        self.assertIn('정기 휴무', availability_warning(restaurant, '2026-12-07', None)['reason'])
        self.assertIn('영업시간', availability_warning(restaurant, '2026-12-04', 14 * 60)['reason'])

    def test_dated_flexible_visit_can_wait_for_opening_and_unknown_hours_stay_unconfirmed(self):
        activities = [{'id': 1, 'category': 'shopping'}, {'id': 2, 'category': 'restaurant'}]
        route = {'travel_date': '2026-12-05', 'nodes': [
            {'place': {'operating_hours': {'hours': '평일 09:00~18:00 / 주말 11:00~20:00'}}},
            {'place': {'operating_hours': {'hours': '점포 별로 상이함'}}, 'travel_minutes': 20},
        ]}
        result = validate_schedule(activities, route)
        shopping, restaurant = result['timeline']
        self.assertEqual((shopping['estimated_start'], restaurant['arrival_time']), ('11:00', '12:30'))
        self.assertTrue(shopping['availability_checked'])
        self.assertFalse(restaurant['availability_checked'])
        self.assertIsNone(restaurant['visit_warning'])


if __name__ == "__main__":
    unittest.main()
