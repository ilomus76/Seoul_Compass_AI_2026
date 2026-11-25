"""다국어 자연어 입력 테스트."""
import unittest

from backend.ai_parser import parse_user_request, extract_times


class MultilingualTests(unittest.TestCase):
    def test_english(self):
        text = "I want to go hiking at 9am, meet a friend at 2pm, and go bowling at 6pm"
        result = parse_user_request(text)
        cats = [a["category"] for a in result["activities"]]
        self.assertIn("hiking", cats)
        self.assertIn("meeting", cats)
        self.assertIn("bowling", cats)
        times = [a["start_time"] for a in result["activities"]]
        self.assertIn("09:00", times)
        self.assertIn("14:00", times)

    def test_japanese(self):
        text = "午前9時に登山、午後2時に待ち合わせ、午後6時にボウリング"
        result = parse_user_request(text)
        cats = [a["category"] for a in result["activities"]]
        self.assertIn("hiking", cats)
        self.assertIn("meeting", cats)

    def test_chinese(self):
        text = "上午9点爬山，下午2点见面，下午6点保龄球"
        result = parse_user_request(text)
        cats = [a["category"] for a in result["activities"]]
        self.assertIn("hiking", cats)
        self.assertIn("meeting", cats)

    def test_time_range_english(self):
        times = extract_times("I want to shop from 2 to 4 pm")
        self.assertIn("14:00", [t["time"] for t in times])
        self.assertIn("16:00", [t["time"] for t in times])

    def test_korean_unchanged(self):
        result = parse_user_request("오후2시부터 4시까지 쇼핑을 하고싶어")
        self.assertIn("shopping", [a["category"] for a in result["activities"]])


if __name__ == "__main__":
    unittest.main()
