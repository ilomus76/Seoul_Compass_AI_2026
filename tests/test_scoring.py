"""점수 계산 테스트 (AGENTS.md 7.3)."""
import unittest

from backend.scoring import normalize_weights, score_place

PLACE = {"name": "테스트", "category": "cafe", "keywords": ["카페"],
         "distance_km": 1.0, "rating": 4.5, "confidence": 0.9, "indoor": True}


class ScoringTests(unittest.TestCase):
    def test_normalize(self):
        w = normalize_weights({"M": 50, "D": 25, "Q": 20, "V": 15})
        self.assertAlmostEqual(sum(w.values()), 1.0)

    def test_score_range(self):
        score = score_place(PLACE, ["카페"], 5.0)
        self.assertTrue(0 <= score <= 100)

    def test_no_interests(self):
        self.assertTrue(0 <= score_place(PLACE, [], 5.0) <= 100)


if __name__ == "__main__":
    unittest.main()
