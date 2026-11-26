"""공급자가 공개한 운영시간에서 방문 가능한 연속 시간 구간을 계산한다."""
import re
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache

DAY_MINUTES = 1440
DAY_NAMES = '월화수목금토일'
CLOCK = r'(?:[01]?\d|2[0-3]):[0-5]\d'
RANGE = rf'({CLOCK})\s*[~～∼–-]\s*({CLOCK}|24:00)'
BREAK_LABEL = r'(?:브레이크\s*타임|휴게\s*시간)'
CUTOFF_LABEL = r'(주문\s*마감|입장\s*마감|라스트\s*오더)'
CLOSED = r'\s*(?:폐업|영업\s*종료|휴업|임시\s*(?:휴업|휴무))\s*'


@dataclass(frozen=True)
class Slot:
    start: int
    end: int
    cutoff: int | None = None
    cutoff_label: str | None = None


@dataclass(frozen=True)
class VisitTime:
    start: int | None
    warning: dict | None = None
    checked: bool = False


def clock_minutes(clock: str) -> int:
    hour, minute = map(int, clock.split(':'))
    return hour * 60 + minute


def weekday_set(label: str) -> frozenset[int] | None:
    """명시된 평일·주말·요일만 해석하고 의미가 불분명한 발표 문구는 보류한다."""
    label = re.sub(r'\s+', '', label.rstrip(' :：')).replace('요일', '').removeprefix('매주')
    if label in ('', '매일'):
        return frozenset(range(7))
    if label == '평일':
        return frozenset(range(5))
    if label == '주말':
        return frozenset((5, 6))
    days = set()
    for part in re.split(r'[,·ㆍ/]', label):
        if len(part) == 1 and part in DAY_NAMES:
            days.add(DAY_NAMES.index(part))
        elif re.fullmatch(r'[월화수목금토일][~～∼–-][월화수목금토일]', part):
            first, last = DAY_NAMES.index(part[0]), DAY_NAMES.index(part[-1])
            days.update((first + offset) % 7 for offset in range((last - first) % 7 + 1))
        else:
            return None
    return frozenset(days)


def parse_span(opens: str, closes: str) -> tuple[int, int]:
    start, end = clock_minutes(opens), clock_minutes(closes)
    return start, end + (DAY_MINUTES if end < start else 0)


@lru_cache(maxsize=256)
def published_schedule(hours: str, holidays: str) -> tuple[dict[int, list[Slot]], frozenset[int], bool]:
    """운영 구간, 요일 휴무, 요일 확인 필요 여부를 분리한다."""
    weekly = re.sub(r'\s*(?:정기\s*)?휴무\s*$', '', holidays).strip()
    closed = weekday_set(weekly) if weekly else None
    closed = closed or frozenset()
    if not hours:
        return {}, closed, bool(closed)
    windows: dict[int, list[Slot]] = {}
    breaks: dict[int, list[tuple[int, int]]] = {}
    day_specific = bool(closed)
    for line in re.split(r'<br\s*/?>|[;\n]|\s+/\s+|(?<=[\d)])/|(?<=\))\s*-\s*', hours, flags=re.I):
        line = line.strip().removeprefix('-').strip()
        if not line:
            continue
        closed_line = re.fullmatch(r'(.+?)\s*(?:정기\s*)?휴무', line)
        if closed_line:
            days = weekday_set(closed_line[1])
            if days is None:
                return {}, closed, day_specific
            closed |= days
            day_specific = True
            continue
        pause = re.fullmatch(rf'(.*?)\s*{BREAK_LABEL}\s*[:：]?\s*{RANGE}', line)
        if pause:
            days = weekday_set(pause[1])
            if days is None:
                return {}, closed, day_specific
            day_specific |= len(days) != 7
            for day in days:
                breaks.setdefault(day, []).append(parse_span(pause[2], pause[3]))
            continue
        inline_pause = re.search(rf'\(\s*{BREAK_LABEL}\s*[:：]?\s*{RANGE}\s*\)', line)
        if inline_pause:
            line = line[:inline_pause.start()] + line[inline_pause.end():]
        full_day = re.fullmatch(r'(.*?)\s*24\s*시간(?:\s*영업)?\s*', line)
        span = re.fullmatch(rf'(.*?)\s*{RANGE}\s*(?:\(\s*{CUTOFF_LABEL}\s*[:：]?\s*({CLOCK})\s*\))?', line)
        if not (full_day or span):
            return {}, closed, day_specific
        days = weekday_set((full_day or span)[1])
        if days is None:
            return {}, closed, day_specific
        day_specific |= len(days) != 7
        start, end = (0, DAY_MINUTES) if full_day else parse_span(span[2], span[3])
        if start == end:
            return {}, closed, day_specific
        cutoff = clock_minutes(span[5]) if span and span[5] else None
        if cutoff is not None and end > DAY_MINUTES and cutoff < start:
            cutoff += DAY_MINUTES
        cutoff = cutoff if cutoff is not None and start <= cutoff <= end else None
        for day in days:
            slot = Slot(start, end, cutoff, span[4] if cutoff is not None else None)
            windows.setdefault(day, []).append(slot)
            if inline_pause:
                breaks.setdefault(day, []).append(parse_span(inline_pause[1], inline_pause[2]))

    for day, slots in windows.items():
        for pause_start, pause_end in breaks.get(day, []):
            shortened = []
            for slot in slots:
                if pause_end <= slot.start or pause_start >= slot.end:
                    shortened.append(slot)
                    continue
                if pause_start > slot.start:
                    shortened.append(Slot(slot.start, pause_start, slot.cutoff, slot.cutoff_label))
                if pause_end < slot.end:
                    shortened.append(Slot(pause_end, slot.end, slot.cutoff, slot.cutoff_label))
            slots = shortened
        windows[day] = slots
    return windows, closed, day_specific


