"""자연어 요구사항 분석 (규칙 기반, 다국어 지원).

한국어/영어/일본어/중국어 입력에서 활동과 시간을 구조화한다.
LLM API 키가 없어도 동작하며, 실제 LLM 연결 시 이 모듈만 교체하면 된다.
"""
import re
from typing import Dict, List

# 키워드 → 활동 카테고리 매핑 (확장 가능한 구조)
KEYWORD_RULES = [
    ("hiking", ["등산", "산행", "관악산", "북한산", "등산로", "hiking", "trail", "登山", "ハイキング", "爬山"]),
    ("shower", ["샤워", "목욕", "찜질방", "shower", "bath", "シャワー", "淋浴"]),
    ("meeting", ["만나", "약속", "미팅", "meeting", "meet", "appointment", "待ち合わせ", "见面", "會面"]),
    ("restaurant", ["고등어", "회", "술", "식사", "먹", "맛집", "restaurant", "food", "mackerel",
                    "sushi", "drink", "食事", "レストラン", "吃饭"]),
    ("bowling", ["볼링", "bowling", "ボウリング", "保龄球"]),
    ("international_tourism_area", ["외국인", "국제", "이태원", "관광객", "foreigner",
                                    "international", "itaewon", "外国人", "国際"]),
    ("subway_station", ["지하철역", "지하철", "역으로", "subway", "station", "地下鉄", "地铁"]),
    ("return_home", ["귀가", "home", "go home", "帰宅", "回家"]),
    ("shopping", ["쇼핑", "명동", "백화점", "shopping", "shop", "myeongdong", "買い物", "购物"]),
    ("cafe", ["카페", "커피", "cafe", "coffee", "カフェ", "咖啡"]),
    ("night_view", ["야경", "전망", "night view", "night", "view", "夜景"]),
    ("culture", ["박물관", "미술관", "궁궐", "한옥", "museum", "palace", "博物館", "博物馆"]),
    ("park", ["공원", "한강", "산책", "park", "han river", "公園", "公园"]),
]


def extract_times(text: str) -> List[Dict]:
    """질문에서 시간 표현(다국어)을 순서대로 추출한다."""
    found: List[Dict] = []

    # 한국어: 오전/오후 2시, 14:00, 12시에 (숫자만 있는 '5km' 등은 시간으로 보지 않음)
    for m in re.finditer(r"(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*(?::(\d{2})|시)", text):
        prefix, hour, minute = m.group(1), int(m.group(2)), m.group(3)
        if hour > 23:
            continue
        if not prefix:
            # "오후 2시부터 4시까지"처럼 뒤의 시각에도 오후 컨텍스트를 유지한다.
            earlier_prefix = re.findall(r"(오전|오후|아침|저녁|밤)", text[:m.start()])
            prefix = earlier_prefix[-1] if earlier_prefix else None
        if prefix in ("오후", "저녁", "밤") and hour < 12:
            hour += 12
        # 12시는 정오로 처리 (상속된 오전 접두어로 자정이 되지 않게)
        found.append({"time": f"{hour:02d}:{int(minute) if minute else 0:02d}",
                      "position": m.start(), "raw": m.group(0).strip()})

    # 영어: 9am / 2 pm / 14:00
    for m in re.finditer(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text, re.I):
        hour, minute, mer = int(m.group(1)), m.group(2), m.group(3).lower()
        if mer == "pm" and hour < 12:
            hour += 12
        if mer == "am" and hour == 12:
            hour = 0
        found.append({"time": f"{hour:02d}:{int(minute) if minute else 0:02d}",
                      "position": m.start(), "raw": m.group(0).strip()})
    for m in re.finditer(r"\b(\d{1,2}):(\d{2})\b", text):
        found.append({"time": f"{int(m.group(1)):02d}:{m.group(2)}", "position": m.start()})
    # "from 2 to 4 pm" / "2-4pm" — 뒤의 pm을 앞 숫자에도 적용
    m = re.search(r"\b(?:from|between)?\s*(\d{1,2})\s*(?:to|and|~|-)\s*(\d{1,2})\s*(am|pm)\b", text, re.I)
    if m:
        a, b, mer = int(m.group(1)), int(m.group(2)), m.group(3).lower()
        if mer == "pm":
            if a < 12: a += 12
            if b < 12: b += 12
        found.append({"time": f"{a:02d}:00", "position": m.start()})
        found.append({"time": f"{b:02d}:00", "position": m.start() + 1})

    # 일본어: 午後2時 / 14時
    for m in re.finditer(r"(午前|午後)?\s*(\d{1,2})\s*時", text):
        prefix, hour = m.group(1), int(m.group(2))
        if prefix == "午後" and hour < 12:
            hour += 12
        found.append({"time": f"{hour:02d}:00", "position": m.start()})

    # 중국어: 下午2点 / 14点
    for m in re.finditer(r"(上午|下午)?\s*(\d{1,2})\s*[点位]", text):
        prefix, hour = m.group(1), int(m.group(2))
        if prefix == "下午" and hour < 12:
            hour += 12
        found.append({"time": f"{hour:02d}:00", "position": m.start()})

    found.sort(key=lambda x: x["position"])
    seen, unique = set(), []
    for item in found:
        if item["time"] not in seen:
            seen.add(item["time"])
            unique.append(item)
    return unique


