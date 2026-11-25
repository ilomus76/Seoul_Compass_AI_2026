"""장소 데이터 파이프라인: 수집 JSON을 검증·정규화해 sample_places.json을 갱신한다.

사용: python scripts/build_places.py [입력파일] [출력파일]
기본: data/sample_places.json → data/sample_places.json
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ["id", "name", "category", "lat", "lng"]
DEFAULT_IN = ROOT / "data" / "sample_places.json"
DEFAULT_OUT = DEFAULT_IN


def normalize(raw: dict) -> dict:
    """필수 필드 검증과 정규화를 수행한다."""
    places = raw.get("places", [])
    errors = []
    seen, cleaned = set(), []
    for index, place in enumerate(places):
        missing = [k for k in REQUIRED if place.get(k) in (None, "")]
        if missing:
            errors.append(f"#{index}: 누락 필드 {missing}")
            continue
        if place["id"] in seen:
            errors.append(f"#{index}: 중복 id {place['id']}")
            continue
        seen.add(place["id"])
        row = dict(place)
        row["category"] = str(row["category"]).strip().lower()
        row["lat"] = float(row["lat"])
        row["lng"] = float(row["lng"])
        row["fee_krw"] = int(row.get("fee_krw") or 0)
        row["rating"] = float(row.get("rating") or 0)
        row["confidence"] = float(row.get("confidence") or 0)
        row["indoor"] = bool(row.get("indoor", False))
        row["keywords"] = [str(k) for k in row.get("keywords", [])]
        if not row.get("crowd_by_hour"):
            row["crowd_by_hour"] = {
                str(h): 20 + (hash(row["id"] + str(h)) % 70) for h in range(8, 23)
            }
        cleaned.append(row)
    if errors:
        raise ValueError("데이터 검증 실패:\n" + "\n".join(errors))
    cleaned.sort(key=lambda p: p["id"])
    raw["places"] = cleaned
    raw["meta"] = {
        "description": "서울컴파스 AI 샘플 장소 데이터 (파이프라인 정규화 적용)",
        "version": raw.get("meta", {}).get("version", "1.0"),
        "normalized": True,
        "count": len(cleaned),
    }
    return raw


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    raw = json.loads(src.read_text(encoding="utf-8"))
    result = normalize(raw)
    dst.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[pipeline] 검증 완료: {len(result['places'])}곳 → {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