def resolve_visit(place: dict, travel_date: str | None, earliest: int | None, duration: int = 0,
                  *, allow_wait: bool = False) -> VisitTime:
    """방문 당일의 운영 구간 안에서 체류 전체를 배치하고 불확실한 자료는 미확인으로 둔다."""
    if place.get('event_warning'):
        return VisitTime(earliest, place['event_warning'])
    operating = place.get('operating_hours')
    if not operating:
        return VisitTime(earliest)
    hours, holidays = operating.get('hours') or '', operating.get('holidays') or ''
    source = {key: operating.get(key) for key in ('source', 'source_url')}
    for text in (hours, holidays):
        if re.fullmatch(CLOSED, text):
            return VisitTime(earliest, {'reason': f'공개 운영 정보 · {text.strip()}', **source})

    windows, closed, day_specific = published_schedule(hours, holidays)
    try:
        base_date = date.fromisoformat(travel_date) if travel_date else None
    except ValueError:
        base_date = None
    if base_date is None and day_specific:
        return VisitTime(earliest)
    visit_day, at = divmod(earliest or 0, DAY_MINUTES)
    weekday = (base_date.weekday() + visit_day) % 7 if base_date else 0
    previous = (weekday - 1) % 7
    overnight = [] if previous in closed else [slot for slot in windows.get(previous, []) if slot.end > DAY_MINUTES]
    if earliest is None and weekday not in closed:
        return VisitTime(earliest)
    if earliest is None and overnight:
        return VisitTime(earliest)

    # 전날에 시작한 자정 이후 영업과 방문 요일의 영업을 각각 확인한다.
    current = [] if weekday in closed else windows.get(weekday, [])
    expired_label = None
    for shift, candidates in ((-DAY_MINUTES, overnight), (0, current)):
        for slot in sorted(candidates, key=lambda value: value.start):
            proposed = max(at, slot.start + shift) if allow_wait else at
            if not slot.start + shift <= proposed < slot.end + shift or proposed + max(0, duration) > slot.end + shift:
                continue
            if slot.cutoff is not None and proposed >= slot.cutoff + shift:
                expired_label = slot.cutoff_label
                continue
            return VisitTime(visit_day * DAY_MINUTES + proposed, checked=True)

    if weekday in closed or (at < max((slot.end - DAY_MINUTES for slot in windows.get(previous, [])), default=0)
                            and previous in closed and at < min((slot.start for slot in current), default=DAY_MINUTES)):
        closed_day = visit_day if weekday in closed else visit_day - 1
        actual_date = base_date + timedelta(days=closed_day)
        label = holidays or hours
        return VisitTime(earliest, {'reason': f'{actual_date.isoformat()} 정기 휴무 · {label}', **source})
    if weekday not in windows:
        return VisitTime(earliest)
    time = f'{at // 60:02d}:{at % 60:02d}'
    if expired_label:
        return VisitTime(earliest, {'reason': f'방문 예정 {time}이 안내된 {expired_label} 이후입니다. ({hours})', **source})
    return VisitTime(earliest, {'reason': f'방문 예정 {time}부터 체류할 수 있는 영업시간을 찾지 못했습니다. ({hours})', **source})