# 다국어 키워드를 샘플 데이터/검색 엔진이 아는 표준 키워드로 변환한다.
SYNONYMS = {
    "登山": ["등산", "hiking"], "ハイキング": ["등산", "hiking"], "爬山": ["등산", "hiking"],
    "シャワー": ["샤워", "shower"], "淋浴": ["샤워", "shower"],
    "待ち合わせ": ["약속", "meeting"], "见面": ["약속", "meeting"], "會面": ["약속", "meeting"],
    "食事": ["식사", "맛집"], "レストラン": ["맛집", "restaurant"], "吃饭": ["맛집", "restaurant"],
    "ボウリング": ["볼링", "bowling"], "保龄球": ["볼링", "bowling"],
    "外国人": ["외국인", "이태원"], "国際": ["국제", "이태원"],
    "地下鉄": ["지하철", "subway"], "地铁": ["지하철", "subway"],
    "帰宅": ["귀가", "home"], "回家": ["귀가", "home"],
    "買い物": ["쇼핑", "shopping"], "购物": ["쇼핑", "shopping"],
    "カフェ": ["카페", "cafe"], "咖啡": ["카페", "cafe"],
    "夜景": ["야경", "night view"],
    "博物館": ["박물관", "museum"], "博物馆": ["박물관", "museum"],
    "公園": ["공원", "park"], "公园": ["공원", "park"],
}


def parse_date(text: str) -> str | None:
    """질문에서 여행 날짜를 YYYY-MM-DD로 추출한다."""
    from datetime import date, timedelta
    m = re.search(r"(20\d\d)[년\-/\.]\s*(\d{1,2})[월\-/\.]\s*(\d{1,2})", text)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(?<!\d)(\d{1,2})월\s*(\d{1,2})일", text)
    if m:
        return f"{date.today().year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    lower = text.lower()
    if "오늘" in text or "today" in lower:
        return date.today().isoformat()
    if "내일" in text or "tomorrow" in lower:
        return (date.today() + timedelta(days=1)).isoformat()
    return None


def canonical_keywords(keywords: List[str], category: str) -> List[str]:
    """다국어 키워드를 표준 키워드로 확장한다."""
    result = [category]
    for word in keywords:
        result.extend(SYNONYMS.get(word, [word]))
    return list(dict.fromkeys(result))


def find_location(text: str) -> str | None:
    """약속 장소(역)를 다국어 패턴으로 찾는다."""
    for pattern in (r"([\w가-힣]+역)", r"([A-Za-z]+(?:\s+[A-Za-z]+)*\s+Station)",
                    r"([^\s]+駅)", r"([^\s]+站)"):
        m = re.search(pattern, text)
        if m:
            return m.group(1)
    return None


def chunk_text(text: str) -> List[Dict]:
    """입력 문장을 날짜·시간·장소·활동·특이사항 청크로 분리한다."""
    chunks: List[Dict] = []

    def add(kind, start, raw, normalized):
        chunks.append({"type": kind, "start": start, "text": raw, "value": normalized})

    for pattern in (r"20\d\d[년\-/\.]\s*\d{1,2}[월\-/\.]\s*\d{1,2}일?",
                    r"(?<!\d)\d{1,2}월\s*\d{1,2}일", r"오늘|내일|today|tomorrow|今日|明天"):
        for m in re.finditer(pattern, text, re.I):
            add("date", m.start(), m.group(0), parse_date(m.group(0)) or m.group(0))
    for t in extract_times(text):
        raw = t.get("raw") or text[t["position"]:t["position"] + 6].strip()
        add("time", t["position"], raw, t["time"])

    place_words = ["관악산", "신림역", "이태원", "명동", "경복궁", "남산", "서울역", "홍대", "성수동", "북한산"]
    for word in place_words:
        for m in re.finditer(re.escape(word), text):
            add("place", m.start(), m.group(0), word)

    for category, keywords in KEYWORD_RULES:
        for word in keywords:
            for m in re.finditer(re.escape(word), text, re.I):
                add("activity", m.start(), m.group(0), category)

    for pattern, label in [
        (r"예산\s*(?:은\s*)?\d+\s*(?:만원|원)", "예산"),
        (r"비\s*와|우천|rain", "우천"),
        (r"실내만|실내로|indoor", "실내 선호"),
        (r"야외만|실외|outdoor", "실외 선호"),
        (r"동행|친구|만나", "동행"),
    ]:
        for m in re.finditer(pattern, text, re.I):
            add("note", m.start(), m.group(0), label)

    chunks.sort(key=lambda c: (c["start"], c["type"]))
    return chunks


