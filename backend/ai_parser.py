"""자연어 요구사항 분석 (규칙 기반, 다국어 지원).

한국어/영어/일본어/중국어 입력에서 활동과 시간을 구조화한다.
LLM API 키가 없어도 동작하며, 실제 LLM 연결 시 이 모듈만 교체하면 된다.
"""
import re
from typing import Dict, List
from datetime import datetime, timedelta, timezone
from .location_context import context_names, normalize_request_text

# 키워드 → 활동 카테고리 매핑 (확장 가능한 구조)
KEYWORD_RULES = [
    ("hiking", ["등산", "산행", "관악산", "북한산", "등산로", "hiking", "trail", "登山", "ハイキング", "爬山"]),
    ("shower", ["샤워", "목욕", "찜질방", "shower", "bath", "シャワー", "淋浴"]),
    ("swimming", ["수영", "수영장", "swimming", "swim", "水泳", "游泳"]),
    ("meeting", ["만나", "약속", "미팅", "meeting", "meet", "appointment", "待ち合わせ", "见面", "會面"]),
    ("restaurant", ["순대국", "순댓국", "고등어", "회", "술", "식사", "먹", "맛집", "restaurant", "food", "mackerel",
                    "sushi", "drink", "食事", "レストラン", "吃饭"]),
    ("bowling", ["볼링", "bowling", "ボウリング", "保龄球"]),
    ("international_tourism_area", ["외국인", "국제", "이태원", "관광객", "foreigner",
                                    "international", "itaewon", "外国人", "国際"]),
    ("subway_station", ["지하철역", "지하철", "역으로", "subway", "station", "地下鉄", "地铁"]),
    ("return_home", ["귀가", "home", "go home", "帰宅", "回家"]),
    ("shopping", ["쇼핑", "명동", "백화점", "shopping", "shop", "myeongdong", "買い物", "购物"]),
    ("cafe", ["카페", "커피", "cafe", "coffee", "カフェ", "咖啡"]),
    ("night_view", ["야경", "전망", "night view", "night", "view", "夜景"]),
    ("culture", ["박물관", "미술관", "한옥", "museum", "博物館", "博物馆"]),
    ("palace", ["고궁", "궁궐", "경복궁", "창덕궁", "창경궁", "덕수궁", "경희궁", "palace"]),
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
                      "position": m.start(), "end": m.end(), "raw": m.group(0).strip()})

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
    today = datetime.now(timezone(timedelta(hours=9))).date()
    m = re.search(r"(20\d\d)[년\-/\.]\s*(\d{1,2})[월\-/\.]\s*(\d{1,2})", text)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(?<!\d)(\d{1,2})월\s*(\d{1,2})일", text)
    if m:
        return f"{today.year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    lower = text.lower()
    if "오늘" in text or "today" in lower:
        return today.isoformat()
    if "내일" in text or "tomorrow" in lower:
        return (today + timedelta(days=1)).isoformat()
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
    original_text = text
    text = normalize_request_text(text)
    location_context = context_names(text)
    times = extract_times(text)
    chunks = chunk_text(text)
    fixed_categories = {"hiking", "meeting", "bowling", "subway_station"}
    candidates = []
    market_meal = re.search(r'시장(?:에서|에|의)?[^.!?]{0,35}(?:음식|먹거리|먹|식사|맛있[는은])', text)

    for category, keywords in KEYWORD_RULES:
        matches = [(k, m.start()) for k in keywords for m in re.finditer(re.escape(k), text, re.I)]
        if category == 'restaurant' and market_meal:
            matches = [(k, pos) for k, pos in matches
                       if not market_meal.start() <= pos < market_meal.end()]
        if not matches:
            continue
        # 검색 기준으로만 언급한 산을 실제 등산 일정으로 추가하지 않는다.
        if category == 'hiking' and re.search(r'(?:기준|중심|주변|근처|근방|인근)', text):
            actions = ['등산', '산행', '오르', '오를', '올라', '올랐', 'hiking', 'trail', '登山', 'ハイキング', '爬山']
            if not any(word in text.lower() for word in actions):
                continue
        terms = list(dict.fromkeys(k for k, _ in matches))
        if category == 'culture' and '박물관' in terms and '역사' in text:
            museum_position = next(pos for term, pos in matches if term == '박물관')
            candidates.append({'category': 'history_museum', 'position': museum_position,
                               'matched': '박물관', 'keywords': ['박물관']})
        else:
            candidates.append({"category": category, "position": min(pos for _, pos in matches),
                               "matched": terms[0], "keywords": terms})
    if market_meal:
        candidates.append({'category': 'market_food', 'position': market_meal.start(),
                           'matched': '시장', 'keywords': ['시장']})
    if location_context['implicit_hiking'] and not any(c['category'] == 'hiking' for c in candidates):
        mountain = location_context['mountain_name']
        candidates.append({'category': 'hiking', 'position': text.index(mountain),
                           'matched': mountain, 'keywords': [mountain, '등산'], 'inferred': True})
    # 사용자가 말한 순서를 유지한다.
    candidates.sort(key=lambda c: c["position"])

    activities = []
    for item_index, item in enumerate(candidates):
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
        activity['duration_estimated'] = True
        # 시각은 해당 활동 앞의 구간에서만 연결한다. 앞 활동 시각을 뒤에 복사하지 않는다.
        previous_position = candidates[item_index - 1]['position'] if item_index else -1
        local_times = [t for t in times if previous_position < t['position'] < position]
        local_time = local_times[-1]['time'] if local_times else None
        if category == 'swimming':
            activity['duration_minutes'] = 90  # 수영·환복을 포함한 수정 가능한 추정값
            activity['preferred_time'] = None
            if local_time:
                between = text[local_times[-1]['position']:position]
                if re.search(r'내려|하산|이후|후에', between):
                    activity['earliest_start'] = local_time
                else:
                    activity['start_time'] = local_time
                    activity['fixed_time'] = True
        if category == 'restaurant':
            menu = ['순대국'] if re.search(r'순대국|순댓국', text) else []
            activity['required_keywords'] = menu
            if menu and local_time:
                activity['preferred_time'] = None
                activity['start_time'] = local_time
                activity['fixed_time'] = not bool(re.search(r'(?:시|분)\s*(?:쯤|경|무렵)',
                                                          text[local_times[-1]['position']:position]))
                if not activity['fixed_time']:
                    activity['preferred_time'] = local_time
                    activity['start_time'] = None
        if category == 'history_museum':
            limit = candidates[item_index + 1]['position'] if item_index + 1 < len(candidates) else len(text)
            # “12시에 박물관에서 나와서”는 방문 시작 시각이 아니라 종료 시각이다.
            exit_time = next((t for t in times if position < t['position'] < limit
                              and re.match(r'\s*에?\s*(?:박물관에서\s*)?(?:나와|나오|나올|나온)',
                                           text[t.get('end', t['position'] + len(t.get('raw', t['time']))):])), None)
            after_visit = [t for t in after if t['position'] < (exit_time or {}).get('position', limit)]
            start = local_time or (after_visit[0]['time'] if after_visit else None)
            activity.update(start_time=start, preferred_time=None, fixed_time=start is not None)
            if exit_time:
                activity['end_time'] = exit_time['time']
                if start:
                    hour, minute = map(int, start.split(':'))
                    end_hour, end_minute = map(int, exit_time['time'].split(':'))
                    activity['duration_minutes'] = max(0, end_hour * 60 + end_minute - hour * 60 - minute)
                    activity['duration_estimated'] = False
        if category in ('palace', 'market_food'):
            activity.update(earliest_start=local_time, preferred_time=None)
        if category == 'palace':
            named_palaces = [term for term in item['keywords'] if term not in ('고궁', '궁궐', 'palace')]
            if len(named_palaces) == 1:
                activity['required_keywords'] = named_palaces
        if category == 'hiking':
            next_position = candidates[item_index + 1]['position'] if item_index + 1 < len(candidates) else len(text)
            descent = re.search(r'(\d{1,2})\s*(?::(\d{2})|시)(?:에|쯤|경)?\s*(?:내려|하산)', text[position:next_position])
            if descent and activity.get('start_time'):
                end_time = f"{int(descent.group(1)):02d}:{int(descent.group(2) or 0):02d}"
                start_minutes = sum(int(v) * k for v, k in zip(activity['start_time'].split(':'), (60, 1)))
                end_minutes = int(descent.group(1)) * 60 + int(descent.group(2) or 0)
                activity['end_time'] = end_time
                activity['duration_minutes'] = max(0, end_minutes - start_minutes)
                activity['duration_estimated'] = False
                activity['duration_source'] = '사용자가 지정한 산행 시간창'
        # 검색 시 정규화한 키워드와 별도로, 화면에는 입력 문장의 원래 표현을 보존한다.
        display_terms = list(item['keywords'])
        if category == 'shopping' and '백화점' in display_terms:
            display_terms.insert(0, '백화점')
        if activity.get('fixed_location') and activity.get('location'):
            display_terms.insert(0, activity['location'])
        activity['request_term'] = next(
            (match.group() for term in display_terms
             if (match := re.search(re.escape(term), original_text, re.I))), None)
        activities.append(activity)

    travel_date = parse_date(text)
    warnings = []
    explicit_date = re.search(r'\d{1,2}월\s*\d{1,2}일|20\d{2}[./-]\d{1,2}[./-]\d{1,2}', text)
    if explicit_date and '내일' in text and travel_date != parse_date('내일'):
        warnings.append(f'“내일”과 명시한 날짜가 다릅니다. {travel_date}에 맞춰 분석했습니다.')
    if text != original_text:
        warnings.append('출발 문맥의 “발해서” 표현을 “출발해서”로 보정했습니다.')
    departure_match = re.search(r'출발', text)
    departure_time = None
    if (departure_match and location_context['uses_current_location'] and times
            and times[0]['position'] < departure_match.start()
            and not re.search(r'등산|산행|오르|올라', text[:departure_match.start()])):
        departure_time = times[0]['time']
        if activities and activities[0]['category'] == 'hiking':
            activities[0].update(start_time=None, fixed_time=False, duration_minutes=None,
                                 duration_estimated=True, duration_source='출발 후 이동을 제외한 산행 가능 시간 확인 필요')
        warnings.append(f'{departure_time}는 현재 위치에서 출발하는 시각으로 해석했습니다. 등산 시작 시각은 이동 후 계산합니다.')
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
        "departure_time": departure_time,
        "region_scope": '서울' if re.search(
            r'서울(?:특별시)?(?:에\s*(?:있는|가|갈)|을\s*(?:가|갈)|로\s*(?:가|갈|여행)|에서\s*(?!\s*출발)(?:역사|박물관|고궁|여행|관광|구경)|의\s*산|\s*(?:안|내|지역))|서울.*(?:산|지역).*추천',
            text) else None,
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