def parse_user_request(text: str) -> Dict:
    """질문을 AGENTS.md 4.2 형태의 구조화된 dict로 변환한다."""
    times = extract_times(text)
    chunks = chunk_text(text)
    fixed_categories = {"hiking", "meeting", "bowling", "subway_station"}
    candidates = []

    for category, keywords in KEYWORD_RULES:
        positions = [text.lower().find(k.lower()) for k in keywords if k.lower() in text.lower()]
        if not positions:
            continue
        matched = next(k for k in keywords if k.lower() in text.lower())
        candidates.append({"category": category, "position": min(positions), "matched": matched,
                           "keywords": [k for k in keywords if k.lower() in text.lower()]})
    # 사용자가 말한 순서를 유지한다.
    candidates.sort(key=lambda c: c["position"])

    activities = []
    for item in candidates:
        category, position = item["category"], item["position"]
        before = [t for t in times if t["position"] < position]
        after = [t for t in times if t["position"] >= position]
        last_time = before[-1]["time"] if before else None
        next_time = after[0]["time"] if after else None
        # 활동 키워드 바로 앞의 시간을 사용한다(가장 가까운 시간은 다음 활동 것을 끌어올 수 있음).
        chosen = last_time or next_time
        window = text[max(0, position - 30):position + 30]
        has_range = bool(re.search(r"부터|까지|~|from|to\b", window, re.I))
        # "2시부터 5시까지 등산"은 시작 시각을 사용한다.
        effective = before[-2]["time"] if has_range and len(before) >= 2 else chosen

        activity = {
            "id": len(activities) + 1, "category": category, "keyword": item["matched"],
            "keywords": item["keywords"], "start_time": None, "earliest_start": None,
            "latest_end": None, "preferred_time": None, "fixed_time": False,
            "fixed_location": category in ("meeting", "subway_station"),
            "required": True, "duration_minutes": 60,
        }
        if category in fixed_categories:
            activity["start_time"] = effective
            activity["fixed_time"] = effective is not None
        elif category == "shower":
            activity["earliest_start"] = effective
            activity["latest_end"] = next_time
        else:
            activity["preferred_time"] = after[0]["time"] if has_range and after else effective
        if category == "meeting":
            activity["location"] = find_location(text)
        nearby_places = [c for c in chunks if c["type"] == "place"]
        if nearby_places:
            closest = min(nearby_places, key=lambda c: abs(c["start"] - position))
            activity["place"] = closest["value"] if abs(closest["start"] - position) <= 80 else None
        else:
            activity["place"] = None
        activity["keywords"] = canonical_keywords(activity["keywords"], category)
        activities.append(activity)

    travel_date = parse_date(text)
    warnings = []
    if travel_date is None:
        warnings.append("여행 날짜가 지정되지 않아 날짜 정보는 null입니다.")
    if not any(k in text.lower() for k in ["집으로", "귀가", "집에", "go home", "帰宅", "回家"]):
        warnings.append("귀가 목적지가 지정되지 않아 확인이 필요합니다.")

    # 목적과 특이사항을 별도 항목으로 정리한다(GyuHyeon.md 2번 요구).
    purpose = list(dict.fromkeys(a["category"] for a in activities))
    notes = []
    for pattern, label in [
        (r"비\s*와|우천|rain|비가", "우천 가능성"),
        (r"실내만|실내로|indoor", "실내 선호"),
        (r"야외만|실외|outdoor", "실외 선호"),
        (r"예산\s*(\d+)\s*원|budget\s*(\d+)", "예산 제한"),
        (r"혼잡|붐빔|crowded", "혼잡도 민감"),
        (r"동행|친구|만나", "동행 있음"),
    ]:
        if re.search(pattern, text, re.I):
            notes.append(label)

    return {
        "start_location": {"type": "current_location", "latitude": None, "longitude": None},
        "travel_date": travel_date,
        "budget_krw": (
            int(_bm.group(1)) * 10000 if _bm.group(2) else
            (int(_bm.group(3)) if _bm.group(3) else int(_bm.group(1)))
        ) if (_bm := re.search(r"예산\s*(?:은\s*)?(\d+)\s*(만원|원)|budget\s*(\d+)", text, re.I)) else None,
        "radius_km": 5.0,
        "transport_modes": ["walking", "bus", "subway"],
        "purpose": purpose,
        "special_notes": notes,
        "chunks": chunks,
        "activities": activities,
        "warnings": warnings,
    }
